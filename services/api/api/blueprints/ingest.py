"""Ingest blueprint (``/ingest``): what the widget, curl and host apps call,
with a project public key.

Every accepted submission is metered (+1 ``feedback`` on the account's monthly
counter). The limit is soft: past it we keep accepting — a user's feedback is
never lost because of a plan cap — and fire one PostHog ``limit_reached``
event per period. ``ingest-api`` OFF is an emergency kill switch (503).

The honeypot (``website`` field) answers a convincing 201 and stores nothing,
so a bot never learns it was caught. Screenshots are decoded with Pillow,
dropped (not rejected) when the account is over its storage cap, and ignored
when screenshots are switched off for the project or globally.

``store_submission`` is shared with the public board (``blueprints.boards``).

Phase 2: when the project has Cloudflare Turnstile configured the submission
must carry a valid ``turnstile_token`` (a verification *outage* accepts the
item and tags it ``unverified``); every accepted item gets its possible
duplicates computed (``similar_ids``), joins the owner's digest mail and is
emitted to the project's webhooks (``feedback.created``) — all in the same
transaction, through the outbox.
"""
from __future__ import annotations

import secrets
import uuid

from flask import Blueprint, g, jsonify, request
from sqlalchemy.orm import Session

from dbcore.config import config
from dbcore.db import session_scope
from dbcore.duplicates import find_similar
from dbcore.events import emit
from dbcore.feedback import (
    MAX_USER_AGENT,
    SOURCES,
    FeedbackError,
    Submission,
    decode_screenshot,
    next_number,
    normalize_submission,
)
from dbcore.feature_flags import is_enabled, resolve_all
from dbcore.models import Account, Attachment, FeedbackItem, Project
from dbcore.outbox import enqueue_digest_item
from dbcore.plans import effective_plan_limits
from dbcore.posthog_client import capture
from dbcore.privacy import ip_hash
from dbcore.turnstile import verify as verify_turnstile
from dbcore.usage import meter_feedback, storage_available

from ..auth_utils import require_project_key
from ..errors import ApiError
from ..extensions import ingest_key_func, limiter
from ..features import require_feature
from ..serializers import board_url, json_or_form_body, serialize_feedback, serialize_widget_config

bp = Blueprint("ingest", __name__)

_ingest_limit = limiter.limit(config.rate_limit_ingest, key_func=ingest_key_func)


def _client_ip() -> str | None:
    # Caddy sets X-Forwarded-For; the first hop is the client.
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.remote_addr


def _source(default: str) -> str:
    source = (request.headers.get("X-Retro-Source") or default).strip().lower()
    return source if source in SOURCES else default


def honeypot_tripped(data: dict) -> bool:
    return bool((data.get("website") or "").strip())


def fake_accept() -> tuple:
    """The honeypot answer: looks exactly like a real 201, stores nothing."""
    return jsonify(
        {"id": str(uuid.uuid4()), "number": secrets.randbelow(900) + 100, "status": "new",
         "board_url": None, "screenshot_dropped": False}
    ), 201


def check_turnstile(project: Project, data: dict) -> list[str]:
    """Enforce Turnstile when the project configured it. Returns the tags to
    add to the item (``["unverified"]`` when Cloudflare was unreachable)."""
    if not (project.turnstile_site_key and project.turnstile_secret):
        return []
    token = (data.get("turnstile_token") or "").strip() or None
    result = verify_turnstile(project.turnstile_secret, token, _client_ip())
    if result is None:
        return ["unverified"]
    if not result:
        raise ApiError(400, "captcha_failed", "The anti-spam challenge failed; please try again.")
    return []


def store_submission(
    session: Session, project: Project, sub: Submission, *, source: str, extra_tags: list[str] | None = None
) -> tuple[FeedbackItem, bool]:
    """Persist a validated submission (item + optional screenshot), meter it,
    compute its possible duplicates, queue the digest mail and emit the
    ``feedback.created`` webhook event. Returns ``(item, screenshot_dropped)``.
    Runs inside the caller's transaction so the numbering lock covers the whole
    insert and the outbox rows commit with the item."""
    account = session.get(Account, project.account_id)
    limits = effective_plan_limits(account.plan, str(account.id))

    screenshot = None
    screenshot_dropped = False
    if sub.screenshot_data_url:
        allowed = project.allow_screenshots and is_enabled("screenshots", str(account.id))
        if allowed:
            screenshot = decode_screenshot(sub.screenshot_data_url)
            if not storage_available(session, account.id, limits["attachment_storage_mb"], screenshot.size):
                screenshot = None
                screenshot_dropped = True

    item = FeedbackItem(
        project_id=project.id,
        number=next_number(session, project.id),
        type=sub.type,
        sentiment=sub.sentiment,
        title=sub.title,
        message=sub.message,
        reporter_email=sub.reporter_email,
        reporter_id=sub.reporter_id,
        page_url=sub.page_url,
        app_version=sub.app_version,
        locale=sub.locale,
        user_agent=(request.headers.get("User-Agent") or "")[:MAX_USER_AGENT] or None,
        metadata_=sub.metadata,
        source=source,
        ip_hash=ip_hash(_client_ip()),
        tags=list(extra_tags or []),
        similar_ids=find_similar(session, project.id, sub.type, sub.message),
    )
    session.add(item)
    session.flush()
    if screenshot is not None:
        session.add(
            Attachment(
                feedback_id=item.id,
                account_id=account.id,
                content_type=screenshot.content_type,
                size=screenshot.size,
                width=screenshot.width,
                height=screenshot.height,
                sha256=screenshot.sha256,
                data=screenshot.data,
            )
        )

    if meter_feedback(session, account.id, limits["feedback_per_month"]):
        capture(
            str(account.id),
            "limit_reached",
            {"which": "feedback", "plan": account.plan},
            groups={"account": str(account.id)},
        )
    capture(
        str(account.id),
        "feedback_received",
        {"type": item.type, "sentiment": item.sentiment, "has_screenshot": screenshot is not None, "source": source},
        groups={"account": str(account.id)},
    )
    # Side effects ride along in this transaction (outbox pattern).
    enqueue_digest_item(session, account, project, item)
    session.refresh(item)
    emit(session, project, "feedback.created", serialize_feedback(item))
    return item, screenshot_dropped


def accept_response(item: FeedbackItem, project: Project, screenshot_dropped: bool) -> tuple:
    return jsonify(
        {
            "id": str(item.id),
            "number": item.number,
            "status": item.status,
            "board_url": board_url(project) if is_enabled("public-boards", str(project.account_id)) else None,
            "screenshot_dropped": screenshot_dropped,
        }
    ), 201


@bp.get("/config")
@_ingest_limit
@require_project_key
@require_feature("ingest-api", status=503)
def widget_config():
    """What the widget fetches on boot. Cacheable for a minute."""
    with session_scope() as session:
        project = session.get(Project, g.project_id)
        if project is None:
            raise ApiError(401, "invalid_project_key", "Missing or invalid project key.")
        body = serialize_widget_config(project, resolve_all(str(project.account_id)))
    response = jsonify(body)
    response.headers["Cache-Control"] = "public, max-age=60"
    return response


@bp.post("/feedback")
@_ingest_limit
@require_project_key
@require_feature("ingest-api", status=503)
def ingest_feedback():
    data = json_or_form_body()
    if honeypot_tripped(data):
        return fake_accept()
    with session_scope() as session:
        project = session.get(Project, g.project_id)
        if project is None:
            raise ApiError(401, "invalid_project_key", "Missing or invalid project key.")
        try:
            sub = normalize_submission(data, project)
            extra_tags = check_turnstile(project, data)
            item, dropped = store_submission(session, project, sub, source=_source("api"), extra_tags=extra_tags)
        except FeedbackError as err:
            raise ApiError(400, err.code, err.message)
        session.flush()
        response = accept_response(item, project, dropped)
    return response

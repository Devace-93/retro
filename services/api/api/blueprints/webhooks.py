"""Webhooks blueprint (``/projects/:id/webhooks``): per-project endpoints that
receive signed event payloads (Phase 2).

Creating returns the signing secret exactly once. Deliveries are queued as
outbox jobs (``dbcore.outbox``) and sent by the worker, so this blueprint
never makes an outbound HTTP call itself: ``test`` just queues a ``ping``.
"""
from __future__ import annotations

import uuid
from urllib.parse import urlparse

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, select

from dbcore import audit
from dbcore.config import config
from dbcore.db import session_scope
from dbcore.events import build_payload
from dbcore.models import Account, Webhook, WebhookDelivery
from dbcore.outbox import WEBHOOK_EVENTS, enqueue_webhook, generate_webhook_secret
from dbcore.plans import effective_plan_limits, within_limit

from ..auth_utils import actor, require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..features import require_feature
from ..serializers import json_body, serialize_delivery, serialize_webhook
from .projects import get_owned_project, limit_reached

bp = Blueprint("webhooks", __name__)

_public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)


def _get_hook(session, project, wid: str) -> Webhook:
    try:
        hook_id = uuid.UUID(wid)
    except ValueError:
        raise ApiError(404, "not_found", "Webhook not found.")
    hook = session.scalar(select(Webhook).where(Webhook.id == hook_id, Webhook.project_id == project.id))
    if hook is None:
        raise ApiError(404, "not_found", "Webhook not found.")
    return hook


def _validate_url(raw) -> str:
    url = (raw or "").strip()
    if len(url) > 2048:
        raise ApiError(400, "invalid_url", "url is too long.")
    parsed = urlparse(url)
    https_only = config.app_base_url.lower().startswith("https://")
    allowed = ("https",) if https_only else ("https", "http")
    if parsed.scheme not in allowed or not parsed.netloc:
        raise ApiError(400, "invalid_url", "url must be an https:// URL." if https_only else "url must be an http(s):// URL.")
    return url


def _validate_events(raw) -> list[str]:
    if raw is None:
        return list(WEBHOOK_EVENTS)
    if not isinstance(raw, list) or not raw or any(e not in WEBHOOK_EVENTS for e in raw):
        raise ApiError(400, "invalid_events", f"events must be a non-empty subset of {list(WEBHOOK_EVENTS)}.")
    return [e for e in WEBHOOK_EVENTS if e in raw]


@bp.get("")
@_public_limit
@require_auth_or_api_key
@require_scope("projects:read")
def list_webhooks(project_id):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        hooks = session.scalars(
            select(Webhook).where(Webhook.project_id == project.id).order_by(Webhook.created_at)
        ).all()
        items = [serialize_webhook(h) for h in hooks]
    return jsonify(items)


@bp.post("")
@_public_limit
@require_auth_or_api_key
@require_scope("projects:write")
@require_feature("webhooks")
def create_webhook(project_id):
    data = json_body()
    url = _validate_url(data.get("url"))
    events = _validate_events(data.get("events"))
    description = (data.get("description") or "").strip()[:200] or None
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        account = session.get(Account, g.account_id)
        limits = effective_plan_limits(account.plan, str(account.id))
        used = session.scalar(select(func.count(Webhook.id)).where(Webhook.project_id == project.id)) or 0
        if not within_limit(used, limits.get("webhooks_per_project", 5)):
            raise limit_reached(account, "webhooks", "Webhook limit reached for your plan.")
        secret, prefix = generate_webhook_secret()
        hook = Webhook(
            project_id=project.id, url=url, events=events, description=description,
            secret=secret, secret_prefix=prefix,
        )
        session.add(hook)
        session.flush()
        audit.record(
            session, account_id=g.account_id, action="webhook.create", target_type="webhook",
            target_id=str(hook.id), meta={"url": url, "events": events}, **actor(),
        )
        session.flush()
        body = serialize_webhook(hook, secret=secret)
    return jsonify(body), 201


@bp.patch("/<wid>")
@_public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def patch_webhook(project_id, wid):
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        hook = _get_hook(session, project, wid)
        fields = []
        if "url" in data:
            hook.url = _validate_url(data.get("url"))
            fields.append("url")
        if "events" in data:
            hook.events = _validate_events(data.get("events"))
            fields.append("events")
        if "description" in data:
            hook.description = (data.get("description") or "").strip()[:200] or None
            fields.append("description")
        if "enabled" in data:
            hook.enabled = bool(data.get("enabled"))
            fields.append("enabled")
        audit.record(
            session, account_id=g.account_id, action="webhook.update", target_type="webhook",
            target_id=str(hook.id), meta={"fields": sorted(set(fields))}, **actor(),
        )
        session.flush()
        session.refresh(hook)
        body = serialize_webhook(hook)
    return jsonify(body)


@bp.delete("/<wid>")
@_public_limit
@require_auth_or_api_key
@require_scope("projects:delete")
def delete_webhook(project_id, wid):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        hook = _get_hook(session, project, wid)
        audit.record(
            session, account_id=g.account_id, action="webhook.delete", target_type="webhook",
            target_id=str(hook.id), meta={"url": hook.url}, **actor(),
        )
        session.delete(hook)
    return "", 204


@bp.post("/<wid>/test")
@_public_limit
@require_auth_or_api_key
@require_scope("projects:write")
@require_feature("webhooks")
def test_webhook(project_id, wid):
    """Queue a ``ping`` delivery (sent by the worker, even to a disabled hook)."""
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        hook = _get_hook(session, project, wid)
        delivery = enqueue_webhook(session, hook, "ping", {})
        delivery.payload = build_payload(project, "ping", {"message": "retro webhook test"}, str(delivery.id))
        session.flush()
        body = {"delivery_id": str(delivery.id)}
    return jsonify(body), 202


@bp.get("/<wid>/deliveries")
@_public_limit
@require_auth_or_api_key
@require_scope("projects:read")
def list_deliveries(project_id, wid):
    try:
        limit = min(max(int(request.args.get("limit", 20)), 1), 100)
    except ValueError:
        limit = 20
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        hook = _get_hook(session, project, wid)
        rows = session.scalars(
            select(WebhookDelivery)
            .where(WebhookDelivery.webhook_id == hook.id)
            .order_by(WebhookDelivery.created_at.desc())
            .limit(limit)
        ).all()
        items = [serialize_delivery(d) for d in rows]
    return jsonify(items)

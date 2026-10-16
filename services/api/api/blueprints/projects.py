"""Projects blueprint: CRUD, public-key rotation, summary and tags.

These endpoints accept EITHER a dashboard JWT OR a management API key.
Everything is scoped to ``g.account_id`` so one account can never see
another's projects (a foreign project is a 404, never a 403), and each
endpoint declares the RBAC scope it needs. Mutations are written to the audit
log in the same transaction as the change.

Creating a project mints its public key (``retro_pub_…``, what the widget and
curl post with) and picks a globally unique ``board_slug``; the board itself
starts disabled. The helpers (``get_owned_project``, ``project_counts``,
``limit_reached``) are shared with the feedback, roadmap and changelog
blueprints.
"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, g, jsonify, request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from dbcore import audit
from dbcore.config import config
from dbcore.db import session_scope
from dbcore.feedback import SENTIMENTS, STATUSES, TYPES, is_hex_color
from dbcore.models import ChangelogEntry, Account, FeedbackItem, FeedbackNote, Project, RoadmapItem
from dbcore.plans import effective_plan_limits, within_limit
from dbcore.posthog_client import capture
from dbcore.slugs import (
    is_reserved_board_slug,
    is_valid_board_slug,
    is_valid_project_key,
    slugify,
    suffixed,
)

from ..auth_utils import PUBLIC_KEY_PREFIX, actor, generate_secret_key, hash_token, require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..serializers import (
    iso,
    json_body,
    serialize_changelog_entry,
    serialize_feedback,
    serialize_project,
    serialize_roadmap_item,
)

bp = Blueprint("projects", __name__)

# Public-API budget applies on top of the global default limit.
public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)

# Fields PATCH accepts, by type, so validation stays table-driven.
_STRING_FIELDS = {"name": 120, "description": 20000, "url": 2048, "board_title": 120, "board_intro": 20000}
_BOOL_FIELDS = ("board_enabled", "allow_votes", "allow_board_submissions", "allow_screenshots", "allow_email")


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #
def get_owned_project(session, project_id_str: str) -> Project:
    """Fetch a project by id, scoped to the current account, or 404."""
    try:
        project_id = uuid.UUID(str(project_id_str))
    except (ValueError, AttributeError):
        raise ApiError(404, "not_found", "Project not found.")
    project = session.scalar(
        select(Project).where(Project.id == project_id, Project.account_id == g.account_id)
    )
    if project is None:
        raise ApiError(404, "not_found", "Project not found.")
    return project


def project_counts(session, project_ids: list) -> dict:
    """``{project_id: {feedback, new, roadmap}}`` in two grouped queries."""
    if not project_ids:
        return {}
    out = {pid: {"feedback": 0, "new": 0, "roadmap": 0} for pid in project_ids}
    rows = session.execute(
        select(FeedbackItem.project_id, FeedbackItem.status, func.count(FeedbackItem.id))
        .where(FeedbackItem.project_id.in_(project_ids))
        .group_by(FeedbackItem.project_id, FeedbackItem.status)
    ).all()
    for pid, status, n in rows:
        out[pid]["feedback"] += n
        if status == "new":
            out[pid]["new"] += n
    rows = session.execute(
        select(RoadmapItem.project_id, func.count(RoadmapItem.id))
        .where(RoadmapItem.project_id.in_(project_ids))
        .group_by(RoadmapItem.project_id)
    ).all()
    for pid, n in rows:
        out[pid]["roadmap"] = n
    return out


def limit_reached(account: Account, which: str, message: str) -> ApiError:
    """Emit the funnel event and build the 402 the contract expects."""
    capture(
        str(account.id),
        "limit_reached",
        {"which": which, "plan": account.plan},
        groups={"account": str(account.id)},
    )
    return ApiError(402, "limit_reached", message, extra={"which": which})


def _mint_public_key(project: Project) -> None:
    full_key, prefix = generate_secret_key(PUBLIC_KEY_PREFIX)
    project.public_key = full_key
    project.public_key_hash = hash_token(full_key)
    project.public_key_prefix = prefix


def _free_board_slug(session, wanted: str) -> str:
    """``wanted`` when globally free and not reserved, otherwise ``wanted-xxxx``."""
    candidate = wanted
    if is_reserved_board_slug(candidate) or not is_valid_board_slug(candidate):
        candidate = suffixed(wanted if len(wanted) > 1 else f"{wanted}0")
    for _ in range(10):
        taken = session.scalar(select(Project.id).where(Project.board_slug == candidate))
        if not taken:
            return candidate
        candidate = suffixed(wanted)
    raise ApiError(500, "slug_exhausted", "Could not allocate a board slug; try again.")


def _serialize_one(session, project: Project) -> dict:
    return serialize_project(project, project_counts(session, [project.id]).get(project.id))


# --------------------------------------------------------------------------- #
# List + create
# --------------------------------------------------------------------------- #
@bp.get("")
@public_limit
@require_auth_or_api_key
@require_scope("projects:read")
def list_projects():
    q = (request.args.get("q") or "").strip()
    with session_scope() as session:
        stmt = select(Project).where(Project.account_id == g.account_id)
        if q:
            like = f"%{q}%"
            stmt = stmt.where(or_(Project.name.ilike(like), Project.key.ilike(like)))
        projects = session.scalars(stmt.order_by(Project.created_at.desc(), Project.id)).all()
        counts = project_counts(session, [p.id for p in projects])
        items = [serialize_project(p, counts.get(p.id)) for p in projects]
    return jsonify({"items": items, "total": len(items)})


@bp.post("")
@public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def create_project():
    data = json_body()
    name = (data.get("name") or "").strip()
    if not name:
        raise ApiError(400, "missing_name", "name is required.")
    key = (data.get("key") or "").strip().lower() or slugify(name)
    if not is_valid_project_key(key):
        raise ApiError(400, "invalid_key", "key must match ^[a-z0-9][a-z0-9-]{0,62}$.")
    description = (data.get("description") or "").strip() or None
    url = (data.get("url") or "").strip()[:2048] or None

    with session_scope() as session:
        account = session.get(Account, g.account_id)
        limits = effective_plan_limits(account.plan, str(account.id))
        used = session.scalar(select(func.count(Project.id)).where(Project.account_id == account.id)) or 0
        if not within_limit(used, limits["projects"]):
            raise limit_reached(account, "projects", "Project limit reached for your plan.")

        taken = session.scalar(
            select(Project.id).where(Project.account_id == account.id, Project.key == key)
        )
        if taken:
            raise ApiError(409, "key_taken", f"A project with key '{key}' already exists.")

        project = Project(
            account_id=account.id,
            key=key,
            name=name,
            description=description,
            url=url,
            board_slug=_free_board_slug(session, key),
            types_enabled=list(TYPES),
        )
        _mint_public_key(project)
        session.add(project)
        session.flush()

        audit.record(
            session,
            account_id=account.id,
            action="project.create",
            target_type="project",
            target_id=str(project.id),
            meta={"key": key, "name": name, "board_slug": project.board_slug},
            **actor(),
        )
        session.flush()
        body = serialize_project(project)

    capture(str(g.account_id), "project_created", {"plan": account.plan}, groups={"account": str(g.account_id)})
    return jsonify(body), 201


# --------------------------------------------------------------------------- #
# Get / patch / delete / rotate
# --------------------------------------------------------------------------- #
@bp.get("/<project_id>")
@public_limit
@require_auth_or_api_key
@require_scope("projects:read")
def get_project(project_id):
    with session_scope() as session:
        body = _serialize_one(session, get_owned_project(session, project_id))
    return jsonify(body)


@bp.patch("/<project_id>")
@public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def patch_project(project_id):
    data = json_body()
    changed: list[str] = []
    with session_scope() as session:
        project = get_owned_project(session, project_id)

        for field, max_len in _STRING_FIELDS.items():
            if field in data:
                value = (data.get(field) or "").strip()[:max_len] or None
                if field == "name" and not value:
                    raise ApiError(400, "missing_name", "name cannot be empty.")
                setattr(project, field, value)
                changed.append(field)

        for field in _BOOL_FIELDS:
            if field in data:
                setattr(project, field, bool(data.get(field)))
                changed.append(field)

        if "board_slug" in data:
            slug = (data.get("board_slug") or "").strip().lower()
            if not is_valid_board_slug(slug):
                raise ApiError(400, "invalid_slug", "board_slug must match ^[a-z0-9][a-z0-9-]{1,62}$.")
            if is_reserved_board_slug(slug):
                raise ApiError(400, "reserved_slug", f"'{slug}' is reserved.")
            if slug != project.board_slug:
                taken = session.scalar(select(Project.id).where(Project.board_slug == slug))
                if taken:
                    raise ApiError(409, "slug_taken", f"The board slug '{slug}' is already in use.")
                project.board_slug = slug
                changed.append("board_slug")

        if "types_enabled" in data:
            raw = data.get("types_enabled")
            if not isinstance(raw, list) or not raw or any(t not in TYPES for t in raw):
                raise ApiError(400, "invalid_types", f"types_enabled must be a non-empty subset of {list(TYPES)}.")
            project.types_enabled = [t for t in TYPES if t in raw]
            changed.append("types_enabled")

        if "widget_accent" in data:
            accent = (data.get("widget_accent") or "").strip() or None
            if accent is not None and not is_hex_color(accent):
                raise ApiError(400, "invalid_accent", "widget_accent must be a #rrggbb colour.")
            project.widget_accent = accent.lower() if accent else None
            changed.append("widget_accent")

        # Turnstile: site key is public, secret is write-only. Clearing either
        # disables verification (both are needed, see serializers.turnstile_site_key).
        if "turnstile_site_key" in data:
            project.turnstile_site_key = (data.get("turnstile_site_key") or "").strip()[:120] or None
            changed.append("turnstile_site_key")
        if "turnstile_secret" in data:
            project.turnstile_secret = (data.get("turnstile_secret") or "").strip()[:120] or None
            changed.append("turnstile_secret")

        audit.record(
            session,
            account_id=g.account_id,
            action="project.update",
            target_type="project",
            target_id=str(project.id),
            meta={"key": project.key, "fields": sorted(set(changed))},
            **actor(),
        )
        session.flush()
        session.refresh(project)
        body = _serialize_one(session, project)
    return jsonify(body)


@bp.delete("/<project_id>")
@public_limit
@require_auth_or_api_key
@require_scope("projects:delete")
def delete_project(project_id):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        audit.record(
            session,
            account_id=g.account_id,
            action="project.delete",
            target_type="project",
            target_id=str(project.id),
            meta={"key": project.key, "name": project.name},
            **actor(),
        )
        # ON DELETE CASCADE takes feedback, notes, attachments, roadmap,
        # votes and changelog entries with it.
        session.delete(project)
    return "", 204


@bp.post("/<project_id>/rotate-key")
@public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def rotate_key(project_id):
    """Replace the public key. The old key stops working immediately: every
    widget snippet out there must be updated."""
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        old_prefix = project.public_key_prefix
        _mint_public_key(project)
        audit.record(
            session,
            account_id=g.account_id,
            action="project.rotate_key",
            target_type="project",
            target_id=str(project.id),
            meta={"key": project.key, "old_prefix": old_prefix, "new_prefix": project.public_key_prefix},
            **actor(),
        )
        session.flush()
        body = {"public_key": project.public_key, "public_key_prefix": project.public_key_prefix}
    return jsonify(body)


# --------------------------------------------------------------------------- #
# Summary + tags
# --------------------------------------------------------------------------- #
@bp.get("/<project_id>/summary")
@public_limit
@require_auth_or_api_key
@require_scope("feedback:read")
def summary(project_id):
    """Counts for the inbox header and the MCP ``feedback_summary`` tool."""
    now = datetime.now(timezone.utc)
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        base = select(func.count(FeedbackItem.id)).where(FeedbackItem.project_id == project.id)

        def grouped(column):
            rows = session.execute(
                select(column, func.count(FeedbackItem.id))
                .where(FeedbackItem.project_id == project.id)
                .group_by(column)
            ).all()
            return {k: n for k, n in rows if k is not None}

        by_status = grouped(FeedbackItem.status)
        by_type = grouped(FeedbackItem.type)
        by_sentiment = grouped(FeedbackItem.sentiment)
        total = sum(by_status.values())
        last_7 = session.scalar(base.where(FeedbackItem.created_at >= now - timedelta(days=7))) or 0
        last_30 = session.scalar(base.where(FeedbackItem.created_at >= now - timedelta(days=30))) or 0
        top_tags = _tag_counts(session, project.id)[:10]
    return jsonify(
        {
            "project_id": str(project.id),
            "total": total,
            "by_status": {s: by_status.get(s, 0) for s in STATUSES},
            "by_type": {t: by_type.get(t, 0) for t in TYPES},
            "by_sentiment": {s: by_sentiment.get(s, 0) for s in SENTIMENTS},
            "last_7_days": last_7,
            "last_30_days": last_30,
            "top_tags": top_tags,
        }
    )


def _tag_counts(session, project_id) -> list[dict]:
    """``[{tag, count}]`` sorted by count desc, unnesting the JSONB tag arrays."""
    tag = func.jsonb_array_elements_text(FeedbackItem.tags).column_valued("tag")
    rows = session.execute(
        select(tag, func.count())
        .select_from(FeedbackItem)
        .where(FeedbackItem.project_id == project_id)
        .group_by(tag)
        .order_by(func.count().desc(), tag)
    ).all()
    return [{"tag": t, "count": n} for t, n in rows]


@bp.get("/<project_id>/tags")
@public_limit
@require_auth_or_api_key
@require_scope("feedback:read")
def tags(project_id):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        body = {"tags": _tag_counts(session, project.id)}
    return jsonify(body)


# --------------------------------------------------------------------------- #
# Export (Phase 2)
# --------------------------------------------------------------------------- #
EXPORT_FORMAT = "retro.project.v1"
CSV_COLUMNS = (
    "number", "type", "sentiment", "status", "priority", "tags", "title", "message",
    "reporter_email", "page_url", "app_version", "source", "created_at",
)


@bp.get("/<project_id>/export")
@public_limit
@require_auth_or_api_key
@require_scope("feedback:read")
@require_scope("board:read")
def export_project(project_id):
    """Portable snapshot: ``retro.project.v1`` JSON (feedback with notes,
    roadmap, changelog; no screenshot bytes) or a CSV of the feedback items."""
    fmt = (request.args.get("format") or "json").strip().lower()
    if fmt not in ("json", "csv"):
        raise ApiError(400, "invalid_format", "format must be json or csv.")
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        items = session.scalars(
            select(FeedbackItem)
            .where(FeedbackItem.project_id == project.id)
            .options(selectinload(FeedbackItem.attachment), selectinload(FeedbackItem.notes).selectinload(FeedbackNote.author))
            .order_by(FeedbackItem.number)
        ).all()
        if fmt == "csv":
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(CSV_COLUMNS)
            for it in items:
                writer.writerow([
                    it.number, it.type, it.sentiment or "", it.status, it.priority, " ".join(it.tags or []),
                    it.title, it.message, it.reporter_email or "", it.page_url or "", it.app_version or "",
                    it.source, iso(it.created_at),
                ])
            data = buf.getvalue()
            key = project.key
            response = Response(data, mimetype="text/csv")
            response.headers["Content-Disposition"] = f'attachment; filename="{key}-feedback.csv"'
            return response

        roadmap = session.scalars(
            select(RoadmapItem).where(RoadmapItem.project_id == project.id).order_by(RoadmapItem.status, RoadmapItem.position)
        ).all()
        linked = dict(
            session.execute(
                select(FeedbackItem.roadmap_item_id, func.count(FeedbackItem.id))
                .where(FeedbackItem.project_id == project.id, FeedbackItem.roadmap_item_id.is_not(None))
                .group_by(FeedbackItem.roadmap_item_id)
            ).all()
        )
        changelog = session.scalars(
            select(ChangelogEntry).where(ChangelogEntry.project_id == project.id).order_by(ChangelogEntry.created_at)
        ).all()

        def _feedback(it):
            body = serialize_feedback(it, with_notes=True)
            for note in body["notes"]:
                if note.get("author"):
                    note["author"] = {"email": note["author"].get("email"), "label": note["author"].get("label")}
            body.pop("similar", None)
            return body

        body = {
            "format": EXPORT_FORMAT,
            "exported_at": iso(datetime.now(timezone.utc)),
            "project": {
                "key": project.key, "name": project.name, "description": project.description, "url": project.url,
                "board_slug": project.board_slug, "types_enabled": list(project.types_enabled or []),
            },
            "feedback": [_feedback(it) for it in items],
            "roadmap": [serialize_roadmap_item(r, linked.get(r.id, 0)) for r in roadmap],
            "changelog": [serialize_changelog_entry(e) for e in changelog],
        }
    return jsonify(body)

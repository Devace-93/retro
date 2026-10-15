"""Feedback blueprint (management): the inbox.

List / read / triage (status, priority, tags) / notes / promote to the roadmap
/ screenshot bytes. Accepts a dashboard JWT or a management API key; every
query is scoped through ``get_owned_project`` so a foreign project is a 404.
Mutations are audited in the same transaction.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, Response, g, jsonify, request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from dbcore import audit
from dbcore.config import config
from dbcore.db import session_scope
from dbcore.feedback import PRIORITIES, SENTIMENTS, STATUSES, TYPES, FeedbackError, clean_tags
from dbcore.models import Account, Attachment, FeedbackItem, FeedbackNote, RoadmapItem
from dbcore.plans import effective_plan_limits, within_limit

from ..auth_utils import actor, require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..serializers import json_body, serialize_feedback, serialize_note, serialize_roadmap_item
from .projects import get_owned_project, limit_reached

bp = Blueprint("feedback", __name__)

_public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)

# Roadmap status -> feedback status when an item is linked/promoted.
ROADMAP_TO_FEEDBACK = {"planned": "planned", "in_progress": "in_progress", "done": "done"}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def get_item(session, project, item_ref: str, *, with_notes: bool = False) -> FeedbackItem:
    """Resolve ``:item`` as the UUID or the per-project number, or 404."""
    stmt = select(FeedbackItem).where(FeedbackItem.project_id == project.id)
    if item_ref.isdigit():
        stmt = stmt.where(FeedbackItem.number == int(item_ref))
    else:
        try:
            stmt = stmt.where(FeedbackItem.id == uuid.UUID(item_ref))
        except ValueError:
            raise ApiError(404, "not_found", "Feedback item not found.")
    stmt = stmt.options(selectinload(FeedbackItem.attachment))
    if with_notes:
        stmt = stmt.options(selectinload(FeedbackItem.notes).selectinload(FeedbackNote.author))
    item = session.scalar(stmt)
    if item is None:
        raise ApiError(404, "not_found", "Feedback item not found.")
    return item


def _csv(name: str, allowed: tuple) -> list[str]:
    raw = (request.args.get(name) or "").strip()
    if not raw:
        return []
    values = [v.strip() for v in raw.split(",") if v.strip()]
    bad = [v for v in values if v not in allowed]
    if bad:
        raise ApiError(400, f"invalid_{name}", f"{name} must be one of: {', '.join(allowed)}.")
    return values


def _int_arg(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return min(max(int(request.args.get(name, default)), lo), hi)
    except ValueError:
        return default


def _parse_since() -> datetime | None:
    raw = (request.args.get("since") or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(400, "invalid_since", "since must be an ISO-8601 timestamp.")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------------- #
# List / get
# --------------------------------------------------------------------------- #
@bp.get("")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:read")
def list_feedback(project_id):
    q = (request.args.get("q") or "").strip()
    types = _csv("type", TYPES)
    statuses = _csv("status", STATUSES)
    sentiments = _csv("sentiment", SENTIMENTS)
    priorities = _csv("priority", PRIORITIES)
    tag = (request.args.get("tag") or "").strip().lower()
    has_screenshot = (request.args.get("has_screenshot") or "").strip().lower()
    since = _parse_since()
    sort = (request.args.get("sort") or "newest").strip()
    if sort not in ("newest", "oldest", "votes"):
        raise ApiError(400, "invalid_sort", "sort must be newest, oldest or votes.")
    page = _int_arg("page", 1, 1, 10_000)
    per_page = _int_arg("per_page", 50, 1, 200)

    with session_scope() as session:
        project = get_owned_project(session, project_id)
        stmt = select(FeedbackItem).where(FeedbackItem.project_id == project.id)
        if q:
            like = f"%{q}%"
            stmt = stmt.where(
                or_(
                    FeedbackItem.title.ilike(like),
                    FeedbackItem.message.ilike(like),
                    FeedbackItem.reporter_email.ilike(like),
                    FeedbackItem.page_url.ilike(like),
                )
            )
        if types:
            stmt = stmt.where(FeedbackItem.type.in_(types))
        if statuses:
            stmt = stmt.where(FeedbackItem.status.in_(statuses))
        if sentiments:
            stmt = stmt.where(FeedbackItem.sentiment.in_(sentiments))
        if priorities:
            stmt = stmt.where(FeedbackItem.priority.in_(priorities))
        if tag:
            stmt = stmt.where(FeedbackItem.tags.contains([tag]))
        if has_screenshot in ("true", "1"):
            stmt = stmt.where(FeedbackItem.attachment.has())
        elif has_screenshot in ("false", "0"):
            stmt = stmt.where(~FeedbackItem.attachment.has())
        if since is not None:
            stmt = stmt.where(FeedbackItem.created_at >= since)

        total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0

        if sort == "oldest":
            stmt = stmt.order_by(FeedbackItem.created_at.asc(), FeedbackItem.number.asc())
        elif sort == "votes":
            # Votes live on the linked roadmap item; unlinked items sort last.
            stmt = stmt.outerjoin(RoadmapItem, RoadmapItem.id == FeedbackItem.roadmap_item_id).order_by(
                func.coalesce(RoadmapItem.votes, -1).desc(), FeedbackItem.created_at.desc()
            )
        else:
            stmt = stmt.order_by(FeedbackItem.created_at.desc(), FeedbackItem.number.desc())

        rows = session.scalars(
            stmt.options(selectinload(FeedbackItem.attachment)).offset((page - 1) * per_page).limit(per_page)
        ).all()
        items = [serialize_feedback(r) for r in rows]
    return jsonify({"items": items, "page": page, "per_page": per_page, "total": total})


@bp.get("/<item_ref>")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:read")
def get_feedback(project_id, item_ref):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        body = serialize_feedback(get_item(session, project, item_ref, with_notes=True), with_notes=True)
    return jsonify(body)


# --------------------------------------------------------------------------- #
# Patch / delete
# --------------------------------------------------------------------------- #
@bp.patch("/<item_ref>")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:write")
def patch_feedback(project_id, item_ref):
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        item = get_item(session, project, item_ref, with_notes=True)
        meta: dict = {"fields": []}

        if "status" in data:
            status = (data.get("status") or "").strip()
            if status not in STATUSES:
                raise ApiError(400, "invalid_status", f"status must be one of: {', '.join(STATUSES)}.")
            if status != item.status:
                meta["from"], meta["to"] = item.status, status
                item.status = status
            meta["fields"].append("status")
        if "priority" in data:
            priority = (data.get("priority") or "none").strip()
            if priority not in PRIORITIES:
                raise ApiError(400, "invalid_priority", f"priority must be one of: {', '.join(PRIORITIES)}.")
            item.priority = priority
            meta["fields"].append("priority")
        if "tags" in data:
            try:
                item.tags = clean_tags(data.get("tags"))
            except FeedbackError as err:
                raise ApiError(400, err.code, err.message)
            meta["fields"].append("tags")
        if "title" in data:
            title = (data.get("title") or "").strip()[:140]
            if not title:
                raise ApiError(400, "missing_title", "title cannot be empty.")
            item.title = title
            meta["fields"].append("title")
        if "type" in data:
            type_ = (data.get("type") or "").strip()
            if type_ not in TYPES:
                raise ApiError(400, "invalid_type", f"type must be one of: {', '.join(TYPES)}.")
            item.type = type_
            if type_ != "feedback":
                item.sentiment = None
            meta["fields"].append("type")
        if "sentiment" in data:
            sentiment = (data.get("sentiment") or None)
            if sentiment is not None and sentiment not in SENTIMENTS:
                raise ApiError(400, "invalid_sentiment", f"sentiment must be one of: {', '.join(SENTIMENTS)}.")
            item.sentiment = sentiment if item.type == "feedback" else None
            meta["fields"].append("sentiment")
        if "roadmap_item_id" in data:
            rid = data.get("roadmap_item_id")
            if rid is None:
                item.roadmap_item_id = None
            else:
                try:
                    rid = uuid.UUID(str(rid))
                except ValueError:
                    raise ApiError(404, "not_found", "Roadmap item not found.")
                target = session.scalar(
                    select(RoadmapItem).where(RoadmapItem.id == rid, RoadmapItem.project_id == project.id)
                )
                if target is None:
                    raise ApiError(404, "not_found", "Roadmap item not found.")
                item.roadmap_item_id = target.id
            meta["fields"].append("roadmap_item_id")

        audit.record(
            session,
            account_id=g.account_id,
            action="feedback.update",
            target_type="feedback",
            target_id=str(item.id),
            meta={**meta, "number": item.number},
            **actor(),
        )
        session.flush()
        session.refresh(item)
        body = serialize_feedback(item, with_notes=True)
    return jsonify(body)


@bp.delete("/<item_ref>")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:delete")
def delete_feedback(project_id, item_ref):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        item = get_item(session, project, item_ref)
        audit.record(
            session,
            account_id=g.account_id,
            action="feedback.delete",
            target_type="feedback",
            target_id=str(item.id),
            meta={"number": item.number, "type": item.type, "title": item.title},
            **actor(),
        )
        session.delete(item)
    return "", 204


# --------------------------------------------------------------------------- #
# Notes
# --------------------------------------------------------------------------- #
@bp.post("/<item_ref>/notes")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:write")
def add_note(project_id, item_ref):
    data = json_body()
    body_text = (data.get("body") or "").strip()
    if not body_text:
        raise ApiError(400, "missing_body", "body is required.")
    if len(body_text) > 5000:
        raise ApiError(400, "too_long", "body must be at most 5000 characters.")
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        item = get_item(session, project, item_ref)
        who = actor()
        note = FeedbackNote(
            feedback_id=item.id,
            author_user_id=who["actor_id"] if who["actor_type"] == "user" else None,
            author_label=who["actor_label"],
            body=body_text,
        )
        session.add(note)
        session.flush()
        audit.record(
            session,
            account_id=g.account_id,
            action="feedback.note",
            target_type="feedback",
            target_id=str(item.id),
            meta={"number": item.number, "note_id": str(note.id)},
            **who,
        )
        session.flush()
        session.refresh(note)
        body = serialize_note(note)
    return jsonify(body), 201


@bp.delete("/<item_ref>/notes/<note_id>")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:write")
def delete_note(project_id, item_ref, note_id):
    """Authors delete their own notes; account owners (JWT) may delete any."""
    try:
        nid = uuid.UUID(note_id)
    except ValueError:
        raise ApiError(404, "not_found", "Note not found.")
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        item = get_item(session, project, item_ref)
        note = session.scalar(select(FeedbackNote).where(FeedbackNote.id == nid, FeedbackNote.feedback_id == item.id))
        if note is None:
            raise ApiError(404, "not_found", "Note not found.")
        who = actor()
        own = (who["actor_type"] == "user" and note.author_user_id == who["actor_id"]) or (
            who["actor_type"] == "api_key" and note.author_label == who["actor_label"]
        )
        if not own and who["actor_type"] != "user":
            raise ApiError(403, "forbidden", "Only the author can delete this note.")
        session.delete(note)
    return "", 204


# --------------------------------------------------------------------------- #
# Promote to roadmap
# --------------------------------------------------------------------------- #
@bp.post("/<item_ref>/promote")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:write")
@require_scope("board:write")
def promote(project_id, item_ref):
    """Create a roadmap item from a feedback item and link them. Idempotent:
    an already-linked item returns 200 with its existing roadmap item."""
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        item = get_item(session, project, item_ref, with_notes=True)

        if item.roadmap_item_id is not None:
            existing = session.get(RoadmapItem, item.roadmap_item_id)
            if existing is not None:
                body = {"item": serialize_feedback(item, with_notes=True), "roadmap_item": serialize_roadmap_item(existing, _linked_count(session, existing.id))}
                return jsonify(body), 200

        status = (data.get("status") or "planned").strip()
        if status not in ROADMAP_TO_FEEDBACK:
            raise ApiError(400, "invalid_status", "status must be planned, in_progress or done.")
        title = (data.get("title") or item.title).strip()[:140]
        description = data.get("description")
        description = (description if description is not None else item.message).strip() or None

        account = session.get(Account, g.account_id)
        limits = effective_plan_limits(account.plan, str(account.id))
        used = session.scalar(select(func.count(RoadmapItem.id)).where(RoadmapItem.project_id == project.id)) or 0
        if not within_limit(used, limits["roadmap_items_per_project"]):
            raise limit_reached(account, "roadmap_items", "Roadmap item limit reached for your plan.")

        last = session.scalar(
            select(func.max(RoadmapItem.position)).where(RoadmapItem.project_id == project.id, RoadmapItem.status == status)
        )
        roadmap_item = RoadmapItem(
            project_id=project.id,
            title=title,
            description=description,
            status=status,
            position=(last + 1) if last is not None else 0,
            completed_at=datetime.now(timezone.utc) if status == "done" else None,
        )
        session.add(roadmap_item)
        session.flush()
        item.roadmap_item_id = roadmap_item.id
        if item.status not in ("in_progress", "done"):
            item.status = ROADMAP_TO_FEEDBACK[status]

        audit.record(
            session,
            account_id=g.account_id,
            action="feedback.promote",
            target_type="feedback",
            target_id=str(item.id),
            meta={"number": item.number, "roadmap_item_id": str(roadmap_item.id), "status": status},
            **actor(),
        )
        session.flush()
        session.refresh(item)
        body = {"item": serialize_feedback(item, with_notes=True), "roadmap_item": serialize_roadmap_item(roadmap_item, 1)}
    return jsonify(body), 201


def _linked_count(session, roadmap_item_id) -> int:
    return session.scalar(select(func.count(FeedbackItem.id)).where(FeedbackItem.roadmap_item_id == roadmap_item_id)) or 0


# --------------------------------------------------------------------------- #
# Screenshot bytes
# --------------------------------------------------------------------------- #
@bp.get("/<item_ref>/screenshot")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:read")
def screenshot(project_id, item_ref):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        item = get_item(session, project, item_ref)
        attachment = session.scalar(select(Attachment).where(Attachment.feedback_id == item.id))
        if attachment is None:
            raise ApiError(404, "not_found", "This item has no screenshot.")
        data, content_type = bytes(attachment.data), attachment.content_type
    response = Response(data, mimetype=content_type)
    response.headers["Cache-Control"] = "private, max-age=3600"
    response.headers["Content-Length"] = str(len(data))
    return response

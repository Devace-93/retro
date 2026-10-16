"""Roadmap blueprint (management): the cards behind the public board.

Three columns (``planned`` / ``in_progress`` / ``done``), ordered by
``position`` within a column. Moving a card to ``done`` stamps
``completed_at`` and moves its linked feedback items along; deleting a card
unlinks them (never deletes feedback).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import func, select, update

from dbcore import audit
from dbcore.config import config
from dbcore.db import session_scope
from dbcore.events import emit
from dbcore.feedback import ROADMAP_STATUSES
from dbcore.models import Account, FeedbackItem, RoadmapItem
from dbcore.plans import effective_plan_limits, within_limit

from ..auth_utils import actor, require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..serializers import serialize_feedback, json_body, serialize_roadmap_item
from .feedback import ROADMAP_TO_FEEDBACK
from .projects import get_owned_project, limit_reached

bp = Blueprint("roadmap", __name__)

_public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)

_STATUS_ORDER = {s: i for i, s in enumerate(ROADMAP_STATUSES)}


def get_roadmap_item(session, project, rid: str) -> RoadmapItem:
    try:
        item_id = uuid.UUID(rid)
    except ValueError:
        raise ApiError(404, "not_found", "Roadmap item not found.")
    item = session.scalar(select(RoadmapItem).where(RoadmapItem.id == item_id, RoadmapItem.project_id == project.id))
    if item is None:
        raise ApiError(404, "not_found", "Roadmap item not found.")
    return item


def feedback_counts(session, item_ids: list) -> dict:
    if not item_ids:
        return {}
    rows = session.execute(
        select(FeedbackItem.roadmap_item_id, func.count(FeedbackItem.id))
        .where(FeedbackItem.roadmap_item_id.in_(item_ids))
        .group_by(FeedbackItem.roadmap_item_id)
    ).all()
    return {rid: n for rid, n in rows}


def _serialize_many(session, items: list) -> list[dict]:
    counts = feedback_counts(session, [i.id for i in items])
    items = sorted(items, key=lambda i: (_STATUS_ORDER.get(i.status, 9), i.position, i.created_at or datetime.min.replace(tzinfo=timezone.utc)))
    return [serialize_roadmap_item(i, counts.get(i.id, 0)) for i in items]


def _validate_status(value) -> str:
    status = (value or "").strip()
    if status not in ROADMAP_STATUSES:
        raise ApiError(400, "invalid_status", f"status must be one of: {', '.join(ROADMAP_STATUSES)}.")
    return status


def _next_position(session, project_id, status: str) -> int:
    last = session.scalar(
        select(func.max(RoadmapItem.position)).where(RoadmapItem.project_id == project_id, RoadmapItem.status == status)
    )
    return (last + 1) if last is not None else 0


@bp.get("")
@_public_limit
@require_auth_or_api_key
@require_scope("board:read")
def list_roadmap(project_id):
    status = (request.args.get("status") or "").strip()
    include_hidden = (request.args.get("include_hidden") or "true").lower() in ("1", "true")
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        stmt = select(RoadmapItem).where(RoadmapItem.project_id == project.id)
        if status:
            stmt = stmt.where(RoadmapItem.status == _validate_status(status))
        if not include_hidden:
            stmt = stmt.where(RoadmapItem.public.is_(True))
        items = _serialize_many(session, session.scalars(stmt).all())
    return jsonify({"items": items})


@bp.post("")
@_public_limit
@require_auth_or_api_key
@require_scope("board:write")
def create_roadmap_item(project_id):
    data = json_body()
    title = (data.get("title") or "").strip()[:140]
    if not title:
        raise ApiError(400, "missing_title", "title is required.")
    status = _validate_status(data.get("status") or "planned")
    description = (data.get("description") or "").strip() or None
    public = bool(data.get("public", True))

    with session_scope() as session:
        project = get_owned_project(session, project_id)
        account = session.get(Account, g.account_id)
        limits = effective_plan_limits(account.plan, str(account.id))
        used = session.scalar(select(func.count(RoadmapItem.id)).where(RoadmapItem.project_id == project.id)) or 0
        if not within_limit(used, limits["roadmap_items_per_project"]):
            raise limit_reached(account, "roadmap_items", "Roadmap item limit reached for your plan.")

        item = RoadmapItem(
            project_id=project.id,
            title=title,
            description=description,
            status=status,
            public=public,
            position=_next_position(session, project.id, status),
            completed_at=datetime.now(timezone.utc) if status == "done" else None,
        )
        session.add(item)
        session.flush()
        audit.record(
            session,
            account_id=g.account_id,
            action="roadmap.create",
            target_type="roadmap_item",
            target_id=str(item.id),
            meta={"title": title, "status": status},
            **actor(),
        )
        session.flush()
        body = serialize_roadmap_item(item, 0)
    return jsonify(body), 201


@bp.patch("/<rid>")
@_public_limit
@require_auth_or_api_key
@require_scope("board:write")
def patch_roadmap_item(project_id, rid):
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        item = get_roadmap_item(session, project, rid)
        fields: list[str] = []

        if "title" in data:
            title = (data.get("title") or "").strip()[:140]
            if not title:
                raise ApiError(400, "missing_title", "title cannot be empty.")
            item.title = title
            fields.append("title")
        if "description" in data:
            item.description = (data.get("description") or "").strip() or None
            fields.append("description")
        if "public" in data:
            item.public = bool(data.get("public"))
            fields.append("public")
        previous_status: str | None = None
        linked_changes: list[tuple] = []
        if "status" in data:
            status = _validate_status(data.get("status"))
            if status != item.status:
                previous_status = item.status
                item.status = status
                item.position = _next_position(session, project.id, status)
                item.completed_at = datetime.now(timezone.utc) if status == "done" else None
                # Linked feedback follows the card (and each change is an event).
                linked = session.scalars(select(FeedbackItem).where(FeedbackItem.roadmap_item_id == item.id)).all()
                for fb in linked:
                    if fb.status != ROADMAP_TO_FEEDBACK[status]:
                        linked_changes.append((fb, fb.status))
                        fb.status = ROADMAP_TO_FEEDBACK[status]
            fields.append("status")

        audit.record(
            session,
            account_id=g.account_id,
            action="roadmap.update",
            target_type="roadmap_item",
            target_id=str(item.id),
            meta={"fields": sorted(set(fields)), "status": item.status},
            **actor(),
        )
        session.flush()
        session.refresh(item)
        count = feedback_counts(session, [item.id]).get(item.id, 0)
        if previous_status is not None:
            emit(session, project, "roadmap.status_changed",
                 {**serialize_roadmap_item(item, count), "previous_status": previous_status})
            for fb, prev in linked_changes:
                session.refresh(fb)
                emit(session, project, "feedback.status_changed", {**serialize_feedback(fb), "previous_status": prev})
        body = serialize_roadmap_item(item, count)
    return jsonify(body)


@bp.put("/reorder")
@_public_limit
@require_auth_or_api_key
@require_scope("board:write")
def reorder(project_id):
    """Rewrite ``position`` for one column. ``ids`` must be exactly that
    column's items (any order), otherwise 400 ``invalid_order``."""
    data = json_body()
    status = _validate_status(data.get("status"))
    raw_ids = data.get("ids")
    if not isinstance(raw_ids, list):
        raise ApiError(400, "invalid_order", "ids must be a list.")
    try:
        ids = [uuid.UUID(str(i)) for i in raw_ids]
    except ValueError:
        raise ApiError(400, "invalid_order", "ids must be UUIDs.")

    with session_scope() as session:
        project = get_owned_project(session, project_id)
        column = session.scalars(
            select(RoadmapItem).where(RoadmapItem.project_id == project.id, RoadmapItem.status == status)
        ).all()
        if sorted(i.id for i in column) != sorted(ids) or len(set(ids)) != len(ids):
            raise ApiError(400, "invalid_order", "ids must be exactly the items of that column.")
        by_id = {i.id: i for i in column}
        for position, item_id in enumerate(ids):
            by_id[item_id].position = position
        audit.record(
            session,
            account_id=g.account_id,
            action="roadmap.reorder",
            target_type="project",
            target_id=str(project.id),
            meta={"status": status, "count": len(ids)},
            **actor(),
        )
        session.flush()
        items = _serialize_many(session, column)
    return jsonify({"items": items})


@bp.delete("/<rid>")
@_public_limit
@require_auth_or_api_key
@require_scope("board:delete")
def delete_roadmap_item(project_id, rid):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        item = get_roadmap_item(session, project, rid)
        audit.record(
            session,
            account_id=g.account_id,
            action="roadmap.delete",
            target_type="roadmap_item",
            target_id=str(item.id),
            meta={"title": item.title, "status": item.status},
            **actor(),
        )
        # Feedback is unlinked by the FK's ON DELETE SET NULL; votes cascade.
        session.delete(item)
    return "", 204

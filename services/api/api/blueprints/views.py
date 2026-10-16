"""Saved views blueprint (``/projects/:id/views``): named inbox filter presets
(Phase 2). Filters are validated against the inbox query parameters so a
stored view can be applied verbatim by the dashboard and the MCP server.
"""
from __future__ import annotations

import uuid

from flask import Blueprint, g, jsonify
from sqlalchemy import func, select

from dbcore.config import config
from dbcore.db import session_scope
from dbcore.feedback import PRIORITIES, SENTIMENTS, STATUSES, TYPES
from dbcore.models import SavedView

from ..auth_utils import require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..serializers import json_body, serialize_saved_view
from .projects import get_owned_project

bp = Blueprint("views", __name__)

_public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)

MAX_VIEWS = 20
_LIST_FILTERS = {"type": TYPES, "status": STATUSES, "sentiment": SENTIMENTS, "priority": PRIORITIES}


def _get_view(session, project, vid: str) -> SavedView:
    try:
        view_id = uuid.UUID(vid)
    except ValueError:
        raise ApiError(404, "not_found", "View not found.")
    view = session.scalar(select(SavedView).where(SavedView.id == view_id, SavedView.project_id == project.id))
    if view is None:
        raise ApiError(404, "not_found", "View not found.")
    return view


def validate_filters(raw) -> dict:
    """Keep only the known inbox filters, normalised to the query-string form."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ApiError(400, "invalid_filters", "filters must be an object.")
    out: dict = {}
    for key, allowed in _LIST_FILTERS.items():
        if key in raw and raw[key] not in (None, "", []):
            values = raw[key] if isinstance(raw[key], list) else str(raw[key]).split(",")
            values = [v.strip() for v in values if v and v.strip()]
            bad = [v for v in values if v not in allowed]
            if bad:
                raise ApiError(400, "invalid_filters", f"{key} must be one of: {', '.join(allowed)}.")
            if values:
                out[key] = ",".join(values)
    if raw.get("q"):
        out["q"] = str(raw["q"]).strip()[:200]
    if raw.get("tag"):
        out["tag"] = str(raw["tag"]).strip().lower()[:40]
    if "has_screenshot" in raw and raw["has_screenshot"] not in (None, ""):
        out["has_screenshot"] = bool(raw["has_screenshot"]) if not isinstance(raw["has_screenshot"], str) else raw["has_screenshot"].lower() in ("true", "1")
    if raw.get("sort"):
        if raw["sort"] not in ("newest", "oldest", "votes"):
            raise ApiError(400, "invalid_filters", "sort must be newest, oldest or votes.")
        out["sort"] = raw["sort"]
    if raw.get("duplicates") in ("hide", "show"):
        out["duplicates"] = raw["duplicates"]
    return out


def _name(raw) -> str:
    name = (raw or "").strip()[:60]
    if not name:
        raise ApiError(400, "missing_name", "name is required.")
    return name


@bp.get("")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:read")
def list_views(project_id):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        rows = session.scalars(
            select(SavedView).where(SavedView.project_id == project.id).order_by(SavedView.position, SavedView.created_at)
        ).all()
        items = [serialize_saved_view(v) for v in rows]
    return jsonify(items)


@bp.post("")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:write")
def create_view(project_id):
    data = json_body()
    name = _name(data.get("name"))
    filters = validate_filters(data.get("filters"))
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        used = session.scalar(select(func.count(SavedView.id)).where(SavedView.project_id == project.id)) or 0
        if used >= MAX_VIEWS:
            raise ApiError(400, "too_many_views", f"A project can have at most {MAX_VIEWS} saved views.")
        last = session.scalar(select(func.max(SavedView.position)).where(SavedView.project_id == project.id))
        view = SavedView(project_id=project.id, name=name, filters=filters, position=(last + 1) if last is not None else 0)
        session.add(view)
        session.flush()
        session.refresh(view)
        body = serialize_saved_view(view)
    return jsonify(body), 201


@bp.patch("/<vid>")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:write")
def patch_view(project_id, vid):
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        view = _get_view(session, project, vid)
        if "name" in data:
            view.name = _name(data.get("name"))
        if "filters" in data:
            view.filters = validate_filters(data.get("filters"))
        if "position" in data:
            try:
                view.position = max(int(data.get("position")), 0)
            except (TypeError, ValueError):
                raise ApiError(400, "invalid_position", "position must be an integer.")
        session.flush()
        session.refresh(view)
        body = serialize_saved_view(view)
    return jsonify(body)


@bp.delete("/<vid>")
@_public_limit
@require_auth_or_api_key
@require_scope("feedback:write")
def delete_view(project_id, vid):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        session.delete(_get_view(session, project, vid))
    return "", 204

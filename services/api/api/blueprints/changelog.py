"""Changelog blueprint (management): release notes behind the public board.

Entries are Markdown. ``published_at`` null means draft: visible here, never
on the public board. Flipping ``published`` is audited as ``changelog.publish``.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from dbcore import audit
from dbcore.config import config
from dbcore.db import session_scope
from dbcore.models import ChangelogEntry, RoadmapItem

from ..auth_utils import actor, require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..serializers import json_body, serialize_changelog_entry
from .projects import get_owned_project

bp = Blueprint("changelog", __name__)

_public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)

MAX_BODY = 50_000


def get_entry(session, project, cid: str) -> ChangelogEntry:
    try:
        entry_id = uuid.UUID(cid)
    except ValueError:
        raise ApiError(404, "not_found", "Changelog entry not found.")
    entry = session.scalar(
        select(ChangelogEntry).where(ChangelogEntry.id == entry_id, ChangelogEntry.project_id == project.id)
    )
    if entry is None:
        raise ApiError(404, "not_found", "Changelog entry not found.")
    return entry


def _ordered(entries: list) -> list:
    """Drafts first (newest first), then published newest first."""
    drafts = sorted((e for e in entries if e.published_at is None), key=lambda e: e.created_at, reverse=True)
    published = sorted((e for e in entries if e.published_at is not None), key=lambda e: e.published_at, reverse=True)
    return drafts + published


def _validate_roadmap_ids(session, project, raw) -> list[str]:
    if not isinstance(raw, list):
        raise ApiError(400, "invalid_roadmap_item_ids", "roadmap_item_ids must be a list of UUIDs.")
    try:
        ids = [uuid.UUID(str(i)) for i in raw]
    except ValueError:
        raise ApiError(400, "invalid_roadmap_item_ids", "roadmap_item_ids must be a list of UUIDs.")
    if ids:
        found = set(
            session.scalars(select(RoadmapItem.id).where(RoadmapItem.project_id == project.id, RoadmapItem.id.in_(ids)))
        )
        if found != set(ids):
            raise ApiError(404, "not_found", "One or more roadmap items were not found.")
    return [str(i) for i in ids]


@bp.get("")
@_public_limit
@require_auth_or_api_key
@require_scope("board:read")
def list_changelog(project_id):
    include_drafts = (request.args.get("include_drafts") or "true").lower() in ("1", "true")
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        stmt = select(ChangelogEntry).where(ChangelogEntry.project_id == project.id)
        if not include_drafts:
            stmt = stmt.where(ChangelogEntry.published_at.is_not(None))
        items = [serialize_changelog_entry(e) for e in _ordered(session.scalars(stmt).all())]
    return jsonify({"items": items})


@bp.post("")
@_public_limit
@require_auth_or_api_key
@require_scope("board:write")
def create_entry(project_id):
    data = json_body()
    title = (data.get("title") or "").strip()[:140]
    body_md = (data.get("body") or "").strip()
    if not title:
        raise ApiError(400, "missing_title", "title is required.")
    if not body_md:
        raise ApiError(400, "missing_body", "body is required.")
    if len(body_md) > MAX_BODY:
        raise ApiError(400, "too_long", f"body must be at most {MAX_BODY} characters.")
    version = (data.get("version") or "").strip()[:60] or None
    publish = bool(data.get("publish", False))

    with session_scope() as session:
        project = get_owned_project(session, project_id)
        entry = ChangelogEntry(
            project_id=project.id,
            title=title,
            body=body_md,
            version=version,
            published_at=datetime.now(timezone.utc) if publish else None,
            roadmap_item_ids=_validate_roadmap_ids(session, project, data.get("roadmap_item_ids") or []),
        )
        session.add(entry)
        session.flush()
        audit.record(
            session,
            account_id=g.account_id,
            action="changelog.create",
            target_type="changelog_entry",
            target_id=str(entry.id),
            meta={"title": title, "version": version, "published": publish},
            **actor(),
        )
        if publish:
            audit.record(
                session, account_id=g.account_id, action="changelog.publish", target_type="changelog_entry",
                target_id=str(entry.id), meta={"title": title, "published": True}, **actor(),
            )
        session.flush()
        body = serialize_changelog_entry(entry)
    return jsonify(body), 201


@bp.patch("/<cid>")
@_public_limit
@require_auth_or_api_key
@require_scope("board:write")
def patch_entry(project_id, cid):
    data = json_body()
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        entry = get_entry(session, project, cid)
        fields: list[str] = []
        flipped: bool | None = None

        if "title" in data:
            title = (data.get("title") or "").strip()[:140]
            if not title:
                raise ApiError(400, "missing_title", "title cannot be empty.")
            entry.title = title
            fields.append("title")
        if "body" in data:
            body_md = (data.get("body") or "").strip()
            if not body_md:
                raise ApiError(400, "missing_body", "body cannot be empty.")
            if len(body_md) > MAX_BODY:
                raise ApiError(400, "too_long", f"body must be at most {MAX_BODY} characters.")
            entry.body = body_md
            fields.append("body")
        if "version" in data:
            entry.version = (data.get("version") or "").strip()[:60] or None
            fields.append("version")
        if "roadmap_item_ids" in data:
            entry.roadmap_item_ids = _validate_roadmap_ids(session, project, data.get("roadmap_item_ids") or [])
            fields.append("roadmap_item_ids")
        if "published" in data:
            want = bool(data.get("published"))
            if want and entry.published_at is None:
                entry.published_at = datetime.now(timezone.utc)
                flipped = True
            elif not want and entry.published_at is not None:
                entry.published_at = None
                flipped = False
            fields.append("published")

        audit.record(
            session,
            account_id=g.account_id,
            action="changelog.update",
            target_type="changelog_entry",
            target_id=str(entry.id),
            meta={"fields": sorted(set(fields))},
            **actor(),
        )
        if flipped is not None:
            audit.record(
                session, account_id=g.account_id, action="changelog.publish", target_type="changelog_entry",
                target_id=str(entry.id), meta={"title": entry.title, "published": flipped}, **actor(),
            )
        session.flush()
        session.refresh(entry)
        body = serialize_changelog_entry(entry)
    return jsonify(body)


@bp.delete("/<cid>")
@_public_limit
@require_auth_or_api_key
@require_scope("board:delete")
def delete_entry(project_id, cid):
    with session_scope() as session:
        project = get_owned_project(session, project_id)
        entry = get_entry(session, project, cid)
        audit.record(
            session,
            account_id=g.account_id,
            action="changelog.delete",
            target_type="changelog_entry",
            target_id=str(entry.id),
            meta={"title": entry.title, "version": entry.version},
            **actor(),
        )
        session.delete(entry)
    return "", 204

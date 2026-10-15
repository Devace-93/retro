"""Boards blueprint (``/boards``): the public roadmap + changelog, no key.

Boards are addressed by the project's globally unique ``board_slug`` and only
answer while the board is enabled (otherwise 404, same as an unknown slug, so
slugs cannot be probed). Votes are anonymous: one per (item, ``voter_id``)
— a UUID the browser keeps in localStorage — and one per (item, ``ip_hash``)
per day. Submissions reuse the ingest pipeline with ``source = "board"``.
"""
from __future__ import annotations

import re
import uuid

from flask import Blueprint, jsonify, request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from dbcore.config import config
from dbcore.db import session_scope
from dbcore.feedback import FeedbackError, normalize_submission
from dbcore.feature_flags import is_enabled
from dbcore.models import ChangelogEntry, Project, RoadmapItem, RoadmapVote
from dbcore.privacy import ip_hash

from ..errors import ApiError
from ..extensions import board_key_func, limiter
from ..serializers import json_or_form_body, serialize_board, serialize_public_changelog_entry
from .ingest import _client_ip, accept_response, fake_accept, honeypot_tripped, store_submission

bp = Blueprint("boards", __name__)

_board_limit = limiter.limit(config.rate_limit_board, key_func=board_key_func)

_VOTER_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def get_public_project(session, slug: str) -> Project:
    """The project behind an enabled board, or 404 (never reveals existence)."""
    project = session.scalar(select(Project).where(Project.board_slug == (slug or "").lower()))
    if project is None or not project.board_enabled or not is_enabled("public-boards", str(project.account_id)):
        raise ApiError(404, "not_found", "Board not found.")
    return project


def _voter_id(data: dict) -> str:
    voter = (data.get("voter_id") or "").strip()
    if not _VOTER_RE.match(voter):
        raise ApiError(400, "invalid_voter_id", "voter_id must be 8-64 URL-safe characters.")
    return voter


def _get_public_item(session, project, rid: str) -> RoadmapItem:
    try:
        item_id = uuid.UUID(rid)
    except ValueError:
        raise ApiError(404, "not_found", "Roadmap item not found.")
    item = session.scalar(
        select(RoadmapItem).where(
            RoadmapItem.id == item_id, RoadmapItem.project_id == project.id, RoadmapItem.public.is_(True)
        )
    )
    if item is None:
        raise ApiError(404, "not_found", "Roadmap item not found.")
    return item


def _recount(session, item: RoadmapItem) -> int:
    item.votes = session.scalar(select(func.count(RoadmapVote.id)).where(RoadmapVote.roadmap_item_id == item.id)) or 0
    return item.votes


@bp.get("/<slug>")
@_board_limit
def get_board(slug):
    with session_scope() as session:
        project = get_public_project(session, slug)
        items = session.scalars(
            select(RoadmapItem)
            .where(RoadmapItem.project_id == project.id, RoadmapItem.public.is_(True))
            .order_by(RoadmapItem.position, RoadmapItem.created_at)
        ).all()
        roadmap: dict = {"planned": [], "in_progress": [], "done": []}
        for item in items:
            roadmap.setdefault(item.status, []).append(item)
        changelog = session.scalars(
            select(ChangelogEntry)
            .where(ChangelogEntry.project_id == project.id, ChangelogEntry.published_at.is_not(None))
            .order_by(ChangelogEntry.published_at.desc())
            .limit(10)
        ).all()
        body = serialize_board(project, roadmap, changelog)
    return jsonify(body)


@bp.get("/<slug>/changelog")
@_board_limit
def board_changelog(slug):
    try:
        page = max(int(request.args.get("page", 1)), 1)
        per_page = min(max(int(request.args.get("per_page", 20)), 1), 100)
    except ValueError:
        page, per_page = 1, 20
    with session_scope() as session:
        project = get_public_project(session, slug)
        base = select(ChangelogEntry).where(
            ChangelogEntry.project_id == project.id, ChangelogEntry.published_at.is_not(None)
        )
        total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = session.scalars(
            base.order_by(ChangelogEntry.published_at.desc()).offset((page - 1) * per_page).limit(per_page)
        ).all()
        items = [serialize_public_changelog_entry(e) for e in rows]
    return jsonify({"items": items, "page": page, "per_page": per_page, "total": total})


@bp.post("/<slug>/items/<rid>/vote")
@_board_limit
def vote(slug, rid):
    data = json_or_form_body()
    voter = _voter_id(data)
    with session_scope() as session:
        project = get_public_project(session, slug)
        if not project.allow_votes:
            raise ApiError(403, "votes_disabled", "Voting is disabled on this board.")
        item = _get_public_item(session, project, rid)
        address = ip_hash(_client_ip())

        already = session.scalar(
            select(RoadmapVote.id).where(RoadmapVote.roadmap_item_id == item.id, RoadmapVote.voter_id == voter)
        )
        if already is None and address is not None:
            # One vote per address per day: the hash is daily-salted, so any
            # existing row with the same hash is from today.
            same_address = session.scalar(
                select(RoadmapVote.id).where(RoadmapVote.roadmap_item_id == item.id, RoadmapVote.ip_hash == address)
            )
            if same_address is not None:
                already = same_address
        if already is None:
            try:
                with session.begin_nested():
                    session.add(RoadmapVote(roadmap_item_id=item.id, voter_id=voter, ip_hash=address))
                    session.flush()
            except IntegrityError:
                pass  # concurrent duplicate: idempotent
        votes = _recount(session, item)
    return jsonify({"votes": votes, "voted": True})


@bp.delete("/<slug>/items/<rid>/vote")
@_board_limit
def unvote(slug, rid):
    data = json_or_form_body()
    voter = _voter_id(data)
    with session_scope() as session:
        project = get_public_project(session, slug)
        if not project.allow_votes:
            raise ApiError(403, "votes_disabled", "Voting is disabled on this board.")
        item = _get_public_item(session, project, rid)
        row = session.scalar(
            select(RoadmapVote).where(RoadmapVote.roadmap_item_id == item.id, RoadmapVote.voter_id == voter)
        )
        if row is not None:
            session.delete(row)
            session.flush()
        votes = _recount(session, item)
    return jsonify({"votes": votes, "voted": False})


@bp.post("/<slug>/feedback")
@_board_limit
def board_feedback(slug):
    """Submit an idea from the public board. Same body as the ingest endpoint
    minus ``project_key``; ``type`` defaults to ``feature``."""
    data = json_or_form_body()
    with session_scope() as session:
        project = get_public_project(session, slug)
        if not is_enabled("ingest-api", str(project.account_id)):
            raise ApiError(503, "feature_disabled", "'ingest-api' is not available.")
        if not project.allow_board_submissions:
            raise ApiError(403, "submissions_disabled", "This board does not accept submissions.")
        if honeypot_tripped(data):
            return fake_accept()
        try:
            sub = normalize_submission(data, project, default_type="feature")
            item, dropped = store_submission(session, project, sub, source="board")
        except FeedbackError as err:
            raise ApiError(400, err.code, err.message)
        session.flush()
        response = accept_response(item, project, dropped)
    return response

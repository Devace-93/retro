"""Duplicate detection (Phase 2) on top of the ``pg_trgm`` extension.

At ingest time the new message is compared with the project's items of the
last 90 days (same type, not declined) using trigram similarity. The top 3
matches at or above :data:`THRESHOLD` are stored on the item as
``similar_ids`` so the dashboard and the MCP server can show "possible
duplicates" without recomputing anything.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .models import FeedbackItem

THRESHOLD = 0.45
WINDOW_DAYS = 90
LIMIT = 3


def find_similar(session: Session, project_id, type_: str, message: str, exclude_id=None) -> list[dict]:
    """``[{id, number, similarity}]`` ordered by similarity, best first."""
    if not message.strip():
        return []
    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    # The `%` operator is what the GIN trigram index serves; the threshold is
    # a session setting, so pin it for this transaction only (set_config with
    # is_local=true == SET LOCAL, but it accepts a bind parameter).
    session.execute(
        text("SELECT set_config('pg_trgm.similarity_threshold', :t, true)").bindparams(t=str(THRESHOLD))
    )
    sim = func.similarity(FeedbackItem.message, message)
    stmt = (
        select(FeedbackItem.id, FeedbackItem.number, sim)
        .where(
            FeedbackItem.project_id == project_id,
            FeedbackItem.type == type_,
            FeedbackItem.status != "declined",
            FeedbackItem.created_at >= since,
            FeedbackItem.message.op("%")(message),
        )
        .order_by(sim.desc(), FeedbackItem.created_at.desc())
        .limit(LIMIT + 1)
    )
    rows = session.execute(stmt).all()
    out = []
    for item_id, number, similarity in rows:
        if exclude_id is not None and item_id == exclude_id:
            continue
        if similarity is None or similarity < THRESHOLD:
            continue
        out.append({"id": str(item_id), "number": number, "similarity": round(float(similarity), 3)})
    return out[:LIMIT]

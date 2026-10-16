"""Webhook event emission (Phase 2).

``emit(session, project, event, data)`` fans one event out to every enabled
webhook of the project subscribed to it, as outbox jobs in the caller's
transaction. The payload shape is the one in CONTRACT.md; ``data`` is the
already-serialized object (FeedbackItem without notes, RoadmapItem,
ChangelogEntry) plus event-specific extras such as ``previous_status``.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .feature_flags import is_enabled
from .models import Project, Webhook
from .outbox import enqueue_webhook


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_payload(project: Project, event: str, data: dict, delivery_id: str | None = None) -> dict:
    return {
        "id": delivery_id or str(uuid.uuid4()),
        "event": event,
        "created_at": _iso(datetime.now(timezone.utc)),
        "project": {"id": str(project.id), "key": project.key, "name": project.name},
        "data": data,
    }


def subscribed_webhooks(session: Session, project: Project, event: str) -> list[Webhook]:
    hooks = session.scalars(
        select(Webhook).where(Webhook.project_id == project.id, Webhook.enabled.is_(True))
    ).all()
    return [h for h in hooks if not h.events or event in h.events]


def emit(session: Session, project: Project, event: str, data: dict) -> int:
    """Queue ``event`` for every subscribed webhook. Returns how many."""
    if not is_enabled("webhooks", str(project.account_id)):
        return 0
    count = 0
    for hook in subscribed_webhooks(session, project, event):
        delivery = enqueue_webhook(session, hook, event, {})
        delivery.payload = build_payload(project, event, data, str(delivery.id))
        count += 1
    return count

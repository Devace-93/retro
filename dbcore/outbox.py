"""Transactional outbox: enqueue side effects inside the caller's transaction.

Three producers (all called from API views, inside ``session_scope``):

* :func:`enqueue_digest_item` — a new submission joins the project's pending
  digest mail (one job per (account, project); created when none is pending,
  due after ``email_digest_minutes``; 0 = due now, one mail per item).
* :func:`enqueue_reply` — one mail to the reporter (and watchers) for a reply note.
* :func:`enqueue_webhook` — one delivery row + one job per subscribed webhook.

The consumer is ``dbcore.worker``. Jobs are plain rows, so a crash between
the business write and the side effect is impossible: either both commit or
neither does.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import config
from .feature_flags import is_enabled
from .models import Account, FeedbackItem, FeedbackNote, Outbox, Project, Webhook, WebhookDelivery

WEBHOOK_EVENTS = (
    "feedback.created",
    "feedback.status_changed",
    "roadmap.status_changed",
    "changelog.published",
    "ping",
)
WEBHOOK_SECRET_PREFIX = "whsec_"


def now() -> datetime:
    return datetime.now(timezone.utc)


def mail_available(account_id) -> bool:
    """Mail is usable when the feature is on AND SMTP is configured."""
    return is_enabled("mail", str(account_id)) and bool(config.mail_enabled and config.smtp_url)


# --------------------------------------------------------------------------- #
# Digests
# --------------------------------------------------------------------------- #
def enqueue_digest_item(session: Session, account: Account, project: Project, item: FeedbackItem) -> Outbox | None:
    """Add ``item`` to the pending digest of (account, project), creating the
    job when none is pending. Returns the job, or None when notifications are
    off or mail is not available (nothing is queued then: no silent backlog)."""
    if not account.email_new_feedback or not mail_available(account.id):
        return None
    pending = session.scalar(
        select(Outbox)
        .where(
            Outbox.kind == "email",
            Outbox.status == "pending",
            Outbox.account_id == account.id,
            Outbox.project_id == project.id,
            Outbox.payload["template"].astext == "digest",
        )
        .with_for_update()
    )
    if pending is not None:
        ids = list(pending.payload.get("item_ids") or [])
        ids.append(str(item.id))
        pending.payload = {**pending.payload, "item_ids": ids}
        return pending
    minutes = max(int(account.email_digest_minutes or 0), 0)
    job = Outbox(
        kind="email",
        account_id=account.id,
        project_id=project.id,
        payload={"template": "digest", "project_id": str(project.id), "item_ids": [str(item.id)]},
        next_attempt_at=now() + timedelta(minutes=minutes),
    )
    session.add(job)
    session.flush()
    return job


# --------------------------------------------------------------------------- #
# Replies
# --------------------------------------------------------------------------- #
def enqueue_reply(session: Session, account: Account, item: FeedbackItem, note: FeedbackNote, reply_to: str | None) -> Outbox:
    job = Outbox(
        kind="email",
        account_id=account.id,
        project_id=item.project_id,
        payload={
            "template": "reply",
            "feedback_id": str(item.id),
            "note_id": str(note.id),
            "reply_to": reply_to,
        },
        next_attempt_at=now(),
    )
    session.add(job)
    session.flush()
    note.outbox_id = job.id
    note.delivery = "pending"
    return job


# --------------------------------------------------------------------------- #
# Webhooks
# --------------------------------------------------------------------------- #
def generate_webhook_secret() -> tuple[str, str]:
    secret = WEBHOOK_SECRET_PREFIX + secrets.token_urlsafe(32)
    return secret, secret[: len(WEBHOOK_SECRET_PREFIX) + 6]


def enqueue_webhook(session: Session, webhook: Webhook, event: str, payload: dict) -> WebhookDelivery:
    """One delivery row + one outbox job for ``webhook``."""
    delivery = WebhookDelivery(webhook_id=webhook.id, event=event, payload=payload)
    session.add(delivery)
    session.flush()
    job = Outbox(
        kind="webhook",
        account_id=webhook.project.account_id,
        project_id=webhook.project_id,
        payload={"delivery_id": str(delivery.id), "webhook_id": str(webhook.id), "event": event},
        next_attempt_at=now(),
    )
    session.add(job)
    session.flush()
    delivery.outbox_id = job.id
    return delivery

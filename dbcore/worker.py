"""Outbox worker: delivers the side effects the API queued (mail, webhooks).

    python -m dbcore.worker          # loop forever (compose `worker` service)
    python -m dbcore.worker --once   # drain every due job, then exit (tests)

Claiming is ``SELECT … FOR UPDATE SKIP LOCKED`` on one due row, so several
workers can run side by side without double delivery. A job is processed
outside the claiming transaction (an HTTP call must not hold a row lock);
its outcome is written in a second short transaction.

Retry policy: exponential backoff 1 min → 2 min → 4 min … capped at 2 h, at
most 8 attempts, then ``failed`` (kept 7 days with the last error, like
``sent`` rows, for inspection).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib import error, request

from sqlalchemy import delete, select, text

from . import models  # noqa: F401  (register models)
from .config import config
from .db import session_scope
from .mail import MailError, is_enabled as mail_is_enabled, send as send_mail
from .models import Account, FeedbackItem, FeedbackNote, Membership, Outbox, Project, User, Webhook, WebhookDelivery

log = logging.getLogger("retro.worker")

MAX_ATTEMPTS = 8
BACKOFF_BASE_SECONDS = 60
BACKOFF_CAP_SECONDS = 2 * 60 * 60
RETENTION_DAYS = 7


class JobFailed(Exception):
    """Transient failure: retry later (unless attempts are exhausted)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(BACKOFF_BASE_SECONDS * (2 ** max(attempts - 1, 0)), BACKOFF_CAP_SECONDS))


# --------------------------------------------------------------------------- #
# Claiming
# --------------------------------------------------------------------------- #
def claim_one() -> dict | None:
    """Mark one due job ``sending`` and return a detached copy of it."""
    with session_scope() as session:
        job = session.scalar(
            select(Outbox)
            .where(Outbox.status == "pending", Outbox.next_attempt_at <= _now())
            .order_by(Outbox.next_attempt_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if job is None:
            return None
        job.status = "sending"
        job.attempts = (job.attempts or 0) + 1
        session.flush()
        return {
            "id": job.id,
            "kind": job.kind,
            "account_id": job.account_id,
            "project_id": job.project_id,
            "payload": dict(job.payload or {}),
            "attempts": job.attempts,
        }


def finish(job_id, *, status: str, error_text: str | None = None, attempts: int = 0) -> None:
    with session_scope() as session:
        job = session.get(Outbox, job_id)
        if job is None:
            return
        job.status = status
        job.last_error = (error_text or None) and error_text[:500]
        if status == "sent" or status == "skipped":
            job.sent_at = _now()
        elif status == "pending":
            job.next_attempt_at = _now() + backoff(attempts)


# --------------------------------------------------------------------------- #
# Email jobs
# --------------------------------------------------------------------------- #
def _owner_email(session, account_id) -> str | None:
    row = session.execute(
        select(User.email)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.account_id == account_id, Membership.role == "owner")
        .order_by(Membership.created_at)
        .limit(1)
    ).first()
    return row[0] if row else None


def _inbox_url(project_id, number: int | None = None) -> str:
    base = f"{config.app_base_url.rstrip('/')}/dashboard/projects/{project_id}"
    return f"{base}?item={number}" if number else base


def _item_line(item: FeedbackItem) -> str:
    kind = item.type if item.type != "feedback" else f"feedback ({item.sentiment or 'neutral'})"
    page = f"  ·  {item.page_url}" if item.page_url else ""
    return f"#{item.number} [{kind}] {item.title}{page}"


def process_digest(job: dict) -> str:
    payload = job["payload"]
    with session_scope() as session:
        account = session.get(Account, job["account_id"])
        project = session.get(Project, uuid.UUID(payload["project_id"]))
        if account is None or project is None:
            return "skipped"
        if not account.email_new_feedback:
            return "skipped"
        to = _owner_email(session, account.id)
        if not to:
            return "skipped"
        ids = [uuid.UUID(i) for i in payload.get("item_ids", [])]
        items = session.scalars(
            select(FeedbackItem).where(FeedbackItem.id.in_(ids)).order_by(FeedbackItem.number)
        ).all() if ids else []
        if not items:
            return "skipped"
        n = len(items)
        subject = f"[retro] {n} new feedback item{'s' if n != 1 else ''} in {project.name}"
        lines = [f"{n} new item{'s' if n != 1 else ''} arrived in {project.name}:", ""]
        lines += [_item_line(i) for i in items]
        lines += ["", f"Open the inbox: {_inbox_url(project.id)}", "",
                  "You receive this because new-feedback notifications are on for your retro account.",
                  f"Change that at {config.app_base_url.rstrip('/')}/dashboard/settings"]
        text_body = "\n".join(lines)
        html_items = "".join(
            f'<li><a href="{_inbox_url(project.id, i.number)}">#{i.number}</a> '
            f'<small>[{i.type}{(" · " + i.sentiment) if i.sentiment else ""}]</small> {_esc(i.title)}'
            f'{(" <small>· " + _esc(i.page_url) + "</small>") if i.page_url else ""}</li>'
            for i in items
        )
        html_body = (
            f"<p>{n} new item{'s' if n != 1 else ''} arrived in <strong>{_esc(project.name)}</strong>:</p>"
            f"<ul>{html_items}</ul><p><a href=\"{_inbox_url(project.id)}\">Open the inbox</a></p>"
            f"<p style=\"color:#64748b;font-size:12px\">You receive this because new-feedback notifications are on "
            f"for your retro account. <a href=\"{config.app_base_url.rstrip('/')}/dashboard/settings\">Change that</a>.</p>"
        )
    try:
        return send_mail(to=[to], subject=subject, text=text_body, html=html_body)
    except MailError as err:
        raise JobFailed(str(err)) from err


def process_reply(job: dict) -> str:
    payload = job["payload"]
    with session_scope() as session:
        item = session.get(FeedbackItem, uuid.UUID(payload["feedback_id"]))
        note = session.get(FeedbackNote, uuid.UUID(payload["note_id"]))
        if item is None or note is None:
            return "skipped"
        project = session.get(Project, item.project_id)
        recipients = [item.reporter_email] + [w for w in (item.watchers or []) if isinstance(w, str)]
        recipients = list(dict.fromkeys(r for r in recipients if r))
        subject = f"Re: #{item.number} {item.title}"
        quoted = "\n".join("> " + line for line in item.message.splitlines())
        text_body = f"{note.body}\n\n---\nYou wrote (#{item.number} on {project.name}):\n{quoted}\n"
        html_body = (
            f"<div style=\"white-space:pre-wrap\">{_esc(note.body)}</div><hr>"
            f"<p style=\"color:#64748b\">You wrote (#{item.number} on {_esc(project.name)}):</p>"
            f"<blockquote style=\"color:#64748b;border-left:3px solid #e2e8f0;margin:0;padding-left:12px;"
            f"white-space:pre-wrap\">{_esc(item.message)}</blockquote>"
        )
        reply_to = payload.get("reply_to")
    try:
        result = send_mail(to=recipients, subject=subject, text=text_body, html=html_body, reply_to=reply_to)
    except MailError as err:
        _set_note_delivery(payload["note_id"], "pending" if job["attempts"] < MAX_ATTEMPTS else "failed")
        raise JobFailed(str(err)) from err
    _set_note_delivery(payload["note_id"], result)
    return result


def _set_note_delivery(note_id: str, state: str) -> None:
    with session_scope() as session:
        note = session.get(FeedbackNote, uuid.UUID(note_id))
        if note is not None:
            note.delivery = state


def _esc(value: str | None) -> str:
    return (value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# --------------------------------------------------------------------------- #
# Webhook jobs
# --------------------------------------------------------------------------- #
def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def deliver_webhook(url: str, secret: str, event: str, delivery_id: str, payload: dict) -> int:
    """POST the signed payload. Returns the HTTP status; raises JobFailed on
    network errors / non-2xx."""
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    req = request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Retro-Event": event,
            "X-Retro-Delivery": delivery_id,
            "X-Retro-Signature": sign(secret, body),
            "User-Agent": "retro-webhooks/1",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=config.webhook_timeout_seconds) as resp:
            status = resp.status
    except error.HTTPError as err:
        raise JobFailed(f"HTTP {err.code}") from err
    except (error.URLError, OSError, ValueError) as err:
        raise JobFailed(str(getattr(err, "reason", err))) from err
    if not 200 <= status < 300:
        raise JobFailed(f"HTTP {status}")
    return status


def process_webhook(job: dict) -> str:
    payload = job["payload"]
    with session_scope() as session:
        delivery = session.get(WebhookDelivery, uuid.UUID(payload["delivery_id"]))
        hook = session.get(Webhook, uuid.UUID(payload["webhook_id"]))
        if delivery is None or hook is None:
            return "skipped"
        if not hook.enabled and delivery.event != "ping":
            delivery.status = "failed"
            delivery.last_error = "webhook disabled"
            return "skipped"
        url, secret, event, body = hook.url, hook.secret, delivery.event, dict(delivery.payload or {})
        delivery_id = str(delivery.id)
        delivery.attempts = job["attempts"]
    try:
        status = deliver_webhook(url, secret, event, delivery_id, body)
    except JobFailed as err:
        code = None
        if str(err).startswith("HTTP "):
            try:
                code = int(str(err)[5:])
            except ValueError:
                code = None
        final = job["attempts"] >= MAX_ATTEMPTS
        with session_scope() as session:
            delivery = session.get(WebhookDelivery, uuid.UUID(delivery_id))
            hook = session.get(Webhook, uuid.UUID(payload["webhook_id"]))
            if delivery is not None:
                delivery.status = "failed" if final else "pending"
                delivery.response_code = code
                delivery.last_error = str(err)[:500]
            if hook is not None:
                hook.last_delivery_at = _now()
                hook.last_status = "failed"
        raise
    with session_scope() as session:
        delivery = session.get(WebhookDelivery, uuid.UUID(delivery_id))
        hook = session.get(Webhook, uuid.UUID(payload["webhook_id"]))
        if delivery is not None:
            delivery.status = "delivered"
            delivery.response_code = status
            delivery.last_error = None
            delivery.delivered_at = _now()
        if hook is not None:
            hook.last_delivery_at = _now()
            hook.last_status = "delivered"
    return "sent"


# --------------------------------------------------------------------------- #
# Dispatch
# --------------------------------------------------------------------------- #
def process(job: dict) -> str:
    if job["kind"] == "email":
        template = job["payload"].get("template")
        if not mail_is_enabled():
            if template == "reply":
                _set_note_delivery(job["payload"]["note_id"], "skipped")
            return "skipped"
        if template == "digest":
            return process_digest(job)
        if template == "reply":
            return process_reply(job)
        return "skipped"
    if job["kind"] == "webhook":
        return process_webhook(job)
    return "skipped"


def run_job(job: dict) -> str:
    try:
        result = process(job)
    except JobFailed as err:
        if job["attempts"] >= MAX_ATTEMPTS:
            log.error("job %s failed permanently after %d attempts: %s", job["id"], job["attempts"], err)
            finish(job["id"], status="failed", error_text=str(err), attempts=job["attempts"])
            return "failed"
        log.warning("job %s attempt %d failed, retrying: %s", job["id"], job["attempts"], err)
        finish(job["id"], status="pending", error_text=str(err), attempts=job["attempts"])
        return "retry"
    except Exception as err:  # pragma: no cover - programming error: do not retry forever
        log.exception("job %s crashed", job["id"])
        finish(job["id"], status="failed", error_text=f"{type(err).__name__}: {err}", attempts=job["attempts"])
        return "failed"
    finish(job["id"], status=result, attempts=job["attempts"])
    return result


def cleanup() -> int:
    """Drop sent/skipped/failed rows older than the retention window."""
    cutoff = _now() - timedelta(days=RETENTION_DAYS)
    with session_scope() as session:
        result = session.execute(
            delete(Outbox).where(Outbox.status.in_(("sent", "skipped", "failed")), Outbox.created_at < cutoff)
        )
        # A job claimed by a worker that died stays `sending` forever; release
        # it after an hour so it gets retried.
        session.execute(
            text(
                "UPDATE outbox SET status = 'pending', next_attempt_at = now() "
                "WHERE status = 'sending' AND next_attempt_at < now() - interval '1 hour'"
            )
        )
        return result.rowcount or 0


def drain(limit: int = 1000) -> dict:
    """Process every due job once (used by ``--once`` and tests)."""
    counts: dict[str, int] = {}
    for _ in range(limit):
        job = claim_one()
        if job is None:
            break
        outcome = run_job(job)
        counts[outcome] = counts.get(outcome, 0) + 1
    return counts


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    once = "--once" in argv
    log.info("retro outbox worker starting (mail %s, poll %.0fs)", "on" if mail_is_enabled() else "off", config.worker_poll_seconds)
    if once:
        counts = drain()
        log.info("drained: %s", counts or "nothing due")
        return 0
    last_cleanup = 0.0
    while True:
        try:
            counts = drain(limit=100)
            if counts:
                log.info("processed: %s", counts)
            if time.time() - last_cleanup > 3600:
                cleanup()
                last_cleanup = time.time()
        except Exception:  # pragma: no cover - keep the loop alive
            log.exception("worker loop error")
        time.sleep(config.worker_poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

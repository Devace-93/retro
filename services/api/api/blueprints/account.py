"""Account blueprint: usage counters, the audit log and (Phase 2) the
notification settings.

Every endpoint accepts a dashboard JWT or an API key with the matching scope.
"""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request
from sqlalchemy import select

from dbcore.config import config
from dbcore.db import session_scope
from dbcore import audit
from dbcore.models import Account, AuditEvent, Membership, User
from dbcore.plans import effective_plan_limits
from dbcore.usage import attachment_bytes, get_or_create_counter

from ..auth_utils import actor, require_auth_or_api_key, require_scope
from ..errors import ApiError
from ..extensions import limiter, public_api_key_func
from ..serializers import json_body, serialize_audit_event, serialize_notifications, serialize_usage
from .auth import account_counts

bp = Blueprint("account", __name__)

_public_limit = limiter.limit(config.rate_limit_public_api, key_func=public_api_key_func)


@bp.get("/usage")
@_public_limit
@require_auth_or_api_key
@require_scope("usage:read")
def usage():
    with session_scope() as session:
        account = session.get(Account, g.account_id)
        if account is None:
            raise ApiError(404, "not_found", "Account not found.")
        limits = effective_plan_limits(account.plan, str(account.id))
        counter = get_or_create_counter(session, account.id)
        body = serialize_usage(counter, limits, account_counts(session, account.id), attachment_bytes(session, account.id))
    return jsonify(body)


@bp.get("/audit")
@_public_limit
@require_auth_or_api_key
@require_scope("audit:read")
def audit_log():
    """Most recent audit events for the account (newest first)."""
    try:
        limit = int(request.args.get("limit", 50))
    except ValueError:
        limit = 50
    limit = min(max(limit, 1), 200)
    action = (request.args.get("action") or "").strip()

    with session_scope() as session:
        stmt = select(AuditEvent).where(AuditEvent.account_id == g.account_id)
        if action:
            stmt = stmt.where(AuditEvent.action == action)
        rows = session.scalars(stmt.order_by(AuditEvent.ts.desc()).limit(limit)).all()
        items = [serialize_audit_event(r) for r in rows]
    return jsonify({"items": items, "limit": limit})


# --------------------------------------------------------------------------- #
# Notifications (Phase 2)
# --------------------------------------------------------------------------- #
DIGEST_CHOICES = (0, 15, 60, 1440)


def owner_email(session, account_id) -> str | None:
    """Email of the account's (first) owner: where digests go."""
    row = session.execute(
        select(User.email)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.account_id == account_id, Membership.role == "owner")
        .order_by(Membership.created_at)
        .limit(1)
    ).first()
    return row[0] if row else None


@bp.get("/notifications")
@_public_limit
@require_auth_or_api_key
@require_scope("usage:read")
def get_notifications():
    with session_scope() as session:
        account = session.get(Account, g.account_id)
        if account is None:
            raise ApiError(404, "not_found", "Account not found.")
        body = serialize_notifications(account, owner_email(session, account.id))
    return jsonify(body)


@bp.patch("/notifications")
@_public_limit
@require_auth_or_api_key
@require_scope("projects:write")
def patch_notifications():
    data = json_body()
    with session_scope() as session:
        account = session.get(Account, g.account_id)
        if account is None:
            raise ApiError(404, "not_found", "Account not found.")
        fields = []
        if "email_new_feedback" in data:
            account.email_new_feedback = bool(data.get("email_new_feedback"))
            fields.append("email_new_feedback")
        if "email_digest_minutes" in data:
            try:
                minutes = int(data.get("email_digest_minutes"))
            except (TypeError, ValueError):
                minutes = -1
            if minutes not in DIGEST_CHOICES:
                raise ApiError(400, "invalid_digest", f"email_digest_minutes must be one of {list(DIGEST_CHOICES)}.")
            account.email_digest_minutes = minutes
            fields.append("email_digest_minutes")
        audit.record(
            session, account_id=account.id, action="account.notifications", target_type="account",
            target_id=str(account.id), meta={"fields": fields}, **actor(),
        )
        session.flush()
        body = serialize_notifications(account, owner_email(session, account.id))
    return jsonify(body)

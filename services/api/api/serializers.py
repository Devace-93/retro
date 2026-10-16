"""Pure functions that turn ORM rows into JSON-safe dicts (and one helper for
the opposite direction, ``json_body``).

Centralising serialization keeps the wire format (the CONTRACT.md shapes)
consistent across every blueprint.
"""
from __future__ import annotations

from datetime import datetime, timezone

from flask import request

from dbcore.config import config

from .errors import ApiError


def iso(dt: datetime | None) -> str | None:
    """UTC ISO-8601 with a trailing ``Z`` (or None). Naive datetimes are
    assumed to already be UTC (Postgres timestamptz comes back tz-aware)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def json_body() -> dict:
    """The request's JSON object, or ``{}`` for an empty body. A body that is
    valid JSON but not an object is a 400 rather than a 500 downstream."""
    data = request.get_json(silent=True)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_body", "Request body must be a JSON object.")
    return data


def json_or_form_body() -> dict:
    """JSON object when the request is JSON, otherwise the form fields (ingest
    accepts ``application/x-www-form-urlencoded`` so a plain ``<form>`` works)."""
    if request.is_json:
        return json_body()
    if request.form:
        return {k: v for k, v in request.form.items()}
    # Some clients post JSON without the content type; try anyway.
    data = request.get_json(silent=True, force=True)
    if isinstance(data, dict):
        return data
    return {}


def board_url(project) -> str | None:
    """Public board URL, or None while the board is disabled."""
    if not project.board_enabled:
        return None
    return f"{config.app_base_url.rstrip('/')}/b/{project.board_slug}"


def serialize_user(user) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "email_verified": user.email_verified_at is not None,
        "created_at": iso(user.created_at),
    }


def serialize_account(account) -> dict:
    return {
        "id": str(account.id),
        "name": account.name,
        "plan": account.plan,
        "created_at": iso(account.created_at),
    }


def serialize_project(project, counts: dict | None = None) -> dict:
    """Exactly the CONTRACT.md "Project" shape (owner-only: includes the public key)."""
    counts = counts or {}
    return {
        "id": str(project.id),
        "key": project.key,
        "name": project.name,
        "description": project.description,
        "url": project.url,
        "public_key": project.public_key,
        "public_key_prefix": project.public_key_prefix,
        "board_slug": project.board_slug,
        "board_enabled": project.board_enabled,
        "board_url": board_url(project),
        "board_title": project.board_title,
        "board_intro": project.board_intro,
        "allow_votes": project.allow_votes,
        "allow_board_submissions": project.allow_board_submissions,
        "types_enabled": list(project.types_enabled or []),
        "allow_screenshots": project.allow_screenshots,
        "allow_email": project.allow_email,
        "widget_accent": project.widget_accent,
        "turnstile_site_key": project.turnstile_site_key,
        "turnstile_enabled": bool(project.turnstile_site_key and project.turnstile_secret),
        "counts": {
            "feedback": counts.get("feedback", 0),
            "new": counts.get("new", 0),
            "roadmap": counts.get("roadmap", 0),
        },
        "created_at": iso(project.created_at),
        "updated_at": iso(project.updated_at),
    }


def serialize_note(note) -> dict:
    author = None
    if note.author is not None:
        author = {"id": str(note.author.id), "email": note.author.email}
    elif note.author_label:
        author = {"id": None, "email": None, "label": note.author_label}
    return {
        "id": str(note.id),
        "body": note.body,
        "author": author,
        "kind": note.kind or "note",
        "delivery": note.delivery if (note.kind or "note") == "reply" else None,
        "created_at": iso(note.created_at),
    }


def serialize_feedback(item, *, with_notes: bool = False, similar: list | None = None) -> dict:
    """Exactly the CONTRACT.md "FeedbackItem" shape. ``notes`` and ``similar``
    only on detail (``similar`` is resolved by the caller from ``similar_ids``)."""
    attachment = item.attachment
    body = {
        "id": str(item.id),
        "project_id": str(item.project_id),
        "number": item.number,
        "type": item.type,
        "sentiment": item.sentiment,
        "title": item.title,
        "message": item.message,
        "status": item.status,
        "priority": item.priority,
        "tags": list(item.tags or []),
        "reporter_email": item.reporter_email,
        "reporter_id": item.reporter_id,
        "page_url": item.page_url,
        "app_version": item.app_version,
        "locale": item.locale,
        "user_agent": item.user_agent,
        "metadata": item.metadata_ or {},
        "source": item.source,
        "has_screenshot": attachment is not None,
        "screenshot": (
            {
                "content_type": attachment.content_type,
                "size": attachment.size,
                "width": attachment.width,
                "height": attachment.height,
            }
            if attachment is not None
            else None
        ),
        "roadmap_item_id": str(item.roadmap_item_id) if item.roadmap_item_id else None,
        "duplicate_of": str(item.duplicate_of) if item.duplicate_of else None,
        "created_at": iso(item.created_at),
        "updated_at": iso(item.updated_at),
    }
    if with_notes:
        body["notes"] = [serialize_note(n) for n in item.notes]
        body["similar"] = similar if similar is not None else []
        body["watchers"] = list(item.watchers or [])
    return body


def serialize_similar(items_by_id: dict, similar_ids: list) -> list[dict]:
    """``[{id, number, title, status, similarity}]`` from the stored
    ``similar_ids`` and the matching rows (missing rows were deleted)."""
    out = []
    for entry in similar_ids or []:
        row = items_by_id.get(str(entry.get("id")))
        if row is None:
            continue
        out.append(
            {
                "id": str(row.id),
                "number": row.number,
                "title": row.title,
                "status": row.status,
                "similarity": entry.get("similarity"),
            }
        )
    return out


def serialize_roadmap_item(item, feedback_count: int = 0) -> dict:
    return {
        "id": str(item.id),
        "project_id": str(item.project_id),
        "title": item.title,
        "description": item.description,
        "status": item.status,
        "position": item.position,
        "public": item.public,
        "votes": item.votes,
        "feedback_count": feedback_count,
        "completed_at": iso(item.completed_at),
        "created_at": iso(item.created_at),
        "updated_at": iso(item.updated_at),
    }


def serialize_public_roadmap_item(item) -> dict:
    return {
        "id": str(item.id),
        "title": item.title,
        "description": item.description,
        "status": item.status,
        "votes": item.votes,
        "completed_at": iso(item.completed_at),
    }


def serialize_changelog_entry(entry) -> dict:
    return {
        "id": str(entry.id),
        "project_id": str(entry.project_id),
        "title": entry.title,
        "body": entry.body,
        "version": entry.version,
        "published_at": iso(entry.published_at),
        "roadmap_item_ids": list(entry.roadmap_item_ids or []),
        "created_at": iso(entry.created_at),
        "updated_at": iso(entry.updated_at),
    }


def serialize_public_changelog_entry(entry) -> dict:
    return {
        "id": str(entry.id),
        "title": entry.title,
        "body": entry.body,
        "version": entry.version,
        "published_at": iso(entry.published_at),
    }


def serialize_widget_config(project, features: dict) -> dict:
    """Exactly the CONTRACT.md "WidgetConfig" shape (what the widget boots with)."""
    screenshots = bool(features.get("screenshots", True))
    boards = bool(features.get("public-boards", True))
    return {
        "project": {"name": project.name, "url": project.url},
        "types_enabled": list(project.types_enabled or []),
        "allow_screenshots": project.allow_screenshots and screenshots,
        "allow_email": project.allow_email,
        "accent": project.widget_accent,
        "board_url": board_url(project) if boards else None,
        "turnstile_site_key": turnstile_site_key(project),
        "features": {"screenshots": screenshots, "public_boards": boards},
    }


def turnstile_site_key(project) -> str | None:
    """The public site key, only when the secret is configured too (both are
    needed for verification to actually run)."""
    return project.turnstile_site_key if project.turnstile_site_key and project.turnstile_secret else None


def serialize_board(project, roadmap: dict, changelog: list) -> dict:
    """Exactly the CONTRACT.md "Board" shape (public, no secrets)."""
    return {
        "project": {
            "name": project.name,
            "url": project.url,
            "board_title": project.board_title or project.name,
            "board_intro": project.board_intro,
        },
        "roadmap": {
            status: [serialize_public_roadmap_item(i) for i in roadmap.get(status, [])]
            for status in ("planned", "in_progress", "done")
        },
        "changelog": [serialize_public_changelog_entry(e) for e in changelog],
        "can_submit": project.allow_board_submissions,
        "can_vote": project.allow_votes,
        "types_enabled": list(project.types_enabled or []),
        "turnstile_site_key": turnstile_site_key(project),
    }


def serialize_api_key(api_key) -> dict:
    """Never includes the secret — only the non-sensitive prefix."""
    return {
        "id": str(api_key.id),
        "name": api_key.name,
        "prefix": api_key.prefix,
        "role": api_key.role,
        "last_used_at": iso(api_key.last_used_at),
        "created_at": iso(api_key.created_at),
    }


def serialize_usage(counter, limits: dict, counts: dict, attachment_bytes: int = 0) -> dict:
    return {
        "period_start": counter.period_start.isoformat(),
        "period_end": counter.period_end.isoformat(),
        "feedback": counter.feedback,
        "attachment_bytes": attachment_bytes,
        "counts": counts,
        "limits": limits,
    }


def serialize_webhook(hook, secret: str | None = None) -> dict:
    """The secret is only present on creation."""
    body = {
        "id": str(hook.id),
        "url": hook.url,
        "events": list(hook.events or []),
        "description": hook.description,
        "enabled": hook.enabled,
        "secret_prefix": hook.secret_prefix,
        "last_delivery_at": iso(hook.last_delivery_at),
        "last_status": hook.last_status,
        "created_at": iso(hook.created_at),
    }
    if secret is not None:
        body["secret"] = secret
    return body


def serialize_delivery(delivery) -> dict:
    return {
        "id": str(delivery.id),
        "event": delivery.event,
        "status": delivery.status,
        "attempts": delivery.attempts,
        "response_code": delivery.response_code,
        "last_error": delivery.last_error,
        "created_at": iso(delivery.created_at),
        "delivered_at": iso(delivery.delivered_at),
    }


def serialize_saved_view(view) -> dict:
    return {
        "id": str(view.id),
        "name": view.name,
        "filters": dict(view.filters or {}),
        "position": view.position,
        "created_at": iso(view.created_at),
    }


def serialize_notifications(account, email: str | None) -> dict:
    return {
        "email_new_feedback": account.email_new_feedback,
        "email_digest_minutes": account.email_digest_minutes,
        "email": email,
    }


def serialize_audit_event(event) -> dict:
    return {
        "id": str(event.id),
        "ts": iso(event.ts),
        "actor_type": event.actor_type,
        "actor_id": str(event.actor_id) if event.actor_id else None,
        "actor_label": event.actor_label,
        "action": event.action,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "outcome": event.outcome,
        "meta": event.meta or {},
    }

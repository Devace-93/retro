"""Feedback domain helpers shared by the ingest, board and management views.

* the closed vocabularies (types, sentiments, statuses, priorities, sources)
  and the roadmap -> feedback status mapping from CONTRACT.md;
* input normalisation for a submission (``normalize_submission``), with the
  size caps the contract lists; it raises :class:`FeedbackError` so the API
  layer can turn it into a 400 with a stable code;
* per-project numbering (``next_number``) done under a row lock on the
  project so two concurrent submissions never share a ``#number``;
* screenshot decoding (``decode_screenshot``): data URL -> bytes + dimensions,
  via Pillow, enforcing the size cap and the allowed formats.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import config
from .models import Project

TYPES = ("bug", "feedback", "feature")
SENTIMENTS = ("positive", "negative", "neutral")
STATUSES = ("new", "triaged", "planned", "in_progress", "done", "declined")
PRIORITIES = ("none", "low", "medium", "high")
SOURCES = ("api", "widget", "board")
ROADMAP_STATUSES = ("planned", "in_progress", "done")

MAX_MESSAGE = 5000
MAX_TITLE = 140
DERIVED_TITLE = 80
MAX_EMAIL = 255
MAX_REPORTER_ID = 120
MAX_PAGE_URL = 2048
MAX_APP_VERSION = 60
MAX_LOCALE = 16
MAX_USER_AGENT = 255
MAX_METADATA_BYTES = 8 * 1024
MAX_TAGS = 20
MAX_TAG_LEN = 40

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DATA_URL_RE = re.compile(r"^data:(image/(?:png|jpeg|webp));base64,(.+)$", re.S)
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class FeedbackError(ValueError):
    """Validation failure with a stable error code (``400`` at the API layer)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def is_hex_color(value: str) -> bool:
    return bool(_HEX_COLOR_RE.match(value or ""))


def derive_title(message: str) -> str:
    """First line of the message, truncated to :data:`DERIVED_TITLE` chars."""
    first = (message.strip().splitlines() or [""])[0].strip()
    if len(first) <= DERIVED_TITLE:
        return first or "Untitled"
    return first[: DERIVED_TITLE - 1].rstrip() + "…"


def clean_tags(raw) -> list[str]:
    """Normalise a tag list: strings, trimmed, lowercased, de-duplicated, capped."""
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [t for t in raw.split(",")]
    if not isinstance(raw, list):
        raise FeedbackError("invalid_tags", "tags must be a list of strings.")
    out: list[str] = []
    for tag in raw:
        if not isinstance(tag, str):
            raise FeedbackError("invalid_tags", "tags must be a list of strings.")
        tag = tag.strip().lower()[:MAX_TAG_LEN]
        if tag and tag not in out:
            out.append(tag)
    return out[:MAX_TAGS]


def _opt_str(value, max_len: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:max_len] if text else None


def parse_metadata(raw) -> dict:
    """``metadata`` as a dict (form posts send a JSON string); capped at 8 KB."""
    if raw is None or raw == "":
        return {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise FeedbackError("invalid_metadata", "metadata must be a JSON object.")
    if not isinstance(raw, dict):
        raise FeedbackError("invalid_metadata", "metadata must be a JSON object.")
    if len(json.dumps(raw, separators=(",", ":")).encode()) > MAX_METADATA_BYTES:
        raise FeedbackError("metadata_too_large", "metadata must be at most 8 KB of JSON.")
    return raw


@dataclass
class Submission:
    type: str
    sentiment: str | None
    title: str
    message: str
    reporter_email: str | None
    reporter_id: str | None
    page_url: str | None
    app_version: str | None
    locale: str | None
    metadata: dict
    screenshot_data_url: str | None


def normalize_submission(data: dict, project: Project, *, default_type: str | None = None) -> Submission:
    """Validate an ingest/board body against the contract and the project's
    settings. ``data`` is the parsed JSON object or the form dict."""
    type_ = (data.get("type") or default_type or "").strip().lower()
    if type_ not in TYPES or type_ not in (project.types_enabled or TYPES):
        raise FeedbackError("invalid_type", f"type must be one of: {', '.join(project.types_enabled or TYPES)}.")

    message = (data.get("message") or "").strip()
    if not message:
        raise FeedbackError("missing_message", "message is required.")
    if len(message) > MAX_MESSAGE:
        raise FeedbackError("too_long", f"message must be at most {MAX_MESSAGE} characters.")

    title = (data.get("title") or "").strip()
    if len(title) > MAX_TITLE:
        raise FeedbackError("too_long", f"title must be at most {MAX_TITLE} characters.")
    title = title or derive_title(message)

    sentiment = (data.get("sentiment") or "").strip().lower() or None
    if type_ != "feedback":
        sentiment = None
    elif sentiment is not None and sentiment not in SENTIMENTS:
        raise FeedbackError("invalid_sentiment", f"sentiment must be one of: {', '.join(SENTIMENTS)}.")

    email = _opt_str(data.get("email"), MAX_EMAIL) if project.allow_email else None
    if email is not None and not _EMAIL_RE.match(email):
        raise FeedbackError("invalid_email", "email does not look like an email address.")

    screenshot = data.get("screenshot") or None
    if screenshot is not None and not isinstance(screenshot, str):
        raise FeedbackError("invalid_screenshot", "screenshot must be a data URL string.")

    return Submission(
        type=type_,
        sentiment=sentiment,
        title=title,
        message=message,
        reporter_email=email,
        reporter_id=_opt_str(data.get("reporter_id"), MAX_REPORTER_ID),
        page_url=_opt_str(data.get("page_url"), MAX_PAGE_URL),
        app_version=_opt_str(data.get("app_version"), MAX_APP_VERSION),
        locale=_opt_str(data.get("locale"), MAX_LOCALE),
        metadata=parse_metadata(data.get("metadata")),
        screenshot_data_url=screenshot,
    )


def next_number(session: Session, project_id) -> int:
    """Allocate the next per-project feedback number.

    Locks the project row (``SELECT … FOR UPDATE``) for the rest of the
    transaction, so concurrent submissions serialise on the counter and the
    ``(project_id, number)`` unique constraint never trips.
    """
    project = session.scalar(select(Project).where(Project.id == project_id).with_for_update())
    project.last_feedback_number = (project.last_feedback_number or 0) + 1
    session.flush()
    return project.last_feedback_number


@dataclass
class DecodedImage:
    content_type: str
    data: bytes
    size: int
    width: int | None
    height: int | None
    sha256: str


def decode_screenshot(data_url: str) -> DecodedImage:
    """Decode a ``data:image/(png|jpeg|webp);base64,…`` URL.

    Raises :class:`FeedbackError` ``invalid_screenshot`` for anything that is
    not a well-formed image of an allowed type, and ``screenshot_too_large``
    when the decoded bytes exceed ``MAX_SCREENSHOT_BYTES``. The size check runs
    on the base64 length first so a huge payload is rejected before decoding.
    """
    match = _DATA_URL_RE.match(data_url.strip())
    if not match:
        raise FeedbackError("invalid_screenshot", "screenshot must be a data:image/(png|jpeg|webp);base64 URL.")
    content_type, b64 = match.group(1), match.group(2)
    # 4 base64 chars -> 3 bytes; reject early without decoding.
    if len(b64) * 3 // 4 > config.max_screenshot_bytes + 3:
        raise FeedbackError("screenshot_too_large", f"screenshot must be at most {config.max_screenshot_bytes} bytes.")
    try:
        raw = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError):
        raise FeedbackError("invalid_screenshot", "screenshot is not valid base64.")
    if len(raw) > config.max_screenshot_bytes:
        raise FeedbackError("screenshot_too_large", f"screenshot must be at most {config.max_screenshot_bytes} bytes.")

    width = height = None
    try:
        from PIL import Image

        with Image.open(io.BytesIO(raw)) as img:
            img.verify()
        with Image.open(io.BytesIO(raw)) as img:
            width, height = img.size
            fmt = (img.format or "").lower()
        detected = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}.get(fmt)
        if detected is None:
            raise FeedbackError("invalid_screenshot", "screenshot must be a PNG, JPEG or WebP image.")
        content_type = detected  # trust the bytes, not the declared type
    except FeedbackError:
        raise
    except Exception:
        raise FeedbackError("invalid_screenshot", "screenshot could not be decoded as an image.")

    return DecodedImage(
        content_type=content_type,
        data=raw,
        size=len(raw),
        width=width,
        height=height,
        sha256=hashlib.sha256(raw).hexdigest(),
    )

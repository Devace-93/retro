"""SQLAlchemy models — the canonical data model for retro.

Tenancy: an Account is the billing entity. Users join accounts via Memberships.
Product hierarchy: Account -> Project -> FeedbackItem (+ FeedbackNote, one
Attachment), RoadmapItem (+ RoadmapVote), ChangelogEntry. Deleting a project
cascades everything under it (Postgres ``ON DELETE CASCADE``), so the API never
has to clean up by hand.

Secrets (API keys, refresh tokens) are stored as sha256 hashes plus a short
non-sensitive prefix; the plaintext is shown once. A project's *public key*
(``retro_pub_…``) is not a secret — it ships inside the widget snippet — so it
is stored in plaintext as well (``Project.public_key``) and the owner can read
it back at any time; the hash column is what ingest requests are matched on.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)


# --------------------------------------------------------------------------- #
# Tenancy / auth
# --------------------------------------------------------------------------- #
class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # current effective plan: free | pro | team | enterprise | selfhost
    plan: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    memberships: Mapped[list["Membership"]] = relationship(back_populates="account")
    projects: Mapped[list["Project"]] = relationship(back_populates="account")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    memberships: Mapped[list["Membership"]] = relationship(back_populates="user")


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("account_id", "user_id", name="uq_membership"),)

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="owner")  # owner|admin|member
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    account: Mapped[Account] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), unique=True, index=True
    )
    rc_app_user_id: Mapped[str | None] = mapped_column(String(255), index=True)
    entitlement: Mapped[str | None] = mapped_column(String(20))   # pro | team
    product_id: Mapped[str | None] = mapped_column(String(120))
    period: Mapped[str | None] = mapped_column(String(12))        # monthly | annual
    status: Mapped[str | None] = mapped_column(String(30))        # active | expired | ...
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    will_renew: Mapped[bool] = mapped_column(Boolean, default=True)
    raw_payload: Mapped[dict | None] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# --------------------------------------------------------------------------- #
# Product: projects, feedback, boards
# --------------------------------------------------------------------------- #
class Project(Base):
    """One project per host app. Owns the public key the app posts feedback
    with, and the settings of its public board (``/b/<board_slug>``)."""

    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("account_id", "key", name="uq_project_account_key"),
        Index("ix_projects_account_created", "account_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(63), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(2048))

    # Public (ingest) key. Plaintext is kept because it is not a secret; the
    # hash is the lookup column for ingest requests. Rotation replaces all three.
    public_key: Mapped[str] = mapped_column(String(64), nullable=False)
    public_key_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    public_key_prefix: Mapped[str] = mapped_column(String(16), nullable=False)

    # Public board (roadmap + changelog). The slug is GLOBALLY unique because
    # boards live at /b/<slug> without an account segment.
    board_slug: Mapped[str] = mapped_column(String(63), nullable=False, unique=True, index=True)
    board_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    board_title: Mapped[str | None] = mapped_column(String(120))
    board_intro: Mapped[str | None] = mapped_column(Text)
    allow_votes: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    allow_board_submissions: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    # Widget / ingest settings.
    types_enabled: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=lambda: ["bug", "feedback", "feature"],
        server_default='["bug", "feedback", "feature"]',
    )
    allow_screenshots: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    allow_email: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    widget_accent: Mapped[str | None] = mapped_column(String(9))  # "#rrggbb"

    # Last per-project feedback number handed out (see dbcore.feedback.next_number).
    last_feedback_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    account: Mapped[Account] = relationship(back_populates="projects")
    feedback_items: Mapped[list["FeedbackItem"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    roadmap_items: Mapped[list["RoadmapItem"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    changelog_entries: Mapped[list["ChangelogEntry"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )


class RoadmapItem(Base):
    """A card on the project's public roadmap. Feedback items can be linked to
    one (``FeedbackItem.roadmap_item_id``); end users vote on public ones."""

    __tablename__ = "roadmap_items"
    __table_args__ = (Index("ix_roadmap_items_project_status", "project_id", "status", "position"),)

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(140), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="planned")  # planned|in_progress|done
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # Denormalised vote count (kept in sync by the boards blueprint).
    votes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="roadmap_items")
    feedback_items: Mapped[list["FeedbackItem"]] = relationship(back_populates="roadmap_item")
    vote_rows: Mapped[list["RoadmapVote"]] = relationship(
        back_populates="roadmap_item", cascade="all, delete-orphan", passive_deletes=True
    )


class RoadmapVote(Base):
    """One anonymous vote. ``voter_id`` is a UUID the browser keeps in
    localStorage; ``ip_hash`` (daily salted) limits one vote per address per day."""

    __tablename__ = "roadmap_votes"
    __table_args__ = (
        UniqueConstraint("roadmap_item_id", "voter_id", name="uq_roadmap_vote_voter"),
        Index("ix_roadmap_votes_item_ip", "roadmap_item_id", "ip_hash"),
    )

    id: Mapped[uuid.UUID] = _pk()
    roadmap_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roadmap_items.id", ondelete="CASCADE"), nullable=False
    )
    voter_id: Mapped[str] = mapped_column(String(64), nullable=False)
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    roadmap_item: Mapped[RoadmapItem] = relationship(back_populates="vote_rows")


class FeedbackItem(Base):
    """One submission from an end user (bug report, feedback, feature request)."""

    __tablename__ = "feedback_items"
    __table_args__ = (
        UniqueConstraint("project_id", "number", name="uq_feedback_project_number"),
        Index("ix_feedback_project_created", "project_id", "created_at"),
        Index("ix_feedback_project_status", "project_id", "status"),
    )

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)          # per-project, 1-based, shown as #123
    type: Mapped[str] = mapped_column(String(10), nullable=False)          # bug | feedback | feature
    sentiment: Mapped[str | None] = mapped_column(String(10))              # positive | negative | neutral
    title: Mapped[str] = mapped_column(String(140), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="new", server_default="new")
    priority: Mapped[str] = mapped_column(String(8), nullable=False, default="none", server_default="none")
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    reporter_email: Mapped[str | None] = mapped_column(String(255))
    reporter_id: Mapped[str | None] = mapped_column(String(120))
    page_url: Mapped[str | None] = mapped_column(String(2048))
    app_version: Mapped[str | None] = mapped_column(String(60))
    locale: Mapped[str | None] = mapped_column(String(16))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict, server_default="{}")
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="api", server_default="api")  # api|widget|board
    # Daily-salted hash of the reporter's address; never the address itself.
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    roadmap_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("roadmap_items.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="feedback_items")
    roadmap_item: Mapped[RoadmapItem | None] = relationship(back_populates="feedback_items")
    notes: Mapped[list["FeedbackNote"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", passive_deletes=True,
        order_by="FeedbackNote.created_at",
    )
    attachment: Mapped["Attachment | None"] = relationship(
        back_populates="item", cascade="all, delete-orphan", passive_deletes=True, uselist=False
    )


class FeedbackNote(Base):
    """Internal note by a dashboard user on a feedback item (never public)."""

    __tablename__ = "feedback_notes"

    id: Mapped[uuid.UUID] = _pk()
    feedback_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("feedback_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # API-key authors have no user; keep a label (key prefix) for display.
    author_label: Mapped[str | None] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    item: Mapped[FeedbackItem] = relationship(back_populates="notes")
    author: Mapped[User | None] = relationship()


class Attachment(Base):
    """The (single) screenshot of a feedback item, stored inline in Postgres.

    Inline bytes keep self-hosting a one-container affair; the per-account
    ``attachment_storage_mb`` cap (``dbcore.usage.attachment_bytes``) bounds
    the table. ``account_id`` is denormalised so that cap is one indexed SUM.
    """

    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = _pk()
    feedback_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("feedback_items.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content_type: Mapped[str] = mapped_column(String(40), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    item: Mapped[FeedbackItem] = relationship(back_populates="attachment")


class ChangelogEntry(Base):
    """A release note. ``published_at`` null = draft (dashboard only)."""

    __tablename__ = "changelog_entries"
    __table_args__ = (Index("ix_changelog_project_published", "project_id", "published_at"),)

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(140), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)       # Markdown (safe subset rendered client-side)
    version: Mapped[str | None] = mapped_column(String(60))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    roadmap_item_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="changelog_entries")


# --------------------------------------------------------------------------- #
# Metering, keys, billing, audit
# --------------------------------------------------------------------------- #
class UsageCounter(Base):
    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("account_id", "period_start", name="uq_usage_period"),)

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    # Accepted feedback submissions (ingest + board) this period. Soft limit.
    feedback: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # set once when the feedback limit is first hit in a period (for one-shot PostHog event)
    feedback_limit_notified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    # RBAC role: viewer | editor | admin (see packages/shared/api_key_roles.json).
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="editor", server_default="editor")
    prefix: Mapped[str] = mapped_column(String(16), index=True)        # shown in UI, e.g. retro_live_AbCd
    key_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id: Mapped[uuid.UUID] = _pk()
    provider: Mapped[str] = mapped_column(String(40), default="revenuecat")
    event_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    type: Mapped[str | None] = mapped_column(String(60))
    payload: Mapped[dict | None] = mapped_column(JSONB)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditEvent(Base):
    """Append-only audit trail (see dbcore/audit.py). Never updated or deleted
    by application code; retention is an ops concern."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_account_ts", "account_id", "ts"),)

    id: Mapped[uuid.UUID] = _pk()
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(20), nullable=False)     # user | api_key | system
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # user id or api key id
    actor_label: Mapped[str | None] = mapped_column(String(120))            # e.g. key prefix
    action: Mapped[str] = mapped_column(String(60), nullable=False)         # feedback.update, auth.denied, ...
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(20), nullable=False, default="ok", server_default="ok")  # ok | denied | error
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")

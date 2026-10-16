"""Phase 2: outbox, webhooks, saved views, notifications, replies, duplicates, Turnstile.

Idempotent like 0001: `python -m dbcore.cli upgrade` runs `create_all` first,
so the new tables usually exist already and only the new columns on existing
tables (and the pg_trgm extension + trigram indexes) are added here.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-15
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _create_table(name: str, *args, **kwargs) -> None:
    if not _inspector().has_table(name):
        op.create_table(name, *args, **kwargs)


def _create_index(index_name: str, table_name: str, *args, **kwargs) -> None:
    existing = {ix["name"] for ix in _inspector().get_indexes(table_name)}
    existing |= {uc["name"] for uc in _inspector().get_unique_constraints(table_name)}
    if index_name not in existing:
        op.create_index(index_name, table_name, *args, **kwargs)


def _add_column(table_name: str, column: sa.Column) -> None:
    existing = {c["name"] for c in _inspector().get_columns(table_name)}
    if column.name not in existing:
        op.add_column(table_name, column)


def _add_fk(name: str, source: str, referent: str, local_cols, remote_cols, **kwargs) -> None:
    # Match on the constrained columns, not the name: create_all names the
    # same constraint differently when it builds a fresh database.
    for fk in _inspector().get_foreign_keys(source):
        if list(fk["constrained_columns"]) == list(local_cols):
            return
    op.create_foreign_key(name, source, referent, local_cols, remote_cols, **kwargs)


def upgrade() -> None:
    # --- extension + trigram indexes (duplicate detection) ---
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE INDEX IF NOT EXISTS ix_feedback_items_message_trgm ON feedback_items USING gin (message gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_feedback_items_title_trgm ON feedback_items USING gin (title gin_trgm_ops)")

    # --- accounts: notification settings ---
    _add_column('accounts', sa.Column('email_new_feedback', sa.Boolean(), server_default='true', nullable=False))
    _add_column('accounts', sa.Column('email_digest_minutes', sa.Integer(), server_default='60', nullable=False))

    # --- projects: Turnstile ---
    _add_column('projects', sa.Column('turnstile_site_key', sa.String(length=120), nullable=True))
    _add_column('projects', sa.Column('turnstile_secret', sa.String(length=120), nullable=True))

    # --- feedback_items: duplicates + watchers ---
    _add_column('feedback_items', sa.Column('similar_ids', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    _add_column('feedback_items', sa.Column('duplicate_of', sa.UUID(), nullable=True))
    _add_column('feedback_items', sa.Column('watchers', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    _add_fk('fk_feedback_items_duplicate_of', 'feedback_items', 'feedback_items', ['duplicate_of'], ['id'], ondelete='SET NULL')
    _create_index(op.f('ix_feedback_items_duplicate_of'), 'feedback_items', ['duplicate_of'], unique=False)

    # --- feedback_notes: replies ---
    _add_column('feedback_notes', sa.Column('kind', sa.String(length=10), server_default='note', nullable=False))
    _add_column('feedback_notes', sa.Column('delivery', sa.String(length=10), nullable=True))
    _add_column('feedback_notes', sa.Column('outbox_id', sa.UUID(), nullable=True))

    # --- new tables ---
    _create_table('webhooks',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('url', sa.String(length=2048), nullable=False),
    sa.Column('events', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('description', sa.String(length=200), nullable=True),
    sa.Column('enabled', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('secret', sa.String(length=80), nullable=False),
    sa.Column('secret_prefix', sa.String(length=16), nullable=False),
    sa.Column('last_delivery_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_status', sa.String(length=10), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_webhooks_project_id'), 'webhooks', ['project_id'], unique=False)

    _create_table('webhook_deliveries',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('webhook_id', sa.UUID(), nullable=False),
    sa.Column('event', sa.String(length=40), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('status', sa.String(length=10), server_default='pending', nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('response_code', sa.Integer(), nullable=True),
    sa.Column('last_error', sa.String(length=500), nullable=True),
    sa.Column('outbox_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['webhook_id'], ['webhooks.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index('ix_webhook_deliveries_webhook_created', 'webhook_deliveries', ['webhook_id', 'created_at'], unique=False)

    _create_table('saved_views',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('filters', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('position', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_saved_views_project_id'), 'saved_views', ['project_id'], unique=False)

    _create_table('outbox',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('status', sa.String(length=10), server_default='pending', nullable=False),
    sa.Column('last_error', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_outbox_account_id'), 'outbox', ['account_id'], unique=False)
    _create_index(op.f('ix_outbox_project_id'), 'outbox', ['project_id'], unique=False)
    _create_index('ix_outbox_status_due', 'outbox', ['status', 'next_attempt_at'], unique=False)


def downgrade() -> None:
    op.drop_table('outbox')
    op.drop_table('saved_views')
    op.drop_table('webhook_deliveries')
    op.drop_table('webhooks')
    op.drop_column('feedback_notes', 'outbox_id')
    op.drop_column('feedback_notes', 'delivery')
    op.drop_column('feedback_notes', 'kind')
    op.drop_index(op.f('ix_feedback_items_duplicate_of'), table_name='feedback_items')
    op.drop_column('feedback_items', 'watchers')
    op.drop_column('feedback_items', 'duplicate_of')
    op.drop_column('feedback_items', 'similar_ids')
    op.drop_column('projects', 'turnstile_secret')
    op.drop_column('projects', 'turnstile_site_key')
    op.drop_column('accounts', 'email_digest_minutes')
    op.drop_column('accounts', 'email_new_feedback')
    op.execute("DROP INDEX IF EXISTS ix_feedback_items_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_feedback_items_message_trgm")

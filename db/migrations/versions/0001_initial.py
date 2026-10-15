"""Initial schema: the whole retro data model.

Idempotent on purpose: `python -m dbcore.cli upgrade` runs `create_all` first,
so every table/index is skipped when it already exists (fresh installs) and
created otherwise (databases that only ever ran Alembic).

Revision ID: 0001
Revises: 
Create Date: 2026-10-15 15:37:26.251826
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0001'
down_revision: Union[str, None] = None
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


def upgrade() -> None:
    _create_table('accounts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('plan', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    _create_table('users',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    _create_table('webhook_events',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('provider', sa.String(length=40), nullable=False),
    sa.Column('event_id', sa.String(length=255), nullable=False),
    sa.Column('type', sa.String(length=60), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('received_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_webhook_events_event_id'), 'webhook_events', ['event_id'], unique=True)
    _create_table('api_keys',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('role', sa.String(length=20), server_default='editor', nullable=False),
    sa.Column('prefix', sa.String(length=16), nullable=False),
    sa.Column('key_hash', sa.String(length=128), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_api_keys_account_id'), 'api_keys', ['account_id'], unique=False)
    _create_index(op.f('ix_api_keys_key_hash'), 'api_keys', ['key_hash'], unique=True)
    _create_index(op.f('ix_api_keys_prefix'), 'api_keys', ['prefix'], unique=False)
    _create_table('audit_events',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('ts', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('actor_type', sa.String(length=20), nullable=False),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('actor_label', sa.String(length=120), nullable=True),
    sa.Column('action', sa.String(length=60), nullable=False),
    sa.Column('target_type', sa.String(length=40), nullable=True),
    sa.Column('target_id', sa.String(length=64), nullable=True),
    sa.Column('outcome', sa.String(length=20), server_default='ok', nullable=False),
    sa.Column('meta', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index('ix_audit_events_account_ts', 'audit_events', ['account_id', 'ts'], unique=False)
    _create_table('memberships',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('account_id', 'user_id', name='uq_membership')
    )
    _create_table('projects',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('key', sa.String(length=63), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('url', sa.String(length=2048), nullable=True),
    sa.Column('public_key', sa.String(length=64), nullable=False),
    sa.Column('public_key_hash', sa.String(length=128), nullable=False),
    sa.Column('public_key_prefix', sa.String(length=16), nullable=False),
    sa.Column('board_slug', sa.String(length=63), nullable=False),
    sa.Column('board_enabled', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('board_title', sa.String(length=120), nullable=True),
    sa.Column('board_intro', sa.Text(), nullable=True),
    sa.Column('allow_votes', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('allow_board_submissions', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('types_enabled', postgresql.JSONB(astext_type=sa.Text()), server_default='["bug", "feedback", "feature"]', nullable=False),
    sa.Column('allow_screenshots', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('allow_email', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('widget_accent', sa.String(length=9), nullable=True),
    sa.Column('last_feedback_number', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('account_id', 'key', name='uq_project_account_key')
    )
    _create_index('ix_projects_account_created', 'projects', ['account_id', 'created_at'], unique=False)
    _create_index(op.f('ix_projects_board_slug'), 'projects', ['board_slug'], unique=True)
    _create_index(op.f('ix_projects_public_key_hash'), 'projects', ['public_key_hash'], unique=True)
    _create_table('refresh_tokens',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('token_hash', sa.String(length=128), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_refresh_tokens_token_hash'), 'refresh_tokens', ['token_hash'], unique=True)
    _create_index(op.f('ix_refresh_tokens_user_id'), 'refresh_tokens', ['user_id'], unique=False)
    _create_table('subscriptions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('rc_app_user_id', sa.String(length=255), nullable=True),
    sa.Column('entitlement', sa.String(length=20), nullable=True),
    sa.Column('product_id', sa.String(length=120), nullable=True),
    sa.Column('period', sa.String(length=12), nullable=True),
    sa.Column('status', sa.String(length=30), nullable=True),
    sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=True),
    sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('will_renew', sa.Boolean(), nullable=False),
    sa.Column('raw_payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_subscriptions_account_id'), 'subscriptions', ['account_id'], unique=True)
    _create_index(op.f('ix_subscriptions_rc_app_user_id'), 'subscriptions', ['rc_app_user_id'], unique=False)
    _create_table('usage_counters',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('period_start', sa.Date(), nullable=False),
    sa.Column('period_end', sa.Date(), nullable=False),
    sa.Column('feedback', sa.Integer(), server_default='0', nullable=False),
    sa.Column('feedback_limit_notified', sa.Boolean(), server_default='false', nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('account_id', 'period_start', name='uq_usage_period')
    )
    _create_index(op.f('ix_usage_counters_account_id'), 'usage_counters', ['account_id'], unique=False)
    _create_table('changelog_entries',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=140), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('version', sa.String(length=60), nullable=True),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('roadmap_item_ids', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index('ix_changelog_project_published', 'changelog_entries', ['project_id', 'published_at'], unique=False)
    _create_table('roadmap_items',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=140), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('position', sa.Integer(), server_default='0', nullable=False),
    sa.Column('public', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('votes', sa.Integer(), server_default='0', nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_roadmap_items_project_id'), 'roadmap_items', ['project_id'], unique=False)
    _create_index('ix_roadmap_items_project_status', 'roadmap_items', ['project_id', 'status', 'position'], unique=False)
    _create_table('feedback_items',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=10), nullable=False),
    sa.Column('sentiment', sa.String(length=10), nullable=True),
    sa.Column('title', sa.String(length=140), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=12), server_default='new', nullable=False),
    sa.Column('priority', sa.String(length=8), server_default='none', nullable=False),
    sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('reporter_email', sa.String(length=255), nullable=True),
    sa.Column('reporter_id', sa.String(length=120), nullable=True),
    sa.Column('page_url', sa.String(length=2048), nullable=True),
    sa.Column('app_version', sa.String(length=60), nullable=True),
    sa.Column('locale', sa.String(length=16), nullable=True),
    sa.Column('user_agent', sa.String(length=255), nullable=True),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('source', sa.String(length=10), server_default='api', nullable=False),
    sa.Column('ip_hash', sa.String(length=64), nullable=True),
    sa.Column('roadmap_item_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['roadmap_item_id'], ['roadmap_items.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'number', name='uq_feedback_project_number')
    )
    _create_index(op.f('ix_feedback_items_roadmap_item_id'), 'feedback_items', ['roadmap_item_id'], unique=False)
    _create_index('ix_feedback_project_created', 'feedback_items', ['project_id', 'created_at'], unique=False)
    _create_index('ix_feedback_project_status', 'feedback_items', ['project_id', 'status'], unique=False)
    _create_table('roadmap_votes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('roadmap_item_id', sa.UUID(), nullable=False),
    sa.Column('voter_id', sa.String(length=64), nullable=False),
    sa.Column('ip_hash', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['roadmap_item_id'], ['roadmap_items.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('roadmap_item_id', 'voter_id', name='uq_roadmap_vote_voter')
    )
    _create_index('ix_roadmap_votes_item_ip', 'roadmap_votes', ['roadmap_item_id', 'ip_hash'], unique=False)
    _create_table('attachments',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('feedback_id', sa.UUID(), nullable=False),
    sa.Column('account_id', sa.UUID(), nullable=False),
    sa.Column('content_type', sa.String(length=40), nullable=False),
    sa.Column('size', sa.BigInteger(), nullable=False),
    sa.Column('width', sa.Integer(), nullable=True),
    sa.Column('height', sa.Integer(), nullable=True),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('data', sa.LargeBinary(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['feedback_id'], ['feedback_items.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('feedback_id')
    )
    _create_index(op.f('ix_attachments_account_id'), 'attachments', ['account_id'], unique=False)
    _create_table('feedback_notes',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('feedback_id', sa.UUID(), nullable=False),
    sa.Column('author_user_id', sa.UUID(), nullable=True),
    sa.Column('author_label', sa.String(length=120), nullable=True),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['author_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['feedback_id'], ['feedback_items.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    _create_index(op.f('ix_feedback_notes_feedback_id'), 'feedback_notes', ['feedback_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_feedback_notes_feedback_id'), table_name='feedback_notes')
    op.drop_table('feedback_notes')
    op.drop_index(op.f('ix_attachments_account_id'), table_name='attachments')
    op.drop_table('attachments')
    op.drop_index('ix_roadmap_votes_item_ip', table_name='roadmap_votes')
    op.drop_table('roadmap_votes')
    op.drop_index('ix_feedback_project_status', table_name='feedback_items')
    op.drop_index('ix_feedback_project_created', table_name='feedback_items')
    op.drop_index(op.f('ix_feedback_items_roadmap_item_id'), table_name='feedback_items')
    op.drop_table('feedback_items')
    op.drop_index('ix_roadmap_items_project_status', table_name='roadmap_items')
    op.drop_index(op.f('ix_roadmap_items_project_id'), table_name='roadmap_items')
    op.drop_table('roadmap_items')
    op.drop_index('ix_changelog_project_published', table_name='changelog_entries')
    op.drop_table('changelog_entries')
    op.drop_index(op.f('ix_usage_counters_account_id'), table_name='usage_counters')
    op.drop_table('usage_counters')
    op.drop_index(op.f('ix_subscriptions_rc_app_user_id'), table_name='subscriptions')
    op.drop_index(op.f('ix_subscriptions_account_id'), table_name='subscriptions')
    op.drop_table('subscriptions')
    op.drop_index(op.f('ix_refresh_tokens_user_id'), table_name='refresh_tokens')
    op.drop_index(op.f('ix_refresh_tokens_token_hash'), table_name='refresh_tokens')
    op.drop_table('refresh_tokens')
    op.drop_index(op.f('ix_projects_public_key_hash'), table_name='projects')
    op.drop_index(op.f('ix_projects_board_slug'), table_name='projects')
    op.drop_index('ix_projects_account_created', table_name='projects')
    op.drop_table('projects')
    op.drop_table('memberships')
    op.drop_index('ix_audit_events_account_ts', table_name='audit_events')
    op.drop_table('audit_events')
    op.drop_index(op.f('ix_api_keys_prefix'), table_name='api_keys')
    op.drop_index(op.f('ix_api_keys_key_hash'), table_name='api_keys')
    op.drop_index(op.f('ix_api_keys_account_id'), table_name='api_keys')
    op.drop_table('api_keys')
    op.drop_index(op.f('ix_webhook_events_event_id'), table_name='webhook_events')
    op.drop_table('webhook_events')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_table('accounts')

/** Shared API shapes (mirror of CONTRACT.md). */

/** The local mirror of an accounts.3m4.net identity (see CONTRACT.md "Auth"). */
export interface User {
  id: string;
  identity_id: string;
  email: string;
  email_verified: boolean;
  handle: string;
  name: string | null;
  avatar_url: string | null;
  created_at?: string;
}

export type PlanKey = "free" | "pro" | "team" | "enterprise" | "selfhost";

export interface Account {
  id: string;
  name: string;
  plan: PlanKey;
  created_at?: string;
}

/** One entry of packages/shared/plan_limits.json; -1 means unlimited. */
export interface Limits {
  projects: number;
  api_keys: number;
  feedback_per_month: number;
  attachment_storage_mb: number;
  roadmap_items_per_project: number;
  webhooks_per_project?: number;
  audit_retention_days: number;
  max_users: number;
  api?: string;
}

export interface Usage {
  period_start?: string;
  period_end?: string;
  feedback: number;
  attachment_bytes: number;
  counts: { projects: number; api_keys: number };
  limits?: Limits;
}

export interface MeResponse {
  user: User;
  account: Account;
  plan?: string;
  limits: Limits;
  usage: Usage;
  counts: { projects: number };
  /** retro's own feature switches, resolved for this account. */
  features?: Record<string, boolean>;
}

export type FeedbackType = "bug" | "feedback" | "feature";
export type Sentiment = "positive" | "negative" | "neutral";
export type FeedbackStatus = "new" | "triaged" | "planned" | "in_progress" | "done" | "declined";
export type Priority = "none" | "low" | "medium" | "high";
export type FeedbackSource = "api" | "widget" | "board";
export type RoadmapStatus = "planned" | "in_progress" | "done";

export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  url?: string | null;
  /** Public ingest key (not a secret; ships in the widget snippet). */
  public_key: string;
  public_key_prefix: string;
  board_slug: string;
  board_enabled: boolean;
  board_url?: string | null;
  board_title?: string | null;
  board_intro?: string | null;
  allow_votes: boolean;
  allow_board_submissions: boolean;
  types_enabled: FeedbackType[];
  allow_screenshots: boolean;
  allow_email: boolean;
  widget_accent?: string | null;
  /** Cloudflare Turnstile (Phase 2). The secret is write-only; `turnstile_enabled` says whether both are set. */
  turnstile_site_key?: string | null;
  turnstile_enabled?: boolean;
  counts: { feedback: number; new: number; roadmap: number };
  created_at: string;
  updated_at: string;
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  url?: string | null;
  board_slug?: string;
  board_enabled?: boolean;
  board_title?: string | null;
  board_intro?: string | null;
  allow_votes?: boolean;
  allow_board_submissions?: boolean;
  types_enabled?: FeedbackType[];
  allow_screenshots?: boolean;
  allow_email?: boolean;
  widget_accent?: string | null;
  turnstile_site_key?: string | null;
  /** Write-only: never returned by the API. */
  turnstile_secret?: string | null;
}

export type NoteKind = "note" | "reply";
export type ReplyDelivery = "pending" | "sent" | "failed";

export interface Note {
  id: string;
  body: string;
  author?: { id: string | null; email?: string | null; label?: string | null } | null;
  /** Phase 2: `reply` notes are emailed to the reporter. */
  kind?: NoteKind;
  delivery?: ReplyDelivery | null;
  created_at: string;
}

export interface ScreenshotMeta {
  content_type: string;
  size: number;
  width?: number;
  height?: number;
}

export interface FeedbackItem {
  id: string;
  project_id: string;
  number: number;
  type: FeedbackType;
  sentiment?: Sentiment | null;
  title: string;
  message: string;
  status: FeedbackStatus;
  priority: Priority;
  tags: string[];
  reporter_email?: string | null;
  reporter_id?: string | null;
  page_url?: string | null;
  app_version?: string | null;
  locale?: string | null;
  user_agent?: string | null;
  metadata?: Record<string, unknown> | null;
  source: FeedbackSource;
  has_screenshot: boolean;
  screenshot?: ScreenshotMeta | null;
  roadmap_item_id?: string | null;
  notes?: Note[];
  /** Phase 2 (detail only): possible duplicates by text similarity. */
  similar?: SimilarItem[];
  /** Phase 2: set when this item was merged into another one. */
  duplicate_of?: string | null;
  watchers?: string[];
  created_at: string;
  updated_at: string;
}

export interface SimilarItem {
  id: string;
  number: number;
  title: string;
  status: FeedbackStatus;
  similarity: number;
}

export interface FeedbackPatch {
  status?: FeedbackStatus;
  priority?: Priority;
  tags?: string[];
  title?: string;
  type?: FeedbackType;
  sentiment?: Sentiment | null;
  roadmap_item_id?: string | null;
}

export interface FeedbackQuery {
  q?: string;
  type?: string;
  status?: string;
  sentiment?: string;
  priority?: string;
  tag?: string;
  has_screenshot?: boolean;
  since?: string;
  page?: number;
  per_page?: number;
  sort?: "newest" | "oldest" | "votes";
  /** Phase 2: hide items merged into another one. */
  duplicates?: "show" | "hide";
}

export interface RoadmapItem {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  status: RoadmapStatus;
  position: number;
  public: boolean;
  votes: number;
  feedback_count: number;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangelogEntry {
  id: string;
  project_id: string;
  title: string;
  body: string;
  version?: string | null;
  published_at?: string | null;
  roadmap_item_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Summary {
  project_id: string;
  total: number;
  by_status: Record<FeedbackStatus, number>;
  by_type: Record<FeedbackType, number>;
  by_sentiment: Record<Sentiment, number>;
  last_7_days: number;
  last_30_days: number;
  top_tags: { tag: string; count: number }[];
}

export interface PublicRoadmapItem {
  id: string;
  title: string;
  description?: string | null;
  status: RoadmapStatus;
  votes: number;
  completed_at?: string | null;
}

export interface PublicChangelogEntry {
  id: string;
  title: string;
  body: string;
  version?: string | null;
  published_at: string;
}

export interface Board {
  project: { name: string; url?: string | null; board_title?: string | null; board_intro?: string | null };
  roadmap: Record<RoadmapStatus, PublicRoadmapItem[]>;
  changelog: PublicChangelogEntry[];
  can_submit: boolean;
  can_vote: boolean;
  types_enabled: FeedbackType[];
  /** Phase 2: present when the project protects submissions with Cloudflare Turnstile. */
  turnstile_site_key?: string | null;
}

export interface IngestResponse {
  id: string;
  number: number;
  status: FeedbackStatus;
  board_url?: string | null;
  screenshot_dropped?: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  per_page: number;
  total: number;
}

export type ApiKeyRole = "viewer" | "editor" | "admin";

export interface ApiKey {
  id: string;
  name?: string;
  prefix: string;
  role: ApiKeyRole;
  last_used_at?: string | null;
  created_at: string;
}

export interface RoleInfo {
  label: string;
  description: string;
  scopes: string[];
}

export interface RolesResponse {
  default_role: ApiKeyRole;
  roles: Record<ApiKeyRole, RoleInfo>;
}

export type AuditOutcome = "ok" | "denied" | "error";

export interface AuditEvent {
  id: string;
  ts: string;
  actor_type: "user" | "api_key" | "system";
  actor_id?: string | null;
  actor_label?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  outcome: AuditOutcome;
  meta?: Record<string, unknown>;
}

/** `which` is set on 402 limit_reached: projects | api_keys | roadmap_items | webhooks. */
export interface ApiError {
  code: string;
  message: string;
  which?: string;
  required_scope?: string;
  role?: string;
}

/* ─── Phase 2 ──────────────────────────────────────────────────────────── */

export type WebhookEvent =
  | "feedback.created"
  | "feedback.status_changed"
  | "roadmap.status_changed"
  | "changelog.published"
  | "ping";

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  description?: string | null;
  enabled: boolean;
  secret_prefix: string;
  /** Full secret; present ONLY on create. */
  secret?: string;
  last_delivery_at?: string | null;
  last_status?: string | null;
  created_at: string;
}

export type DeliveryStatus = "pending" | "delivered" | "failed";

export interface WebhookDelivery {
  id: string;
  event: WebhookEvent | string;
  status: DeliveryStatus;
  attempts: number;
  response_code?: number | null;
  last_error?: string | null;
  created_at: string;
  delivered_at?: string | null;
}

export interface SavedViewFilters {
  q?: string;
  type?: string;
  status?: string;
  sentiment?: string;
  priority?: string;
  tag?: string;
  has_screenshot?: boolean;
  sort?: "newest" | "oldest" | "votes";
}

export interface SavedView {
  id: string;
  name: string;
  filters: SavedViewFilters;
  position: number;
  created_at: string;
}

/** 0 = instant (one mail per item); otherwise minutes between digests. */
export type DigestMinutes = 0 | 15 | 60 | 1440;

export interface NotificationSettings {
  email_new_feedback: boolean;
  email_digest_minutes: DigestMinutes;
  /** Where notifications go: the account owner's email. */
  email?: string | null;
}

export interface ProjectExport {
  format: "retro.project.v1";
  exported_at: string;
  project: Record<string, unknown>;
  feedback: FeedbackItem[];
  roadmap: RoadmapItem[];
  changelog: ChangelogEntry[];
}

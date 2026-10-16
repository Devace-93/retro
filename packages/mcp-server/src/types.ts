/** Wire types of the retro REST API (see CONTRACT.md at the repo root). */

export type Role = "viewer" | "editor" | "admin";

export type Scope =
  | "projects:read"
  | "projects:write"
  | "projects:delete"
  | "feedback:read"
  | "feedback:write"
  | "feedback:delete"
  | "board:read"
  | "board:write"
  | "board:delete"
  | "usage:read"
  | "audit:read";

export type FeedbackType = "bug" | "feedback" | "feature";
export type Sentiment = "positive" | "negative" | "neutral";
export type FeedbackStatus = "new" | "triaged" | "planned" | "in_progress" | "done" | "declined";
export type Priority = "none" | "low" | "medium" | "high";
export type Source = "api" | "widget" | "board";
export type RoadmapStatus = "planned" | "in_progress" | "done";

export interface Project {
  id: string;
  /** Phase 2: whether Cloudflare Turnstile is configured (the secret is write-only). */
  turnstile_enabled?: boolean;
  turnstile_site_key?: string | null;
  key: string;
  name: string;
  description?: string | null;
  url?: string | null;
  /** Always present for the owner (the public key is not a secret). */
  public_key: string;
  public_key_prefix: string;
  board_slug: string;
  board_enabled: boolean;
  board_url: string | null;
  board_title?: string | null;
  board_intro?: string | null;
  allow_votes: boolean;
  allow_board_submissions: boolean;
  types_enabled: FeedbackType[];
  allow_screenshots: boolean;
  allow_email: boolean;
  widget_accent?: string | null;
  counts: { feedback: number; new: number; roadmap: number };
  created_at: string;
  updated_at: string;
}

export type NoteKind = "note" | "reply";
export type DeliveryStatus = "pending" | "sent" | "failed";

export interface Note {
  id: string;
  body: string;
  /** API-key authors carry `{ id: null, email: null, label: "<key prefix>" }`. */
  author: { id: string | null; email: string | null; label?: string } | null;
  /** Phase 2: `reply` notes are emailed to the reporter. */
  kind?: NoteKind;
  /** Phase 2: outbox state of a reply (mirrors the email job). */
  delivery?: DeliveryStatus | null;
  created_at: string;
}

/** Phase 2: a possible duplicate found by trigram similarity (detail only). */
export interface SimilarItem {
  id: string;
  number: number;
  title: string;
  status: FeedbackStatus;
  similarity: number;
}

export interface Screenshot {
  content_type: string;
  size: number;
  width?: number | null;
  height?: number | null;
}

export interface FeedbackItem {
  id: string;
  project_id: string;
  number: number;
  type: FeedbackType;
  sentiment: Sentiment | null;
  title: string;
  message: string;
  status: FeedbackStatus;
  priority: Priority;
  tags: string[];
  reporter_email: string | null;
  reporter_id: string | null;
  page_url: string | null;
  app_version: string | null;
  locale: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  source: Source;
  has_screenshot: boolean;
  screenshot?: Screenshot | null;
  roadmap_item_id: string | null;
  /** Only on GET /feedback/:item. */
  notes?: Note[];
  /** Phase 2 (detail only): possible duplicates, best match first. */
  similar?: SimilarItem[];
  /** Phase 2: set when the item was merged into another one. */
  duplicate_of?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoadmapItem {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: RoadmapStatus;
  position: number;
  public: boolean;
  votes: number;
  feedback_count: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangelogEntry {
  id: string;
  project_id: string;
  title: string;
  body: string;
  version: string | null;
  published_at: string | null;
  roadmap_item_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Summary {
  project_id: string;
  total: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_sentiment: Record<string, number>;
  last_7_days: number;
  last_30_days: number;
  top_tags: { tag: string; count: number }[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  per_page: number;
  total: number;
}

export interface KeyInfo {
  account: { id: string; name: string; plan: string; created_at?: string };
  key: { id: string; prefix: string; role: Role };
  scopes: Scope[];
}

export interface Usage {
  period_start: string;
  period_end: string;
  feedback: number;
  attachment_bytes: number;
  counts: { projects: number; api_keys: number };
  limits: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  ts: string;
  actor_type: string;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  meta: Record<string, unknown>;
}

export interface RotatedKey {
  public_key: string;
  public_key_prefix: string;
}

export interface CreateProjectInput {
  name: string;
  key?: string;
  description?: string;
  url?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  url?: string;
  board_slug?: string;
  board_enabled?: boolean;
  board_title?: string;
  board_intro?: string;
  allow_votes?: boolean;
  allow_board_submissions?: boolean;
  types_enabled?: FeedbackType[];
  allow_screenshots?: boolean;
  allow_email?: boolean;
  widget_accent?: string;
  turnstile_site_key?: string | null;
  turnstile_secret?: string | null;
}

export interface ListFeedbackParams {
  q?: string;
  type?: string;
  status?: string;
  sentiment?: Sentiment;
  priority?: Priority;
  tag?: string;
  has_screenshot?: boolean;
  since?: string;
  page?: number;
  per_page?: number;
  sort?: "newest" | "oldest" | "votes";
  /** Phase 2: hide items merged into another one. */
  duplicates?: "show" | "hide";
}

export interface UpdateFeedbackInput {
  status?: FeedbackStatus;
  priority?: Priority;
  tags?: string[];
  title?: string;
  type?: FeedbackType;
  sentiment?: Sentiment | null;
  roadmap_item_id?: string | null;
}

export interface PromoteInput {
  title?: string;
  description?: string;
  status?: RoadmapStatus;
}

export interface PromoteResult {
  item: FeedbackItem;
  roadmap_item: RoadmapItem;
}

export interface CreateRoadmapInput {
  title: string;
  description?: string;
  status?: RoadmapStatus;
  public?: boolean;
}

export interface UpdateRoadmapInput {
  title?: string;
  description?: string;
  status?: RoadmapStatus;
  public?: boolean;
}

export interface CreateChangelogInput {
  title: string;
  body: string;
  version?: string;
  publish?: boolean;
}

export interface UpdateChangelogInput {
  title?: string;
  body?: string;
  version?: string;
  published?: boolean;
  roadmap_item_ids?: string[];
}

// --- Phase 2 ------------------------------------------------------------- //

export type ExportFormat = "json" | "csv";

export interface ProjectExport {
  format: "retro.project.v1";
  exported_at: string;
  project: { key: string; name: string; description?: string | null; url?: string | null; board_slug: string; types_enabled: FeedbackType[] };
  feedback: FeedbackItem[];
  roadmap: RoadmapItem[];
  changelog: ChangelogEntry[];
}

export interface SavedViewFilters {
  q?: string;
  type?: string;
  status?: string;
  sentiment?: Sentiment;
  priority?: Priority;
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
  /** Full secret; ONLY on create. */
  secret?: string;
  last_delivery_at: string | null;
  last_status: string | null;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  event: WebhookEvent;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  response_code: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface CreateWebhookInput {
  url: string;
  events?: WebhookEvent[];
  description?: string;
}

export interface NotificationSettings {
  email_new_feedback: boolean;
  /** 0 = instant, 15 | 60 | 1440 = digest window in minutes. */
  email_digest_minutes: number;
  email: string;
}

export interface UpdateNotificationSettingsInput {
  email_new_feedback?: boolean;
  email_digest_minutes?: number;
}

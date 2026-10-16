/**
 * Minimal typed HTTP client for the retro management API.
 *
 * Deliberately dependency-free (global `fetch`) so the MCP server stays small
 * and the client can be swapped for a fake in tests.
 */
import type {
  AuditEvent,
  ChangelogEntry,
  CreateChangelogInput,
  CreateProjectInput,
  CreateRoadmapInput,
  CreateWebhookInput,
  ExportFormat,
  FeedbackItem,
  KeyInfo,
  ListFeedbackParams,
  Note,
  NotificationSettings,
  Paginated,
  Project,
  ProjectExport,
  PromoteInput,
  PromoteResult,
  RoadmapItem,
  RotatedKey,
  SavedView,
  SavedViewFilters,
  Summary,
  UpdateChangelogInput,
  UpdateFeedbackInput,
  UpdateNotificationSettingsInput,
  UpdateProjectInput,
  UpdateRoadmapInput,
  Usage,
  Webhook,
  WebhookDelivery,
} from "./types.js";
import { VERSION } from "./version.js";

/** An error the API returned on purpose (`{ error: { code, message, ...extra } }`). */
export class RetroApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Extra error fields, e.g. `which` on `limit_reached`, `required_scope` on `insufficient_scope`. */
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RetroApiError";
  }
}

export interface RetroClientOptions {
  /** Base URL including the `/api` prefix, e.g. `https://retro.3m4.net/api`. */
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined>;

const enc = encodeURIComponent;

export class RetroClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RetroClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; raw?: boolean } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      Accept: "application/json",
      "User-Agent": `retro-feedback-mcp/${VERSION}`,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (opts.raw && res.ok) return text as T;
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = ((data as { error?: Record<string, unknown> } | null)?.error ?? {}) as Record<
        string,
        unknown
      >;
      const { code, message, ...extra } = err;
      throw new RetroApiError(
        res.status,
        typeof code === "string" ? code : `http_${res.status}`,
        typeof message === "string" ? message : `HTTP ${res.status}`,
        extra,
      );
    }
    return data as T;
  }

  /** Identity + scopes of the calling key. */
  me(): Promise<KeyInfo> {
    return this.request("GET", "/apikeys/me");
  }

  // --- Projects ---------------------------------------------------------- //

  listProjects(params: { q?: string } = {}): Promise<{ items: Project[]; total: number }> {
    return this.request("GET", "/projects", { query: params });
  }

  createProject(input: CreateProjectInput): Promise<Project> {
    return this.request("POST", "/projects", { body: input });
  }

  getProject(id: string): Promise<Project> {
    return this.request("GET", `/projects/${enc(id)}`);
  }

  updateProject(id: string, patch: UpdateProjectInput): Promise<Project> {
    return this.request("PATCH", `/projects/${enc(id)}`, { body: patch });
  }

  deleteProject(id: string): Promise<void> {
    return this.request("DELETE", `/projects/${enc(id)}`);
  }

  rotateProjectKey(id: string): Promise<RotatedKey> {
    return this.request("POST", `/projects/${enc(id)}/rotate-key`);
  }

  summary(projectId: string): Promise<Summary> {
    return this.request("GET", `/projects/${enc(projectId)}/summary`);
  }

  // --- Feedback ---------------------------------------------------------- //

  listFeedback(projectId: string, params: ListFeedbackParams = {}): Promise<Paginated<FeedbackItem>> {
    return this.request("GET", `/projects/${enc(projectId)}/feedback`, { query: params as Query });
  }

  /** `item` is the item UUID or its per-project number. */
  getFeedback(projectId: string, item: string | number): Promise<FeedbackItem> {
    return this.request("GET", `/projects/${enc(projectId)}/feedback/${enc(String(item))}`);
  }

  updateFeedback(projectId: string, item: string | number, patch: UpdateFeedbackInput): Promise<FeedbackItem> {
    return this.request("PATCH", `/projects/${enc(projectId)}/feedback/${enc(String(item))}`, { body: patch });
  }

  deleteFeedback(projectId: string, item: string | number): Promise<void> {
    return this.request("DELETE", `/projects/${enc(projectId)}/feedback/${enc(String(item))}`);
  }

  addNote(projectId: string, item: string | number, body: string): Promise<Note> {
    return this.request("POST", `/projects/${enc(projectId)}/feedback/${enc(String(item))}/notes`, {
      body: { body },
    });
  }

  promote(projectId: string, item: string | number, input: PromoteInput = {}): Promise<PromoteResult> {
    return this.request("POST", `/projects/${enc(projectId)}/feedback/${enc(String(item))}/promote`, {
      body: input,
    });
  }

  listTags(projectId: string): Promise<{ tags: { tag: string; count: number }[] }> {
    return this.request("GET", `/projects/${enc(projectId)}/tags`);
  }

  // --- Roadmap ----------------------------------------------------------- //

  listRoadmap(
    projectId: string,
    params: { status?: string; include_hidden?: boolean } = {},
  ): Promise<{ items: RoadmapItem[] }> {
    return this.request("GET", `/projects/${enc(projectId)}/roadmap`, { query: params });
  }

  createRoadmapItem(projectId: string, input: CreateRoadmapInput): Promise<RoadmapItem> {
    return this.request("POST", `/projects/${enc(projectId)}/roadmap`, { body: input });
  }

  updateRoadmapItem(projectId: string, id: string, patch: UpdateRoadmapInput): Promise<RoadmapItem> {
    return this.request("PATCH", `/projects/${enc(projectId)}/roadmap/${enc(id)}`, { body: patch });
  }

  deleteRoadmapItem(projectId: string, id: string): Promise<void> {
    return this.request("DELETE", `/projects/${enc(projectId)}/roadmap/${enc(id)}`);
  }

  // --- Changelog --------------------------------------------------------- //

  listChangelog(projectId: string, params: { include_drafts?: boolean } = {}): Promise<{ items: ChangelogEntry[] }> {
    return this.request("GET", `/projects/${enc(projectId)}/changelog`, { query: params });
  }

  createChangelogEntry(projectId: string, input: CreateChangelogInput): Promise<ChangelogEntry> {
    return this.request("POST", `/projects/${enc(projectId)}/changelog`, { body: input });
  }

  updateChangelogEntry(projectId: string, id: string, patch: UpdateChangelogInput): Promise<ChangelogEntry> {
    return this.request("PATCH", `/projects/${enc(projectId)}/changelog/${enc(id)}`, { body: patch });
  }

  deleteChangelogEntry(projectId: string, id: string): Promise<void> {
    return this.request("DELETE", `/projects/${enc(projectId)}/changelog/${enc(id)}`);
  }

  // --- Phase 2: export, replies, merge, views, webhooks -------------------- //

  exportProject(projectId: string, format: "json"): Promise<ProjectExport>;
  exportProject(projectId: string, format: "csv"): Promise<string>;
  exportProject(projectId: string, format: ExportFormat): Promise<ProjectExport | string> {
    return this.request("GET", `/projects/${enc(projectId)}/export`, { query: { format }, raw: format === "csv" });
  }

  reply(projectId: string, item: string | number, body: string): Promise<Note> {
    return this.request("POST", `/projects/${enc(projectId)}/feedback/${enc(String(item))}/reply`, { body: { body } });
  }

  merge(projectId: string, item: string | number, into: string): Promise<FeedbackItem> {
    return this.request("POST", `/projects/${enc(projectId)}/feedback/${enc(String(item))}/merge`, { body: { into } });
  }

  listViews(projectId: string): Promise<SavedView[]> {
    return this.request("GET", `/projects/${enc(projectId)}/views`);
  }

  createView(projectId: string, input: { name: string; filters: SavedViewFilters }): Promise<SavedView> {
    return this.request("POST", `/projects/${enc(projectId)}/views`, { body: input });
  }

  listWebhooks(projectId: string): Promise<Webhook[]> {
    return this.request("GET", `/projects/${enc(projectId)}/webhooks`);
  }

  createWebhook(projectId: string, input: CreateWebhookInput): Promise<Webhook> {
    return this.request("POST", `/projects/${enc(projectId)}/webhooks`, { body: input });
  }

  testWebhook(projectId: string, webhookId: string): Promise<{ delivery_id: string }> {
    return this.request("POST", `/projects/${enc(projectId)}/webhooks/${enc(webhookId)}/test`);
  }

  listDeliveries(projectId: string, webhookId: string, params: { limit?: number } = {}): Promise<WebhookDelivery[]> {
    return this.request("GET", `/projects/${enc(projectId)}/webhooks/${enc(webhookId)}/deliveries`, { query: params });
  }

  notificationSettings(): Promise<NotificationSettings> {
    return this.request("GET", "/account/notifications");
  }

  updateNotificationSettings(patch: UpdateNotificationSettingsInput): Promise<NotificationSettings> {
    return this.request("PATCH", "/account/notifications", { body: patch });
  }

  // --- Account ----------------------------------------------------------- //

  usage(): Promise<Usage> {
    return this.request("GET", "/account/usage");
  }

  auditLog(params: { limit?: number; action?: string } = {}): Promise<{ items: AuditEvent[] }> {
    return this.request("GET", "/account/audit", { query: params });
  }
}

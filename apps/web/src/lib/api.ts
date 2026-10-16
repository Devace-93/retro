/**
 * API client for the retro Flask backend.
 *
 * - Base URL from VITE_API_URL (fallback "/api" — works behind Caddy).
 * - Attaches the bearer access token.
 * - On a 401, transparently refreshes via POST /auth/refresh (once) and retries.
 *
 * Throws `ApiRequestError` (carrying the parsed `error` body + HTTP status) so
 * callers can branch on e.g. 402 limit_reached (`error.which`).
 */
import { getAccessToken, getRefreshToken, setAccessToken, clearTokens } from "./auth";
import type {
  ApiError,
  ApiKey,
  ApiKeyRole,
  AuditEvent,
  AuthResponse,
  Board,
  ChangelogEntry,
  FeedbackItem,
  FeedbackPatch,
  FeedbackQuery,
  FeedbackType,
  IngestResponse,
  MeResponse,
  Note,
  NotificationSettings,
  Paginated,
  Project,
  ProjectPatch,
  PublicChangelogEntry,
  RoadmapItem,
  RoadmapStatus,
  RolesResponse,
  SavedView,
  SavedViewFilters,
  Summary,
  Usage,
  Webhook,
  WebhookDelivery,
  WebhookEvent,
} from "./types";

const BASE = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

export class ApiRequestError extends Error {
  status: number;
  error: ApiError;
  constructor(status: number, error: ApiError) {
    super(error?.message || `Request failed (${status})`);
    this.name = "ApiRequestError";
    this.status = status;
    this.error = error;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skip attaching/refreshing the bearer token (e.g. login/register). */
  auth?: boolean;
  /** Extra headers (e.g. X-Retro-Source on board submissions). */
  headers?: Record<string, string>;
  /** Internal: prevents infinite refresh loops. */
  _retried?: boolean;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json();
    if (data?.error) return data.error as ApiError;
    return { code: "error", message: data?.message || res.statusText };
  } catch {
    return { code: "error", message: res.statusText || "Request failed" };
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refresh_token = getRefreshToken();
  if (!refresh_token) return false;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token }),
      });
      if (!res.ok) {
        clearTokens();
        return false;
      }
      const data = (await res.json()) as { access_token: string };
      setAccessToken(data.access_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function rawFetch(path: string, opts: RequestOptions = {}): Promise<Response> {
  const { method = "GET", body, auth = true, headers: extra = {}, _retried = false } = opts;

  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && !_retried) {
    const ok = await tryRefresh();
    if (ok) return rawFetch(path, { ...opts, _retried: true });
    clearTokens();
  }

  if (!res.ok) {
    throw new ApiRequestError(res.status, await parseError(res));
  }
  return res;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawFetch(path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Build a query string from defined, non-empty values. */
function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

const enc = encodeURIComponent;
const p = (id: string) => `/projects/${enc(id)}`;
const b = (slug: string) => `/boards/${enc(slug)}`;

export const api = {
  /* ─── Auth ───────────────────────────────────────────────────────────── */
  register: (email: string, password: string, account_name?: string) =>
    apiFetch<AuthResponse>("/auth/register", {
      method: "POST",
      auth: false,
      body: { email, password, account_name },
    }),

  login: (email: string, password: string) =>
    apiFetch<AuthResponse>("/auth/login", { method: "POST", auth: false, body: { email, password } }),

  logout: (refresh_token: string) =>
    apiFetch<void>("/auth/logout", { method: "POST", body: { refresh_token } }),

  me: () => apiFetch<MeResponse>("/auth/me"),

  /* ─── Features (retro's own switches; public, used by anonymous pages) ──── */
  features: () => apiFetch<{ features: Record<string, boolean> }>("/features", { auth: false }),

  /* ─── Projects ───────────────────────────────────────────────────────── */
  listProjects: (q = "") => apiFetch<{ items: Project[]; total: number }>(`/projects${qs({ q })}`),

  createProject: (input: { name: string; key?: string; description?: string; url?: string }) =>
    apiFetch<Project>("/projects", { method: "POST", body: input }),

  getProject: (id: string) => apiFetch<Project>(p(id)),

  updateProject: (id: string, input: ProjectPatch) =>
    apiFetch<Project>(p(id), { method: "PATCH", body: input }),

  deleteProject: (id: string) => apiFetch<void>(p(id), { method: "DELETE" }),

  rotateProjectKey: (id: string) =>
    apiFetch<{ public_key: string; public_key_prefix: string }>(`${p(id)}/rotate-key`, { method: "POST" }),

  projectSummary: (id: string) => apiFetch<Summary>(`${p(id)}/summary`),

  projectTags: (id: string) => apiFetch<{ tags: { tag: string; count: number }[] }>(`${p(id)}/tags`),

  /* ─── Feedback ───────────────────────────────────────────────────────── */
  listFeedback: (id: string, query: FeedbackQuery = {}) =>
    apiFetch<Paginated<FeedbackItem>>(
      `${p(id)}/feedback${qs({
        q: query.q,
        type: query.type,
        status: query.status,
        sentiment: query.sentiment,
        priority: query.priority,
        tag: query.tag,
        has_screenshot: query.has_screenshot ? "true" : undefined,
        since: query.since,
        page: query.page ?? 1,
        per_page: query.per_page ?? 50,
        sort: query.sort,
        duplicates: query.duplicates,
      })}`,
    ),

  /** `item` is the item UUID or its per-project number. */
  getFeedback: (id: string, item: string | number) =>
    apiFetch<FeedbackItem>(`${p(id)}/feedback/${enc(String(item))}`),

  updateFeedback: (id: string, item: string, patch: FeedbackPatch) =>
    apiFetch<FeedbackItem>(`${p(id)}/feedback/${enc(item)}`, { method: "PATCH", body: patch }),

  deleteFeedback: (id: string, item: string) =>
    apiFetch<void>(`${p(id)}/feedback/${enc(item)}`, { method: "DELETE" }),

  addNote: (id: string, item: string, body: string) =>
    apiFetch<Note>(`${p(id)}/feedback/${enc(item)}/notes`, { method: "POST", body: { body } }),

  deleteNote: (id: string, item: string, noteId: string) =>
    apiFetch<void>(`${p(id)}/feedback/${enc(item)}/notes/${enc(noteId)}`, { method: "DELETE" }),

  promoteFeedback: (id: string, item: string, input: { title?: string; description?: string; status?: RoadmapStatus } = {}) =>
    apiFetch<{ item: FeedbackItem; roadmap_item: RoadmapItem }>(`${p(id)}/feedback/${enc(item)}/promote`, {
      method: "POST",
      body: input,
    }),

  /**
   * Screenshot bytes as an object URL. `<img>` cannot send the bearer token,
   * so the dashboard fetches the image and renders the blob. Callers revoke
   * the URL when done (URL.revokeObjectURL).
   */
  screenshotUrl: async (id: string, item: string): Promise<string> => {
    const res = await rawFetch(`${p(id)}/feedback/${enc(item)}/screenshot`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  /* ─── Roadmap ────────────────────────────────────────────────────────── */
  listRoadmap: (id: string, status?: RoadmapStatus) =>
    apiFetch<{ items: RoadmapItem[] }>(`${p(id)}/roadmap${qs({ status, include_hidden: "true" })}`),

  createRoadmapItem: (id: string, input: { title: string; description?: string; status?: RoadmapStatus; public?: boolean }) =>
    apiFetch<RoadmapItem>(`${p(id)}/roadmap`, { method: "POST", body: input }),

  updateRoadmapItem: (id: string, rid: string, input: { title?: string; description?: string | null; status?: RoadmapStatus; public?: boolean }) =>
    apiFetch<RoadmapItem>(`${p(id)}/roadmap/${enc(rid)}`, { method: "PATCH", body: input }),

  reorderRoadmap: (id: string, status: RoadmapStatus, ids: string[]) =>
    apiFetch<{ items: RoadmapItem[] }>(`${p(id)}/roadmap/reorder`, { method: "PUT", body: { status, ids } }),

  deleteRoadmapItem: (id: string, rid: string) =>
    apiFetch<void>(`${p(id)}/roadmap/${enc(rid)}`, { method: "DELETE" }),

  /* ─── Changelog ──────────────────────────────────────────────────────── */
  listChangelog: (id: string) =>
    apiFetch<{ items: ChangelogEntry[] }>(`${p(id)}/changelog${qs({ include_drafts: "true" })}`),

  createChangelogEntry: (id: string, input: { title: string; body: string; version?: string; publish?: boolean }) =>
    apiFetch<ChangelogEntry>(`${p(id)}/changelog`, { method: "POST", body: input }),

  updateChangelogEntry: (
    id: string,
    cid: string,
    input: { title?: string; body?: string; version?: string | null; published?: boolean; roadmap_item_ids?: string[] },
  ) => apiFetch<ChangelogEntry>(`${p(id)}/changelog/${enc(cid)}`, { method: "PATCH", body: input }),

  deleteChangelogEntry: (id: string, cid: string) =>
    apiFetch<void>(`${p(id)}/changelog/${enc(cid)}`, { method: "DELETE" }),

  /* ─── Public boards (no auth) ────────────────────────────────────────── */
  board: (slug: string) => apiFetch<Board>(b(slug), { auth: false }),

  boardChangelog: (slug: string, page = 1, per_page = 20) =>
    apiFetch<Paginated<PublicChangelogEntry>>(`${b(slug)}/changelog${qs({ page, per_page })}`, { auth: false }),

  vote: (slug: string, rid: string, voter_id: string) =>
    apiFetch<{ votes: number; voted: boolean }>(`${b(slug)}/items/${enc(rid)}/vote`, {
      method: "POST",
      auth: false,
      body: { voter_id },
    }),

  unvote: (slug: string, rid: string, voter_id: string) =>
    apiFetch<{ votes: number; voted: boolean }>(`${b(slug)}/items/${enc(rid)}/vote`, {
      method: "DELETE",
      auth: false,
      body: { voter_id },
    }),

  boardSubmit: (
    slug: string,
    input: { type: FeedbackType; message: string; title?: string; email?: string; sentiment?: string; website: string; turnstile_token?: string },
  ) =>
    apiFetch<IngestResponse>(`${b(slug)}/feedback`, {
      method: "POST",
      auth: false,
      body: { ...input, page_url: typeof location !== "undefined" ? location.href.split("#")[0] : undefined },
      headers: { "X-Retro-Source": "board" },
    }),

  /* ─── Account ────────────────────────────────────────────────────────── */
  usage: () => apiFetch<Usage>("/account/usage"),

  audit: (limit = 50, action = "") =>
    apiFetch<{ items: AuditEvent[]; limit: number }>(`/account/audit${qs({ limit, action })}`),

  /* ─── API keys ───────────────────────────────────────────────────────── */
  listApiKeys: () => apiFetch<ApiKey[]>("/apikeys"),

  apiKeyRoles: () => apiFetch<RolesResponse>("/apikeys/roles", { auth: false }),

  createApiKey: (name: string, role: ApiKeyRole = "editor") =>
    apiFetch<{ id: string; key: string; prefix: string; name: string; role: ApiKeyRole }>("/apikeys", {
      method: "POST",
      body: { name, role },
    }),

  deleteApiKey: (id: string) => apiFetch<void>(`/apikeys/${enc(id)}`, { method: "DELETE" }),

  /* ─── Phase 2: replies, duplicates, export ───────────────────────────── */
  /** Email the reporter. 400 no_reporter_email · 503 mail_disabled. */
  replyToReporter: (id: string, item: string, body: string) =>
    apiFetch<Note>(`${p(id)}/feedback/${enc(item)}/reply`, { method: "POST", body: { body } }),

  /** Mark `item` as a duplicate of `into` (declined + duplicate_of). */
  mergeFeedback: (id: string, item: string, into: string) =>
    apiFetch<FeedbackItem>(`${p(id)}/feedback/${enc(item)}/merge`, { method: "POST", body: { into } }),

  /**
   * Download an export. Browsers cannot send the bearer token on a plain link,
   * so the file is fetched and handed to the browser as an object URL.
   */
  exportProject: async (id: string, format: "json" | "csv", filename: string): Promise<void> => {
    const res = await rawFetch(`${p(id)}/export${qs({ format })}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  /* ─── Phase 2: saved views ───────────────────────────────────────────── */
  listViews: (id: string) => apiFetch<SavedView[]>(`${p(id)}/views`),

  createView: (id: string, name: string, filters: SavedViewFilters) =>
    apiFetch<SavedView>(`${p(id)}/views`, { method: "POST", body: { name, filters } }),

  updateView: (id: string, vid: string, input: { name?: string; filters?: SavedViewFilters; position?: number }) =>
    apiFetch<SavedView>(`${p(id)}/views/${enc(vid)}`, { method: "PATCH", body: input }),

  deleteView: (id: string, vid: string) => apiFetch<void>(`${p(id)}/views/${enc(vid)}`, { method: "DELETE" }),

  /* ─── Phase 2: webhooks ──────────────────────────────────────────────── */
  listWebhooks: (id: string) => apiFetch<Webhook[]>(`${p(id)}/webhooks`),

  createWebhook: (id: string, input: { url: string; events?: WebhookEvent[]; description?: string }) =>
    apiFetch<Webhook>(`${p(id)}/webhooks`, { method: "POST", body: input }),

  updateWebhook: (
    id: string,
    wid: string,
    input: { url?: string; events?: WebhookEvent[]; description?: string | null; enabled?: boolean },
  ) => apiFetch<Webhook>(`${p(id)}/webhooks/${enc(wid)}`, { method: "PATCH", body: input }),

  deleteWebhook: (id: string, wid: string) => apiFetch<void>(`${p(id)}/webhooks/${enc(wid)}`, { method: "DELETE" }),

  testWebhook: (id: string, wid: string) =>
    apiFetch<{ delivery_id: string }>(`${p(id)}/webhooks/${enc(wid)}/test`, { method: "POST" }),

  webhookDeliveries: (id: string, wid: string, limit = 20) =>
    apiFetch<WebhookDelivery[]>(`${p(id)}/webhooks/${enc(wid)}/deliveries${qs({ limit })}`),

  /* ─── Phase 2: notifications (account) ──────────────────────────────── */
  notificationSettings: () => apiFetch<NotificationSettings>("/account/notifications"),

  updateNotificationSettings: (input: { email_new_feedback?: boolean; email_digest_minutes?: number }) =>
    apiFetch<NotificationSettings>("/account/notifications", { method: "PATCH", body: input }),

  /* ─── Billing ────────────────────────────────────────────────────────── */
  billingOfferings: () => apiFetch<unknown>("/billing/offerings"),
};

/** Public base URL of the API, for docs snippets (e.g. curl examples). */
export const API_PUBLIC_BASE = BASE;

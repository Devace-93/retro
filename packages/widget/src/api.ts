/** Thin client for the ingest endpoints (CONTRACT.md → Ingest). */
export type FeedbackType = "bug" | "feedback" | "feature";
export type Sentiment = "positive" | "negative" | "neutral";

export interface WidgetConfig {
  project: { name: string; url?: string | null };
  types_enabled: FeedbackType[];
  allow_screenshots: boolean;
  allow_email: boolean;
  accent?: string | null;
  board_url?: string | null;
  /** Cloudflare Turnstile site key when the project enables it (Phase 2). */
  turnstile_site_key?: string | null;
  features?: { screenshots?: boolean; public_boards?: boolean };
}

export interface SubmitPayload {
  type: FeedbackType;
  message: string;
  title?: string;
  sentiment?: Sentiment;
  email?: string;
  reporter_id?: string;
  page_url?: string;
  app_version?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
  screenshot?: string;
  /** Turnstile response token, required when the project enables Turnstile. */
  turnstile_token?: string;
  website: string; // honeypot, always ""
}

export interface SubmitResult {
  id: string;
  number: number;
  status: string;
  board_url: string | null;
  screenshot_dropped: boolean;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function parse<T>(res: Response): Promise<T> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (!res.ok) {
    const err = (body && body.error) || {};
    throw new ApiError(res.status, err.code || `http_${res.status}`, err.message || res.statusText);
  }
  return body as T;
}

export function fetchConfig(api: string, projectKey: string): Promise<WidgetConfig> {
  return fetch(`${api}/ingest/config`, {
    method: "GET",
    headers: { "X-Project-Key": projectKey, "X-Retro-Source": "widget" },
    mode: "cors",
    credentials: "omit",
  }).then((r) => parse<WidgetConfig>(r));
}

export function submitFeedback(api: string, projectKey: string, payload: SubmitPayload): Promise<SubmitResult> {
  return fetch(`${api}/ingest/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Project-Key": projectKey,
      "X-Retro-Source": "widget",
    },
    mode: "cors",
    credentials: "omit",
    body: JSON.stringify(payload),
  }).then((r) => parse<SubmitResult>(r));
}

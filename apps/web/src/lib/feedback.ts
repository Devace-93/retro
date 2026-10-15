/**
 * Small helpers shared by the inbox, roadmap, changelog, settings and the
 * public board: enum lists, label keys, formatting and the project-key slug.
 */
import type { CatalogKey } from "../i18n/catalog/en";
import type { FeedbackStatus, FeedbackType, Priority, RoadmapStatus, Sentiment } from "./types";

export const TYPES: FeedbackType[] = ["bug", "feedback", "feature"];
export const STATUSES: FeedbackStatus[] = ["new", "triaged", "planned", "in_progress", "done", "declined"];
export const PRIORITIES: Priority[] = ["none", "low", "medium", "high"];
export const SENTIMENTS: Sentiment[] = ["positive", "negative", "neutral"];
export const ROADMAP_STATUSES: RoadmapStatus[] = ["planned", "in_progress", "done"];

export const TYPE_LABEL: Record<FeedbackType, CatalogKey> = {
  bug: "type.bug",
  feedback: "type.feedback",
  feature: "type.feature",
};
export const TYPE_ICON: Record<FeedbackType, string> = { bug: "🐞", feedback: "💬", feature: "💡" };

export const STATUS_LABEL: Record<FeedbackStatus, CatalogKey> = {
  new: "status.new",
  triaged: "status.triaged",
  planned: "status.planned",
  in_progress: "status.in_progress",
  done: "status.done",
  declined: "status.declined",
};

export const PRIORITY_LABEL: Record<Priority, CatalogKey> = {
  none: "priority.none",
  low: "priority.low",
  medium: "priority.medium",
  high: "priority.high",
};

export const SENTIMENT_LABEL: Record<Sentiment, CatalogKey> = {
  positive: "sentiment.positive",
  negative: "sentiment.negative",
  neutral: "sentiment.neutral",
};
export const SENTIMENT_ICON: Record<Sentiment, string> = { positive: "👍", negative: "👎", neutral: "😐" };

export const STATUS_CLASS: Record<FeedbackStatus, string> = {
  new: "bg-primary-100 text-primary-800",
  triaged: "bg-slate-100 text-slate-700",
  planned: "bg-amber-100 text-amber-800",
  in_progress: "bg-amber-100 text-amber-800",
  done: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
};

export const PRIORITY_CLASS: Record<Priority, string> = {
  none: "bg-slate-100 text-slate-500",
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

/** Slug used as the default project key (same rule as the API). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/** Board slugs the API refuses (400 reserved_slug). */
export const RESERVED_SLUGS = ["api", "b", "widget", "dashboard", "login", "signup", "info", "blog", "sponsors", "mcp"];

export function fmtDateTime(iso: string | null | undefined, lang = "en-US"): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function fmtDate(iso: string | null | undefined, lang = "en-US"): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(lang, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Parse a comma-separated tag list into a trimmed, de-duplicated array. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(",")) {
    const v = t.trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Hostname of the page URL, for compact display in the inbox. */
export function shortUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}

/** Stable anonymous voter id for public boards (localStorage `retro.voter`). */
export function voterId(): string {
  const KEY = "retro.voter";
  try {
    let v = localStorage.getItem(KEY);
    if (!v) {
      v = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return "anonymous";
  }
}

/** Remember which roadmap items this browser voted for (per board). */
export function votedSet(slug: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`retro.voted.${slug}`) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function saveVoted(slug: string, ids: Set<string>): void {
  try {
    localStorage.setItem(`retro.voted.${slug}`, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

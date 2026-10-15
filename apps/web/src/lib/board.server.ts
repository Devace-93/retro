/**
 * Server-side board fetch (SSR only — imported from routeLoader$). Public
 * boards are rendered on the server so they carry OpenGraph tags and work
 * without JavaScript; the API is reached over the internal network via
 * `API_INTERNAL_URL` (compose: http://api:5000/api) with the same fallbacks as
 * features.server.ts.
 */
import type { Board, Paginated, PublicChangelogEntry } from "./types";

const TIMEOUT_MS = 3000;

function apiBase(): string | null {
  const internal = process.env.API_INTERNAL_URL;
  if (internal) return internal.replace(/\/$/, "");
  const pub = import.meta.env.VITE_API_URL || "";
  if (/^https?:\/\//.test(pub)) return pub.replace(/\/$/, "");
  return null;
}

export type BoardResult = { ok: true; board: Board } | { ok: false; status: number };

export async function fetchBoard(slug: string): Promise<BoardResult> {
  const base = apiBase();
  if (!base) return { ok: false, status: 503 };
  try {
    const res = await fetch(`${base}/boards/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, board: (await res.json()) as Board };
  } catch {
    return { ok: false, status: 503 };
  }
}

export async function fetchBoardChangelog(slug: string, page = 1): Promise<Paginated<PublicChangelogEntry> | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/boards/${encodeURIComponent(slug)}/changelog?page=${page}&per_page=20`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as Paginated<PublicChangelogEntry>;
  } catch {
    return null;
  }
}

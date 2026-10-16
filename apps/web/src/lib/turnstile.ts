/**
 * Cloudflare Turnstile helper for the public board (the widget bundles its
 * own copy). Loaded lazily and only when a project has a site key; a project
 * without Turnstile never touches challenges.cloudflare.com.
 */
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (el: string | HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => reject(new Error("turnstile failed to load"));
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Render an invisible/managed challenge into `container` and resolve with the
 * token. Rejects after 30 s or on a Turnstile error so the form can show a
 * message instead of hanging.
 */
export async function turnstileToken(siteKey: string, container: string | HTMLElement): Promise<string> {
  const ts = await loadTurnstile();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("turnstile timeout")), 30_000);
    let id = "";
    const done = (fn: () => void) => {
      clearTimeout(timer);
      try {
        if (id) ts.remove(id);
      } catch {
        /* already gone */
      }
      fn();
    };
    try {
      id = ts.render(container, {
        sitekey: siteKey,
        size: "normal",
        callback: (token: string) => done(() => resolve(token)),
        "error-callback": () => done(() => reject(new Error("turnstile error"))),
        "expired-callback": () => done(() => reject(new Error("turnstile expired"))),
      });
    } catch (e) {
      done(() => reject(e as Error));
    }
  });
}

/**
 * Optional Cloudflare Turnstile support (CONTRACT.md → Phase 2 → Spam
 * protection). Loaded lazily, only when the project config carries a
 * `turnstile_site_key`, so projects without it never contact Cloudflare.
 *
 * Turnstile renders an iframe into a container element and does not support
 * containers inside a shadow root. The widget therefore keeps a light-DOM
 * child on the host element (`<div slot="turnstile">`) and places a
 * `<slot name="turnstile">` in the shadow form: slotted content lays out
 * inside the panel while the iframe itself lives in the light DOM.
 */
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__retroTurnstileReady";
const READY_CALLBACK = "__retroTurnstileReady";
export const CONTAINER_ATTR = "data-retro-turnstile";

export interface TurnstileRenderOptions {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  language?: string;
  appearance?: "always" | "execute" | "interaction-only";
  size?: "normal" | "flexible" | "compact";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: (code?: string) => void;
  "timeout-callback"?: () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
  getResponse(widgetId?: string): string | undefined;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __retroTurnstileReady?: () => void;
    __retroTurnstileLoading?: Promise<TurnstileApi>;
  }
}

/** Inject the Turnstile script once per page and resolve with its API. */
export function loadTurnstile(timeoutMs = 15000): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (window.__retroTurnstileLoading) return window.__retroTurnstileLoading;
  const p = new Promise<TurnstileApi>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.__retroTurnstileLoading = undefined;
      reject(new Error("turnstile_load_timeout"));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile_unavailable"));
    };
    const previous = window[READY_CALLBACK];
    window[READY_CALLBACK] = () => {
      if (typeof previous === "function") previous();
      done();
    };
    const existing = document.querySelector<HTMLScriptElement>('script[src^="https://challenges.cloudflare.com/turnstile/"]');
    if (existing) {
      // Another integration on the page is loading it; poll instead of a second tag.
      const poll = setInterval(() => {
        if (window.turnstile) {
          clearInterval(poll);
          done();
        }
      }, 100);
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      clearTimeout(timer);
      window.__retroTurnstileLoading = undefined;
      reject(new Error("turnstile_load_failed"));
    };
    document.head.appendChild(s);
  });
  window.__retroTurnstileLoading = p;
  return p;
}

/** The light-DOM container slotted into the shadow form (created once). */
export function ensureContainer(host: HTMLElement): HTMLElement {
  let el = host.querySelector<HTMLElement>(`:scope > [${CONTAINER_ATTR}]`);
  if (!el) {
    el = document.createElement("div");
    el.setAttribute(CONTAINER_ATTR, "");
    el.setAttribute("slot", "turnstile");
    host.appendChild(el);
  }
  return el;
}

/** Map the widget theme to what Turnstile understands. */
export function turnstileTheme(theme: string | undefined): "light" | "dark" | "auto" {
  return theme === "dark" ? "dark" : theme === "light" ? "light" : "auto";
}

/** Turnstile accepts a short language tag; keep the base language. */
export function turnstileLanguage(locale: string): string {
  const base = (locale || "").slice(0, 2).toLowerCase();
  return base || "auto";
}

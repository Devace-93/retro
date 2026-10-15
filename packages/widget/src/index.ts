/**
 * Entry point for /widget.js: registers <retro-widget>, auto-mounts from a
 * `<script data-project-key>` tag and exposes `window.retro`.
 */
import { RetroWidget, type EventName } from "./widget";
import type { FeedbackType } from "./api";
import type { Theme } from "./theme";

declare global {
  interface Window {
    retro: RetroApi;
    __retroScriptSrc?: string;
  }
}

export interface RetroApi {
  open(init?: { type?: FeedbackType; message?: string }): void;
  close(): void;
  identify(who: { id?: string; email?: string }): void;
  setMeta(meta: Record<string, unknown>): void;
  setLang(lang: string): void;
  setTheme(theme: "auto" | Theme): void;
  on(event: EventName, cb: (payload?: unknown) => void): void;
  off(event: EventName, cb: (payload?: unknown) => void): void;
  /** The mounted element, if any. */
  element(): RetroWidget | null;
  version: string;
}

(function boot() {
  try {
    if (typeof window === "undefined" || typeof customElements === "undefined") return;
    const script = document.currentScript as HTMLScriptElement | null;
    if (script && script.src) window.__retroScriptSrc = script.src;

    if (!customElements.get("retro-widget")) customElements.define("retro-widget", RetroWidget);

    const find = () => document.querySelector<RetroWidget>("retro-widget");
    // Queue calls made before the element exists (e.g. `retro.identify` right after the script tag).
    const queue: Array<(el: RetroWidget) => void> = [];
    const call = (fn: (el: RetroWidget) => void) => {
      const el = find();
      if (el) fn(el);
      else queue.push(fn);
    };
    const flush = () => {
      const el = find();
      if (!el) return;
      while (queue.length) {
        const fn = queue.shift();
        if (fn) {
          try {
            fn(el);
          } catch {
            /* ignore */
          }
        }
      }
    };

    const api: RetroApi = {
      open: (init) => call((el) => el.open(init)),
      close: () => call((el) => el.close()),
      identify: (who) => call((el) => el.identify(who)),
      setMeta: (m) => call((el) => el.setMeta(m)),
      setLang: (l) => call((el) => el.setLang(l)),
      setTheme: (t) => call((el) => el.setTheme(t)),
      on: (ev, cb) => call((el) => el.on(ev, cb)),
      off: (ev, cb) => call((el) => el.off(ev, cb)),
      element: find,
      version: "0.1.0",
    };
    window.retro = api;

    const mount = () => {
      try {
        if (find()) {
          flush();
          return;
        }
        const tag = script || document.querySelector<HTMLScriptElement>("script[data-project-key]");
        const key = tag && tag.getAttribute("data-project-key");
        if (!key) return; // explicit <retro-widget> usage or headless setup later
        const el = document.createElement("retro-widget") as unknown as RetroWidget;
        el.setAttribute("project-key", key);
        for (const a of ["position", "lang", "theme", "accent", "api"]) {
          const v = tag!.getAttribute(`data-${a}`);
          if (v) el.setAttribute(a, v);
        }
        if (tag!.hasAttribute("data-hide-launcher")) el.setAttribute("hide-launcher", "");
        document.body.appendChild(el);
        flush();
      } catch (e) {
        if (typeof console !== "undefined") console.warn("[retro widget]", e);
      }
    };
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);
    // Explicit elements added later still get queued calls.
    document.addEventListener("DOMContentLoaded", flush);
  } catch (e) {
    if (typeof console !== "undefined") console.warn("[retro widget]", e);
  }
})();

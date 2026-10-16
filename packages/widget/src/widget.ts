/**
 * The <retro-widget> element: launcher + panel rendered in a Shadow DOM.
 * States: closed → pick (type) → form → sending → done | error.
 * Nothing here may throw into the host page; every handler is wrapped.
 */
import { ApiError, fetchConfig, submitFeedback, type FeedbackType, type Sentiment, type SubmitResult, type WidgetConfig } from "./api";
import { format, isRtl, resolveLang, stringsFor, type Strings } from "./i18n";
import { canCaptureScreen, captureScreen, fileToDataUrl, imageFromPaste } from "./screenshot";
import { CSS } from "./styles";
import { ensureContainer, loadTurnstile, turnstileLanguage, turnstileTheme, type TurnstileApi } from "./turnstile";
import {
  accentForeground,
  apiFromScriptSrc,
  elementAttrs,
  LANG_STORAGE_KEY,
  parseOptions,
  resolveTheme,
  safeStorageGet,
  THEME_STORAGE_KEY,
  type Theme,
  type WidgetOptions,
} from "./theme";

type Step = "pick" | "form" | "sending" | "done" | "error";
export type EventName = "open" | "close" | "submitted" | "error";
type Listener = (payload?: unknown) => void;

const ICONS = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
};
const EMOJI: Record<FeedbackType, string> = { bug: "🐞", feedback: "💬", feature: "💡" };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export class RetroWidget extends HTMLElement {
  private root: ShadowRoot;
  private opts!: WidgetOptions;
  private t!: Strings;
  private locale = "en-US";
  private config: WidgetConfig | null = null;
  private configPromise: Promise<void> | null = null;
  private open_ = false;
  private step: Step = "pick";
  private type: FeedbackType | null = null;
  private sentiment: Sentiment | null = null;
  private message = "";
  private email = "";
  private screenshot: string | null = null;
  private result: SubmitResult | null = null;
  private errorText = "";
  private identity: { id?: string; email?: string } = {};
  private meta: Record<string, unknown> = {};
  private listeners: Record<EventName, Listener[]> = { open: [], close: [], submitted: [], error: [] };
  private lastFocus: Element | null = null;
  private busyShot = false;
  private animateIn = false;
  private bound = false;
  // Turnstile (Phase 2): loaded only when the project config has a site key.
  private tsApi: TurnstileApi | null = null;
  private tsWidgetId: string | null = null;
  private tsToken: string | null = null;
  private tsWaiters: Array<(token: string | null) => void> = [];
  private tsLoading = false;
  private tsFailed = false;
  private docKey = (e: KeyboardEvent) => this.guard(() => { if (e.key === "Escape" && this.open_) this.close(); });

  static get observedAttributes() {
    return ["project-key", "position", "lang", "theme", "accent", "api", "hide-launcher"];
  }

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.guard(() => {
      if (!this.bound) {
        this.bound = true;
        // Keyboard handling on the host: shadow events are composed, so this
        // survives every re-render (the panel's innerHTML is rebuilt).
        this.addEventListener("keydown", (e) => this.guard(() => this.onKey(e as KeyboardEvent)));
      }
      this.readOptions();
      this.render();
      this.loadConfig();
    });
  }

  attributeChangedCallback() {
    if (!this.isConnected) return;
    this.guard(() => {
      this.readOptions();
      this.render();
    });
  }

  // ---- public API (window.retro delegates here) ----------------------------
  open(init?: { type?: FeedbackType; message?: string }) {
    this.guard(() => {
      if (init && init.type && this.typeEnabled(init.type)) {
        this.type = init.type;
        this.step = "form";
      } else if (this.step === "done" || this.step === "error") {
        this.reset();
      }
      if (init && typeof init.message === "string") this.message = init.message;
      if (!this.open_) {
        this.lastFocus = document.activeElement;
        this.open_ = true;
        this.animateIn = true;
        document.addEventListener("keydown", this.docKey);
        this.emit("open");
      }
      this.loadConfig();
      this.render();
      this.mountTurnstile();
      this.focusFirst();
    });
  }
  close() {
    this.guard(() => {
      if (!this.open_) return;
      this.open_ = false;
      document.removeEventListener("keydown", this.docKey);
      if (this.step === "done") this.reset();
      this.render();
      this.emit("close");
      const el = this.lastFocus as HTMLElement | null;
      if (el && typeof el.focus === "function") el.focus();
    });
  }
  identify(who: { id?: string; email?: string }) {
    this.guard(() => {
      this.identity = { ...this.identity, ...(who || {}) };
      if (who && who.email && !this.email) this.email = who.email;
      this.render();
    });
  }
  setMeta(obj: Record<string, unknown>) {
    this.guard(() => {
      this.meta = { ...this.meta, ...(obj || {}) };
    });
  }
  setLang(lang: string) {
    this.guard(() => {
      this.setAttribute("lang", lang);
    });
  }
  setTheme(theme: "auto" | Theme) {
    this.guard(() => {
      this.setAttribute("theme", theme);
    });
  }
  on(event: EventName, cb: Listener) {
    if (this.listeners[event] && typeof cb === "function") this.listeners[event].push(cb);
  }
  off(event: EventName, cb: Listener) {
    const l = this.listeners[event];
    if (l) this.listeners[event] = l.filter((f) => f !== cb);
  }

  // ---- internals -----------------------------------------------------------
  private guard(fn: () => void) {
    try {
      fn();
    } catch (e) {
      this.fail(e);
    }
  }
  private fail(e: unknown) {
    try {
      this.emit("error", e);
      if (typeof console !== "undefined") console.warn("[retro widget]", e);
    } catch {
      /* never propagate */
    }
  }
  private emit(name: EventName, payload?: unknown) {
    for (const cb of this.listeners[name].slice()) {
      try {
        cb(payload);
      } catch {
        /* listener errors are theirs */
      }
    }
    try {
      this.dispatchEvent(new CustomEvent(`retro:${name}`, { detail: payload, bubbles: true, composed: true }));
    } catch {
      /* ignore */
    }
  }

  private readOptions() {
    const script = (document.currentScript as HTMLScriptElement | null) || document.querySelector<HTMLScriptElement>('script[src*="widget"][data-project-key], script[data-retro-widget]');
    const defaultApi = apiFromScriptSrc(script ? script.src : (window as any).__retroScriptSrc);
    this.opts = parseOptions(elementAttrs(this), defaultApi);
    const htmlLang = document.documentElement.getAttribute("lang");
    this.locale = resolveLang(this.opts.lang, safeStorageGet(LANG_STORAGE_KEY), htmlLang, navigator.language);
    this.t = stringsFor(this.locale);
    const systemDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
    this.dataset.theme = resolveTheme(this.opts.theme, safeStorageGet(THEME_STORAGE_KEY), systemDark);
    this.dataset.pos = this.opts.position;
    this.setAttribute("dir", isRtl(this.locale) ? "rtl" : "ltr");
    if (this.opts.hideLauncher) this.setAttribute("data-hidden", "");
    else this.removeAttribute("data-hidden");
    this.applyAccent();
  }

  private applyAccent() {
    const accent = this.opts.accent || (this.config && this.config.accent) || null;
    if (accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) {
      this.style.setProperty("--accent", accent);
      this.style.setProperty("--accent-fg", accentForeground(accent));
    } else {
      this.style.removeProperty("--accent");
      this.style.removeProperty("--accent-fg");
    }
  }

  private loadConfig() {
    if (this.config || this.configPromise || !this.opts.projectKey) return;
    this.configPromise = fetchConfig(this.opts.api, this.opts.projectKey)
      .then((cfg) => {
        this.config = cfg;
        this.applyAccent();
        if (this.open_) this.mountTurnstile();
        if (this.type && !this.typeEnabled(this.type)) {
          this.type = null;
          this.step = "pick";
        }
        this.render();
      })
      .catch((e) => {
        // Keep working with defaults; the submit will surface a real error.
        this.configPromise = null;
        this.fail(e);
      });
  }

  private typesEnabled(): FeedbackType[] {
    const list = (this.config && this.config.types_enabled) || ["bug", "feedback", "feature"];
    return list.filter((t): t is FeedbackType => t === "bug" || t === "feedback" || t === "feature");
  }
  private typeEnabled(t: FeedbackType) {
    return this.typesEnabled().indexOf(t) !== -1;
  }
  private screenshotsAllowed() {
    if (!this.config) return true;
    const f = this.config.features || {};
    return this.config.allow_screenshots !== false && f.screenshots !== false;
  }
  private emailAllowed() {
    return !this.config || this.config.allow_email !== false;
  }
  private boardUrl(): string | null {
    const r = this.result && this.result.board_url;
    if (r) return r;
    if (this.config && this.config.board_url && (!this.config.features || this.config.features.public_boards !== false)) return this.config.board_url;
    return null;
  }

  private turnstileSiteKey(): string | null {
    const k = this.config && this.config.turnstile_site_key;
    return typeof k === "string" && k.trim() ? k.trim() : null;
  }

  /**
   * Load the Turnstile API and render the challenge into the slotted
   * light-DOM container. Idempotent; errors never block the form (the API
   * answers captcha_failed and the user sees a retryable error).
   */
  private mountTurnstile() {
    const siteKey = this.turnstileSiteKey();
    if (!siteKey || this.tsWidgetId || this.tsLoading || this.tsFailed) return;
    this.tsLoading = true;
    loadTurnstile()
      .then((api) => {
        this.tsApi = api;
        const container = ensureContainer(this);
        this.tsWidgetId = api.render(container, {
          sitekey: siteKey,
          theme: turnstileTheme(this.dataset.theme),
          language: turnstileLanguage(this.locale),
          appearance: "interaction-only",
          size: "flexible",
          callback: (token) => this.guard(() => this.onTurnstileToken(token)),
          "expired-callback": () => this.guard(() => this.onTurnstileToken(null)),
          "error-callback": () => this.guard(() => this.onTurnstileToken(null)),
          "timeout-callback": () => this.guard(() => this.onTurnstileToken(null)),
        });
      })
      .catch((e) => {
        this.tsFailed = true;
        this.fail(e);
      })
      .then(() => {
        this.tsLoading = false;
      });
  }

  private onTurnstileToken(token: string | null) {
    this.tsToken = token;
    const waiters = this.tsWaiters;
    this.tsWaiters = [];
    for (const w of waiters) w(token);
  }

  /** Current token, or wait (bounded) for the challenge to produce one. */
  private turnstileToken(timeoutMs = 12000): Promise<string | null> {
    if (!this.turnstileSiteKey()) return Promise.resolve(null);
    if (this.tsToken) return Promise.resolve(this.tsToken);
    if (!this.tsWidgetId && !this.tsLoading) this.mountTurnstile();
    if (this.tsFailed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.tsWaiters = this.tsWaiters.filter((w) => w !== done);
        resolve(this.tsToken);
      }, timeoutMs);
      const done = (token: string | null) => {
        clearTimeout(timer);
        resolve(token);
      };
      this.tsWaiters.push(done);
    });
  }

  /** A token is single-use: clear it and ask Turnstile for a fresh one. */
  private resetTurnstile() {
    this.tsToken = null;
    if (this.tsApi && this.tsWidgetId) {
      try {
        this.tsApi.reset(this.tsWidgetId);
      } catch (e) {
        this.fail(e);
      }
    }
  }

  private reset() {
    this.step = "pick";
    this.type = null;
    this.sentiment = null;
    this.message = "";
    this.screenshot = null;
    this.result = null;
    this.errorText = "";
    if (this.identity.email) this.email = this.identity.email;
    else this.email = "";
  }

  // ---- rendering -----------------------------------------------------------
  private render() {
    const t = this.t;
    const launcher = `<button class="launcher" type="button" aria-label="${esc(t.launcher)}" aria-haspopup="dialog" aria-expanded="${this.open_}" data-act="toggle">${ICONS.chat}<span>${esc(t.launcher)}</span></button>`;
    const panel = this.open_ ? this.renderPanel() : "";
    this.root.innerHTML = `<style>${CSS}</style>${panel}${launcher}`;
    this.bind();
  }

  private renderPanel(): string {
    const t = this.t;
    const backBtn = (this.step === "form" || this.step === "error") && this.typesEnabled().length > 1
      ? `<button class="icon" type="button" data-act="back" aria-label="${esc(t.back)}">${ICONS.back}</button>`
      : "";
    const title = this.config && this.config.project && this.config.project.name ? `${esc(t.title)} · ${esc(this.config.project.name)}` : esc(t.title);
    let body = "";
    switch (this.step) {
      case "pick":
        body = this.renderPick();
        break;
      case "form":
      case "sending":
        body = this.renderForm();
        break;
      case "done":
        body = this.renderDone();
        break;
      case "error":
        body = this.renderForm(this.errorText || t.error);
        break;
    }
    const cls = this.animateIn ? "panel in" : "panel";
    this.animateIn = false;
    return `<section class="${cls}" role="dialog" aria-modal="false" aria-labelledby="rw-title">
      <header class="head">${backBtn}<h2 id="rw-title">${title}</h2>
        <button class="icon" type="button" data-act="close" aria-label="${esc(t.close)}">${ICONS.x}</button></header>
      <div class="body">${body}</div>
      <a class="brand" href="https://retro.3m4.net" target="_blank" rel="noopener">retro</a>
    </section>`;
  }

  private renderPick(): string {
    const t = this.t;
    const types = this.typesEnabled();
    if (types.length === 1) {
      this.type = types[0];
      this.step = "form";
      return this.renderForm();
    }
    return `<p class="intro">${esc(t.intro)}</p><div class="choices" role="group" aria-label="${esc(t.intro)}">${types
      .map((ty) => `<button class="choice" type="button" data-act="type" data-type="${ty}"><span class="em" aria-hidden="true">${EMOJI[ty]}</span><span>${esc(t[ty])}</span></button>`)
      .join("")}</div>`;
  }

  private renderForm(error = ""): string {
    const t = this.t;
    const ty = this.type || "feedback";
    const sending = this.step === "sending";
    const chips = ty === "feedback"
      ? `<div class="chips" role="group" aria-label="${esc(t.feedback)}">
          <button class="chip" type="button" data-act="sent" data-s="positive" aria-pressed="${this.sentiment === "positive"}">👍 ${esc(t.good)}</button>
          <button class="chip" type="button" data-act="sent" data-s="negative" aria-pressed="${this.sentiment === "negative"}">👎 ${esc(t.bad)}</button></div>`
      : "";
    const email = this.emailAllowed()
      ? `<input type="email" name="email" autocomplete="email" placeholder="${esc(t.emailPlaceholder)}" aria-label="${esc(t.emailPlaceholder)}" value="${esc(this.email)}" ${sending ? "disabled" : ""}>`
      : "";
    let shot = "";
    if (this.screenshotsAllowed()) {
      shot = this.screenshot
        ? `<div class="shot"><img src="${this.screenshot}" alt=""><button class="link" type="button" data-act="rmshot">${esc(t.remove)}</button></div>`
        : `<button class="attach" type="button" data-act="shot" ${this.busyShot || sending ? "disabled" : ""}>${ICONS.cam}<span>${esc(t.attach)}</span></button>
           <input class="sr" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-act="file" tabindex="-1" aria-hidden="true">`;
    }
    return `<form novalidate>
      <div class="type"><span class="em" aria-hidden="true">${EMOJI[ty]}</span><span>${esc(t[ty])}</span></div>
      ${chips}
      <textarea name="message" required maxlength="5000" placeholder="${esc(t.messagePlaceholder)}" aria-label="${esc(t.messagePlaceholder)}" ${sending ? "disabled" : ""}>${esc(this.message)}</textarea>
      ${email}
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      ${shot}
      ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
      ${this.turnstileSiteKey() ? '<div class="captcha"><slot name="turnstile"></slot></div>' : ""}
      <div class="foot"><button class="btn primary" type="submit" ${sending ? "disabled" : ""}>${esc(sending ? t.sending : t.send)}</button></div>
    </form>`;
  }

  private renderDone(): string {
    const t = this.t;
    const n = this.result ? this.result.number : null;
    const board = this.boardUrl();
    return `<div class="done"><div class="big" aria-hidden="true">🎉</div>
      <p>${esc(t.thanks)}</p>
      ${n != null ? `<p class="ref">${esc(format(t.thanksNumber, { n }))}</p>` : ""}
      ${board ? `<a href="${esc(board)}" target="_blank" rel="noopener">${esc(t.roadmap)} →</a>` : ""}
      <div class="foot" style="justify-content:center"><button class="btn ghost" type="button" data-act="close">${esc(t.close)}</button></div></div>`;
  }

  private bind() {
    const r = this.root;
    r.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
      const act = el.dataset.act;
      if (act === "file") {
        el.addEventListener("change", (e) => this.guard(() => this.onFile(e)));
        return;
      }
      el.addEventListener("click", (e) => this.guard(() => this.onAction(act || "", el, e)));
    });
    const form = r.querySelector("form");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        this.guard(() => this.submit());
      });
      const ta = form.querySelector<HTMLTextAreaElement>("textarea");
      if (ta) {
        ta.addEventListener("input", () => (this.message = ta.value));
        ta.addEventListener("paste", (e) => this.guard(() => this.onPaste(e as ClipboardEvent)));
      }
      const em = form.querySelector<HTMLInputElement>('input[type="email"]');
      if (em) em.addEventListener("input", () => (this.email = em.value));
    }
  }

  private onAction(act: string, el: HTMLElement, e: Event) {
    switch (act) {
      case "toggle":
        this.open_ ? this.close() : this.open();
        break;
      case "close":
        this.close();
        break;
      case "back":
        this.type = null;
        this.step = "pick";
        this.render();
        this.focusFirst();
        break;
      case "type":
        this.type = el.dataset.type as FeedbackType;
        this.step = "form";
        this.render();
        this.focusFirst();
        break;
      case "sent": {
        const s = el.dataset.s as Sentiment;
        this.sentiment = this.sentiment === s ? null : s;
        this.render();
        break;
      }
      case "shot":
        e.preventDefault();
        this.attach();
        break;
      case "rmshot":
        this.screenshot = null;
        this.render();
        break;
    }
  }

  private onKey(e: KeyboardEvent) {
    if (!this.open_) return;
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key === "Tab") {
      // Focus trap inside the panel.
      const focusable = Array.from(
        this.root.querySelectorAll<HTMLElement>('.panel button:not([disabled]), .panel textarea:not([disabled]), .panel input:not([disabled]):not(.hp):not(.sr), .panel a[href]'),
      );
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = this.root.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  private focusFirst() {
    const el = this.root.querySelector<HTMLElement>(".panel textarea, .panel .choice, .panel .btn, .panel .icon");
    if (el) el.focus();
  }

  // ---- screenshot ----------------------------------------------------------
  private async attach() {
    if (this.busyShot) return;
    if (canCaptureScreen()) {
      this.busyShot = true;
      this.setAttribute("data-capturing", "");
      try {
        // Give the browser a frame to hide the panel before the picker shows.
        await new Promise((r) => setTimeout(r, 60));
        this.screenshot = await captureScreen();
        this.step = this.step === "error" ? "form" : this.step;
      } catch (e) {
        // User cancelled or capture unsupported → fall back to the file picker.
        const name = e && (e as any).name;
        if (name !== "NotAllowedError" && name !== "AbortError") this.fail(e);
        this.removeAttribute("data-capturing");
        this.busyShot = false;
        this.render();
        if (name !== "NotAllowedError" && name !== "AbortError") this.pickFile();
        return;
      }
      this.removeAttribute("data-capturing");
      this.busyShot = false;
      this.render();
      return;
    }
    this.pickFile();
  }
  private pickFile() {
    const input = this.root.querySelector<HTMLInputElement>('input[data-act="file"]');
    if (input) input.click();
  }
  private onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    this.useFile(file);
  }
  private onPaste(e: ClipboardEvent) {
    if (!this.screenshotsAllowed()) return;
    const file = imageFromPaste(e);
    if (!file) return;
    e.preventDefault();
    this.useFile(file);
  }
  private useFile(file: Blob) {
    this.busyShot = true;
    this.render();
    fileToDataUrl(file)
      .then((url) => {
        this.screenshot = url;
      })
      .catch((err) => {
        this.fail(err);
        this.errorText = this.t.screenshotError;
        this.step = "error";
      })
      .then(() => {
        this.busyShot = false;
        this.render();
      });
  }

  // ---- submit --------------------------------------------------------------
  private async submit() {
    const msg = this.message.trim();
    if (!msg || !this.type) {
      const ta = this.root.querySelector<HTMLTextAreaElement>("textarea");
      if (ta) ta.focus();
      return;
    }
    const hp = this.root.querySelector<HTMLInputElement>("input.hp");
    this.step = "sending";
    this.errorText = "";
    this.render();
    try {
      const turnstileToken = await this.turnstileToken();
      const payload = {
        type: this.type,
        message: msg,
        sentiment: this.type === "feedback" && this.sentiment ? this.sentiment : undefined,
        email: this.emailAllowed() && this.email.trim() ? this.email.trim() : undefined,
        reporter_id: this.identity.id,
        page_url: location.href.split("#")[0],
        locale: this.locale,
        metadata: {
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          screen: `${screen.width}x${screen.height}`,
          referrer: document.referrer || undefined,
          ...this.meta,
        },
        screenshot: this.screenshotsAllowed() && this.screenshot ? this.screenshot : undefined,
        turnstile_token: turnstileToken || undefined,
        website: hp ? hp.value : "",
      };
      this.result = await submitFeedback(this.opts.api, this.opts.projectKey, payload);
      this.step = "done";
      this.resetTurnstile();
      this.render();
      this.emit("submitted", { id: this.result.id, number: this.result.number });
      this.focusFirst();
    } catch (e) {
      this.step = "error";
      const code = e instanceof ApiError ? e.code : "";
      this.errorText = code === "screenshot_too_large" ? this.t.screenshotError : code === "captcha_failed" ? this.t.captchaError : this.t.error;
      if (code === "captcha_failed") this.resetTurnstile();
      this.render();
      this.fail(e);
    }
  }
}

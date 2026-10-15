/** Theme + language + attribute resolution (pure where possible, so it is testable). */
export type Theme = "light" | "dark";
export type Position = "bottom-right" | "bottom-left";

export const THEME_STORAGE_KEY = "3m4.theme";
export const LANG_STORAGE_KEY = "3m4.lang";

export interface WidgetOptions {
  projectKey: string;
  position: Position;
  lang: string; // "auto" or a locale
  theme: "auto" | Theme;
  accent?: string;
  api: string;
  hideLauncher: boolean;
}

export function safeStorageGet(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

/** attribute → saved pref → system preference. */
export function resolveTheme(attr: string | null | undefined, saved: string | null, systemDark: boolean): Theme {
  if (attr === "light" || attr === "dark") return attr;
  if (saved === "light" || saved === "dark") return saved;
  return systemDark ? "dark" : "light";
}

export function isHexColor(v: string | null | undefined): v is string {
  return !!v && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
}

/** Derive the API base from the script's own origin (https://retro.3m4.net/widget.js → https://retro.3m4.net/api). */
export function apiFromScriptSrc(src: string | null | undefined): string {
  if (!src) return "/api";
  try {
    const u = new URL(src, typeof location !== "undefined" ? location.href : "http://localhost");
    return `${u.origin}/api`;
  } catch {
    return "/api";
  }
}

export interface AttrSource {
  get(name: string): string | null;
  has(name: string): boolean;
}

/** Parse options from `<retro-widget …>` attributes or `<script data-…>` attributes. */
export function parseOptions(attrs: AttrSource, defaultApi: string): WidgetOptions {
  const pos = attrs.get("position");
  const theme = attrs.get("theme");
  const accent = attrs.get("accent");
  return {
    projectKey: (attrs.get("project-key") || "").trim(),
    position: pos === "bottom-left" ? "bottom-left" : "bottom-right",
    lang: (attrs.get("lang") || "auto").trim() || "auto",
    theme: theme === "light" || theme === "dark" ? theme : "auto",
    accent: isHexColor(accent) ? accent : undefined,
    api: (attrs.get("api") || defaultApi).replace(/\/+$/, ""),
    hideLauncher: attrs.has("hide-launcher"),
  };
}

/** Wrap an Element's attributes, or a script tag's data-* attributes, as an AttrSource. */
export function elementAttrs(el: Element, dataPrefix = ""): AttrSource {
  return {
    get: (n) => el.getAttribute(dataPrefix + n),
    has: (n) => el.hasAttribute(dataPrefix + n),
  };
}

/** Contrast-aware text colour for the accent button (black on light accents). */
export function accentForeground(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0f172a" : "#ffffff";
}

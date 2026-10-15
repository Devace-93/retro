import { describe, expect, test } from "bun:test";
import { baseOf, format, isRtl, LOCALES, resolveLang, stringsFor } from "../src/i18n";
import { dataUrlBytes, fitWithin } from "../src/screenshot";
import { accentForeground, apiFromScriptSrc, isHexColor, parseOptions, resolveTheme, type AttrSource } from "../src/theme";

const attrs = (map: Record<string, string>): AttrSource => ({ get: (n) => (n in map ? map[n] : null), has: (n) => n in map });

describe("i18n", () => {
  test("ships 34 locales and every one resolves to a full catalog", () => {
    expect(LOCALES.length).toBe(34);
    const en = stringsFor("en-US");
    for (const l of LOCALES) {
      const s = stringsFor(l);
      for (const k of Object.keys(en)) expect(typeof (s as any)[k]).toBe("string");
    }
  });
  test("falls back to English for unknown languages", () => {
    expect(stringsFor("xx-YY").send).toBe("Send");
    expect(stringsFor("").title).toBe("Send feedback");
  });
  test("base language and country variants", () => {
    expect(stringsFor("es-AR").send).toBe("Enviar");
    expect(stringsFor("pt-PT").intro).not.toBe(stringsFor("pt-BR").intro);
    expect(baseOf("pt-BR")).toBe("pt");
  });
  test("resolveLang prefers the first usable candidate", () => {
    expect(resolveLang("auto", null, undefined, "fr")).toBe("fr-FR");
    expect(resolveLang("es-CL", "en-US")).toBe("es-CL");
    expect(resolveLang("de", "es-MX")).toBe("de-DE");
    expect(resolveLang("pt_PT")).toBe("pt-PT");
    expect(resolveLang(null, "klingon")).toBe("en-US");
  });
  test("rtl + format", () => {
    expect(isRtl("ar-SA")).toBe(true);
    expect(isRtl("he")).toBe(false);
    expect(format("Reference #{n}", { n: 42 })).toBe("Reference #42");
    expect(format("{missing}", {})).toBe("{missing}");
  });
});

describe("theme + options", () => {
  test("resolveTheme precedence: attribute > saved > system", () => {
    expect(resolveTheme("dark", "light", false)).toBe("dark");
    expect(resolveTheme("auto", "light", true)).toBe("light");
    expect(resolveTheme(null, null, true)).toBe("dark");
    expect(resolveTheme(null, "bogus", false)).toBe("light");
  });
  test("parseOptions defaults and validation", () => {
    const o = parseOptions(attrs({ "project-key": " retro_pub_x ", accent: "nope", api: "https://x.test/api/" }), "/api");
    expect(o.projectKey).toBe("retro_pub_x");
    expect(o.position).toBe("bottom-right");
    expect(o.lang).toBe("auto");
    expect(o.theme).toBe("auto");
    expect(o.accent).toBeUndefined();
    expect(o.api).toBe("https://x.test/api");
    expect(o.hideLauncher).toBe(false);
    const p = parseOptions(attrs({ position: "bottom-left", theme: "dark", accent: "#abc", "hide-launcher": "", lang: "es-MX" }), "/api");
    expect(p.position).toBe("bottom-left");
    expect(p.theme).toBe("dark");
    expect(p.accent).toBe("#abc");
    expect(p.hideLauncher).toBe(true);
    expect(p.lang).toBe("es-MX");
  });
  test("api derived from script origin", () => {
    expect(apiFromScriptSrc("https://retro.3m4.net/widget.js")).toBe("https://retro.3m4.net/api");
    expect(apiFromScriptSrc("http://localhost:8082/widget/v1.js")).toBe("http://localhost:8082/api");
    expect(apiFromScriptSrc(null)).toBe("/api");
  });
  test("accent helpers", () => {
    expect(isHexColor("#10b981")).toBe(true);
    expect(isHexColor("10b981")).toBe(false);
    expect(accentForeground("#10b981")).toBe("#ffffff");
    expect(accentForeground("#ffff00")).toBe("#0f172a");
  });
});

describe("screenshot math", () => {
  test("fitWithin keeps aspect ratio and caps the long side", () => {
    expect(fitWithin(3200, 1800)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(900, 3600)).toEqual({ width: 400, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 10)).toEqual({ width: 0, height: 0 });
  });
  test("dataUrlBytes decodes base64 length", () => {
    const bytes = new Uint8Array(1000);
    const b64 = Buffer.from(bytes).toString("base64");
    expect(dataUrlBytes(`data:image/png;base64,${b64}`)).toBe(1000);
    expect(dataUrlBytes("nope")).toBe(0);
  });
});

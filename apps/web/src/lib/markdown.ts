/**
 * Tiny, safe Markdown renderer for changelog entries, roadmap descriptions
 * and board intros. Supports: `#`–`###` headings, paragraphs, unordered and
 * ordered lists, **bold**, *italic*, `inline code`, fenced code blocks and
 * [links](https://…). Every piece of text is HTML-escaped first and only
 * http(s)/mailto links survive, so untrusted input cannot inject markup.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) return escapeHtml(u);
  if (u.startsWith("/") && !u.startsWith("//")) return escapeHtml(u);
  return null;
}

/** Inline formatting on an already-escaped line. */
function inline(text: string): string {
  let out = escapeHtml(text);
  // code spans first so their content is left alone by the other rules
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, "&"));
    return href ? `<a href="${href}" rel="noopener noreferrer" target="_blank">${label}</a>` : label;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
  return out;
}

export function renderMarkdown(src: string): string {
  const lines = (src || "").replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      html.push(`<${list.kind}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.kind}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (code) {
      if (/^```/.test(line)) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (/^```/.test(line)) {
      flushPara();
      flushList();
      code = [];
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const level = h[1].length + 1; // # → h2 inside a page that already has an h1
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  if (code) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushPara();
  flushList();
  return html.join("\n");
}

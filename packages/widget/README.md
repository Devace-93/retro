# @retro/widget

The drop-in feedback widget for [retro](https://retro.3m4.net). One script tag,
zero dependencies, Shadow DOM, ~17 KB gzipped. Built by `bun run build` into
`apps/web/public/widget.js` (and `widget/v1.js`), which the web service serves
at `https://retro.3m4.net/widget.js`.

## Install

```html
<!-- 1. One tag, auto-mount -->
<script src="https://retro.3m4.net/widget.js" data-project-key="retro_pub_…" defer></script>

<!-- 2. Explicit element (any framework: Qwik, Astro, Svelte, jQuery, Phaser pages…) -->
<script src="https://retro.3m4.net/widget.js" defer></script>
<retro-widget project-key="retro_pub_…" position="bottom-right" lang="auto" theme="auto"></retro-widget>

<!-- 3. Headless: your own button -->
<script src="https://retro.3m4.net/widget.js" data-project-key="retro_pub_…" data-hide-launcher defer></script>
<button onclick="retro.open({ type: 'bug' })">Report a bug</button>
```

The project public key is shown in the project settings of the dashboard. It is
public by design (it ships in your page); rotate it there if it gets abused.

## Attributes

Use them on `<retro-widget>` or as `data-*` on the script tag.

| attribute | default | notes |
|---|---|---|
| `project-key` | required | `retro_pub_…` |
| `position` | `bottom-right` | or `bottom-left` |
| `lang` | `auto` | `auto` = localStorage `3m4.lang` → `<html lang>` → `navigator.language`. Any of the 34 app locales; others fall back to English. RTL for Arabic. |
| `theme` | `auto` | `auto` = localStorage `3m4.theme` → `prefers-color-scheme`; or `light` / `dark` |
| `accent` | project setting | hex colour; overrides the project's `widget_accent` |
| `api` | script origin + `/api` | base URL of the retro API (self-hosting, local dev) |
| `hide-launcher` | off | boolean; headless mode, open with `retro.open()` |

## `window.retro`

```js
retro.open({ type: "bug", message: "prefilled" }); // type is optional
retro.close();
retro.identify({ id: "user-42", email: "a@b.c" });   // sent as reporter_id / prefills email
retro.setMeta({ app_build: "1.4.0", plan: "pro" });  // merged into metadata
retro.setLang("es-MX");
retro.setTheme("dark");                               // "light" | "dark" | "auto"
retro.on("submitted", ({ id, number }) => console.log("feedback", number));
retro.on("open" | "close" | "error", cb);
retro.element(); // the <retro-widget> element or null
```

Calls made before the element exists are queued and replayed on mount. Every
event is also dispatched as a DOM `CustomEvent` (`retro:open`, `retro:close`,
`retro:submitted`, `retro:error`) on the element.

## What gets sent

`POST {api}/ingest/feedback` with headers `X-Project-Key` and
`X-Retro-Source: widget`, JSON body: `type`, `message`, `sentiment` (feedback
only), `email` (if allowed), `reporter_id`, `page_url` (no hash), `locale`,
`metadata` (`viewport`, `screen`, `referrer` + your `setMeta`), optional
`screenshot` data URL and the honeypot `website: ""`. On boot the widget
fetches `GET {api}/ingest/config` for the project's enabled types, screenshot /
email toggles, accent and board URL; if that fails it keeps working with
defaults.

## Screenshots

- Desktop browsers with `getDisplayMedia` (Chrome, Edge, Firefox, Safari 13+):
  the user picks a screen / window / tab and one frame is grabbed. The widget
  hides itself while the picker is open so it is not in the capture. If the
  user cancels, nothing happens; if capture is unsupported, the file picker opens.
- Everywhere else (mobile, restricted contexts): file picker, or paste an image
  into the message box.
- Images are downscaled to ≤ 1600 px on the long side and encoded as JPEG
  (quality 0.82, lowered until ≤ 1.5 MB) or PNG when they have transparency.
- The control is hidden when the project disables screenshots or the
  `screenshots` feature is off.

## Content Security Policy

If your site sets a CSP, allow:

```
script-src  https://retro.3m4.net;
connect-src https://retro.3m4.net;
img-src     data: blob:;   /* screenshot preview */
```

## Browser support

Evergreen browsers (Chrome/Edge 80+, Firefox 75+, Safari 13.1+). Requires
Custom Elements, Shadow DOM and `fetch`; the bundle uses ES2019 syntax only.
Screen capture needs `getDisplayMedia` (desktop only); other paths work on
mobile. Failures never propagate to the host page: they are logged with
`console.warn` and emitted as `error` events.

## Development

```sh
cd packages/widget
bun install
bun run build      # writes apps/web/public/widget.js and widget/v1.js, fails over 25 KB gz
bun test
bun run typecheck
```

Open `docs/widget/demo.html` in a browser (it points `data-api` at
`http://localhost:8082/api`; run the stack with `make up` and paste a real
public key to submit for real).

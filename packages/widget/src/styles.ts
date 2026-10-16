/** Shadow-root CSS. Colours come from custom properties set per theme on :host. */
export const CSS = `
:host{all:initial;position:fixed;z-index:2147483000;bottom:20px;font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--fg);
--accent:#10b981;--accent-fg:#fff;--bg:#fff;--fg:#0f172a;--muted:#64748b;--border:#e2e8f0;--soft:#f1f5f9;--soft-hover:#e2e8f0;--danger:#dc2626;--shadow:0 20px 50px -12px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06);--radius:16px}
:host([data-theme="dark"]){--bg:#0f172a;--fg:#f1f5f9;--muted:#94a3b8;--border:#334155;--soft:#1e293b;--soft-hover:#334155;--danger:#f87171;--shadow:0 20px 50px -12px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.08)}
:host([data-pos="bottom-right"]){right:20px}
:host([data-pos="bottom-left"]){left:20px}
:host([dir="rtl"]) .panel{direction:rtl}
*,*::before,*::after{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0;margin:0}
textarea,input{font:inherit;color:inherit}
.launcher{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 16px 0 14px;border-radius:999px;background:var(--accent);color:var(--accent-fg);box-shadow:0 10px 30px -10px rgba(15,23,42,.5);font-weight:600;letter-spacing:.01em;transition:transform .15s ease,box-shadow .15s ease}
.launcher:hover{transform:translateY(-1px);box-shadow:0 14px 34px -10px rgba(15,23,42,.55)}
.launcher:focus-visible,.btn:focus-visible,.choice:focus-visible,.icon:focus-visible,.chip:focus-visible,textarea:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.launcher svg{width:18px;height:18px}
:host([data-hidden]) .launcher{display:none}
.panel{position:absolute;bottom:56px;width:min(360px,calc(100vw - 40px));background:var(--bg);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;transform-origin:bottom right}
.panel.in{animation:in .18s ease}
:host([data-pos="bottom-right"]) .panel{right:0}
:host([data-pos="bottom-left"]) .panel{left:0;transform-origin:bottom left}
:host([data-hidden]) .panel{bottom:0}
:host([data-capturing]) .panel,:host([data-capturing]) .launcher{visibility:hidden}
@keyframes in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.panel.in{animation:none}.launcher{transition:none}}
.head{display:flex;align-items:center;gap:8px;padding:14px 14px 10px}
.head h2{flex:1;margin:0;font-size:15px;font-weight:700}
.icon{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px;color:var(--muted)}
.icon:hover{background:var(--soft);color:var(--fg)}
.icon svg{width:18px;height:18px}
.body{padding:0 14px 14px}
.intro{margin:0 0 10px;color:var(--muted)}
.choices{display:grid;gap:8px}
.choice{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:12px;text-align:start;background:var(--bg);font-weight:600}
.choice:hover{background:var(--soft);border-color:var(--soft-hover)}
.choice .em{font-size:22px;line-height:1;width:28px;text-align:center}
.type{display:inline-flex;align-items:center;gap:8px;font-weight:600;margin-bottom:10px}
.type .em{font-size:18px}
.chips{display:flex;gap:8px;margin-bottom:10px}
.chip{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px;border:1px solid var(--border);border-radius:10px;font-weight:600;color:var(--muted)}
.chip[aria-pressed="true"]{border-color:var(--accent);color:var(--fg);background:color-mix(in srgb,var(--accent) 12%,transparent)}
textarea{display:block;width:100%;min-height:104px;max-height:40vh;resize:vertical;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--bg)}
textarea::placeholder,input::placeholder{color:var(--muted)}
input[type=email]{display:block;width:100%;margin-top:8px;padding:9px 12px;border:1px solid var(--border);border-radius:12px;background:var(--bg)}
.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.shot{display:flex;align-items:center;gap:10px;margin-top:10px}
.shot img{width:72px;height:48px;object-fit:cover;border-radius:8px;border:1px solid var(--border)}
.link{color:var(--muted);text-decoration:underline;text-underline-offset:2px}
.link:hover{color:var(--fg)}
.attach{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-weight:600;margin-top:10px}
.attach:hover{color:var(--fg)}
.attach svg{width:16px;height:16px}
.foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:12px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:10px;font-weight:600}
.btn.primary{background:var(--accent);color:var(--accent-fg)}
.btn.primary[disabled]{opacity:.6;cursor:default}
.btn.ghost{color:var(--muted)}
.btn.ghost:hover{background:var(--soft);color:var(--fg)}
.err{margin:10px 0 0;color:var(--danger);font-size:13px}
.captcha{margin-top:10px;min-height:0}
::slotted([data-retro-turnstile]){display:block}
.done{text-align:center;padding:14px 4px 6px}
.done .big{font-size:40px;line-height:1;margin-bottom:10px}
.done p{margin:6px 0}
.done .ref{color:var(--muted);font-size:13px}
.done a{display:inline-block;margin-top:8px;color:var(--accent);font-weight:600;text-decoration:none}
.brand{display:block;text-align:center;padding:8px;font-size:11px;color:var(--muted);text-decoration:none;border-top:1px solid var(--border)}
.brand:hover{color:var(--fg)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
`;

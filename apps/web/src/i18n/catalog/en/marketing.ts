/**
 * Marketing pages: landing, blog (chrome only, post bodies stay in
 * src/content/posts.ts), pricing/info/docs, sponsors, public boards,
 * early-access banner. Prefix keys by page: `landing.*`, `blog.*`,
 * `pricing.*`, `info.*`, `docs.*`, `sponsors.*`, `board.*`, `early.*`,
 * `building.*`. Strings that wrap markup are split into parts.
 */
export const marketing = {
  // Landing — hero
  "landing.badge": "Open source · MIT · Self-hostable",
  "landing.heroTitle": "Hear what your users think,",
  "landing.heroTitleAccent": "right inside your app",
  "landing.heroBody":
    "retro adds a feedback button to any app: bug reports, praise or complaints, feature requests — screenshot included. Everything lands in one inbox per project, becomes a public roadmap people can vote on, and ships as a changelog.",
  "landing.getStarted": "Get started free",
  "landing.whyFree": "Why it's free right now",
  "landing.seePricing": "See pricing",
  "landing.readDocs": "Read the docs",
  "landing.earlyNote": "Early access: every account gets full access, free. Plans come later, with notice.",
  "landing.freeNote": "Free plan: {projects} projects & {feedback} feedback submissions / month. No card required.",

  // Landing — three paths
  "landing.pathsTitle": "Three ways to collect feedback",
  "landing.pathsBody": "Pick the one that fits each app. They all land in the same inbox.",
  "landing.pathWidgetTitle": "Drop-in widget",
  "landing.pathWidgetBody":
    "One script tag, or a <retro-widget> element in any framework. Users pick bug / feedback / idea, write, attach a screenshot and send. Follows your theme and language.",
  "landing.pathApiTitle": "Ingest API",
  "landing.pathApiBody":
    "A single POST with the project's public key, from curl, fetch, a plain HTML form or your backend. Perfect for games, CLIs and apps without a DOM.",
  "landing.pathBoardTitle": "Public board",
  "landing.pathBoardBody":
    "Every project can publish a board: roadmap columns with votes, a changelog, and a form to submit ideas. Link it from your app or your footer.",

  // Landing — how it works
  "landing.howTitle": "How it works",
  "landing.step1Title": "1. Create a project",
  "landing.step1Body": "One project per app. You get a public key for the widget and the API, and a board slug.",
  "landing.step2Title": "2. Add the widget or the API call",
  "landing.step2Body": "Paste the snippet from the project settings. Feedback starts arriving in the inbox immediately.",
  "landing.step3Title": "3. Triage and close the loop",
  "landing.step3Body": "Set status, priority and tags, add notes, promote requests to the roadmap and announce them in the changelog.",

  // Landing — inbox → roadmap → changelog
  "landing.loopTitle": "From inbox to roadmap to changelog",
  "landing.loopBody": "Feedback is only useful if something happens with it. retro keeps the whole loop in one place.",
  "landing.loopInboxTitle": "Inbox.",
  "landing.loopInboxBody": "Filter by type, status, sentiment, priority or tag. Open an item to see the screenshot, the page, the version and the user's notes.",
  "landing.loopRoadmapTitle": "Roadmap.",
  "landing.loopRoadmapBody": "Promote a request to a planned / in progress / done item in one click. Users vote on the public board; linked feedback follows the status.",
  "landing.loopChangelogTitle": "Changelog.",
  "landing.loopChangelogBody": "Write release notes in Markdown, keep drafts, publish when it ships.",
  "landing.demoBug": "Export button does nothing on Safari",
  "landing.demoFeature": "Dark mode for the editor",
  "landing.demoPraise": "Love the new kinegram preview!",

  // Landing — API panel
  "landing.apiTitle": "An ingest API you can call from anywhere",
  "landing.apiBody":
    "The project's public key is not a secret — it ships inside your app. Abuse is contained by rate limits, size caps and a honeypot field, and you can rotate the key at any time. CORS is open, so a plain fetch from the browser works.",
  "landing.apiNote": "Public keys can only submit feedback. They can never read or change anything.",
  "landing.panelRequest": "Request",
  "landing.panelResponse": "Response",

  // Landing — MCP section
  "landing.mcpBadge": "Model Context Protocol",
  "landing.mcpTitle": "Let your AI agent triage the inbox",
  "landing.mcpIntro": "retro ships an MCP server. Connect it to Claude Code, Claude Desktop, Cursor or any MCP host and ask things like",
  "landing.mcpExample1": "“summarise this week's feedback for kinegram and tag the duplicates”",
  "landing.mcpOr": "or",
  "landing.mcpExample2": "“promote the three most requested ideas to the roadmap”",
  "landing.mcpBullet1Title": "Role-scoped keys.",
  "landing.mcpBullet1Body": "A viewer key never even sees the delete tool; editor and admin unlock more. Enforced by the API too.",
  "landing.mcpBullet2Title": "Human in the loop.",
  "landing.mcpBullet2Body": "Destructive actions ask you to confirm before anything happens.",
  "landing.mcpBullet3Title": "Audit trail.",
  "landing.mcpBullet3Body": "Every change and every refused call is logged, server-side and agent-side.",
  "landing.mcpBullet4Title": "Local or remote.",
  "landing.mcpBullet4Body1": "Run it over stdio with",
  "landing.mcpBullet4Npm": "npm",
  "landing.mcpBullet4Body2": "or point your host at",
  "landing.mcpBullet4Body3": "with your key.",
  "landing.mcpPanelLocal": "Claude Code · local (npm)",
  "landing.mcpPanelRemote": "Claude Code · remote (nothing to install)",
  "landing.mcpPanelJson": "Any MCP host (JSON)",
  "landing.mcpKeyNote": "Create a key with the role you want under",
  "landing.mcpKeyLink": "Dashboard → API keys",

  // Landing — self-host callout + closing CTA
  "landing.selfhostTitle": "Self-host it (MIT, open source)",
  "landing.selfhostBody1":
    "The entire stack — Flask API, widget, MCP server and this Qwik app — is MIT-licensed. Run it on your own VPS with one",
  "landing.selfhostBody2": ". No billing code, no limits beyond what you configure.",
  "landing.viewGithub": "View on GitHub",
  "landing.ctaTitle": "Start listening today",
  "landing.ctaBody": "Create a project, paste one script tag and receive your first feedback in under five minutes.",

  // Blog (chrome only)
  "blog.title": "Blog",
  "blog.intro": "Product updates, engineering notes and tips on turning feedback into a roadmap.",
  "blog.comingSoon": "Coming soon.",
  "blog.readMore": "Read more →",
  "blog.allPosts": "← All posts",
  "blog.notFoundTitle": "Post not found",
  "blog.notFoundBody": "There is no post at",
  "blog.backToBlog": "Back to Blog",
  "blog.seeTiers": "See the planned tiers",

  // Info index
  "info.title": "Info",
  "info.intro": "Reference pages for retro. More will land here over time.",
  "info.pricingTitle": "Pricing",
  "info.pricingBody": "Plans, limits and prices.",
  "info.plannedPricingTitle": "Planned pricing",
  "info.plannedPricingBody": "The tiers we intend to introduce after early access.",
  "info.docsTitle": "Docs",
  "info.docsBody": "Widget install guide, ingest API, REST quick reference and MCP setup.",
  "info.termsTitle": "Terms",
  "info.termsBody": "Terms of service (coming soon).",
  "info.privacyTitle": "Privacy",
  "info.privacyBody": "What we store and what we never store (coming soon).",
  "info.comingSoon": "This page is coming soon.",
  "info.backToInfo": "Back to Info",

  // Pricing page
  "pricing.title": "Simple, honest pricing",
  "pricing.titlePlanned": "Planned pricing",
  "pricing.intro":
    "Start free. Upgrade when you need more projects, more feedback per month, more screenshot storage or longer audit retention. Self-host for unlimited everything.",
  "pricing.introPlanned": "These are the tiers we intend to introduce after early access. Nothing here applies yet.",
  "pricing.earlyTitle": "Right now every account has full access, free.",
  "pricing.earlyBody":
    "Unlimited projects, feedback, screenshots and boards, the API and the MCP server. When plans arrive we will announce it on the blog and by email before any limit applies to an existing account. Prices and limits below may still change.",
  "pricing.earlyCta": "Read what paid plans will include",
  "pricing.enterpriseTitle": "Need custom limits, SSO or an SLA?",
  "pricing.enterpriseBody": "Enterprise plans are tailored to your team.",
  "pricing.contactUs": "Contact us",
  "pricing.footnote":
    "All prices in USD. Annual billing saves ~20%. Project, roadmap-item and key counts are hard limits; feedback over the monthly budget is still accepted — we only report the overage. Past the storage cap, feedback is stored without the screenshot.",
  "pricing.footnoteEarly": "None of this is enforced during early access.",

  // Pricing table (plan labels come from packages/shared/plan_limits.json)
  "pricing.mostPopular": "Most popular",
  "pricing.perMonth": "/mo",
  "pricing.perYear": "/yr",
  "pricing.projects": "projects",
  "pricing.feedbackPerMonth": "feedback / mo",
  "pricing.screenshotStorage": "screenshot storage",
  "pricing.roadmapItems": "roadmap items / project",
  "pricing.apiKeys": "API keys",
  "pricing.auditRetention": "{value} audit retention",
  "pricing.user": "user",
  "pricing.users": "users",
  "pricing.api": "{api} API",
  "pricing.sponsorsBadge": "/sponsors badge",
  "pricing.teamExtras": "Roles + priority support",
  "pricing.enterpriseExtras": "SSO, SLA, custom limits",
  "pricing.getStarted": "Get started",
  "pricing.startPlan": "Start {plan}",

  // Docs
  "docs.title": "Docs",
  "docs.intro":
    "How to put retro in your app, send feedback from anywhere, and manage it through the REST API or an AI agent. The full contract — every endpoint, object and error — lives in the repository.",
  "docs.fullContract": "Read the full contract (CONTRACT.md)",
  "docs.baseUrl": "Base URL",
  "docs.widgetTitle": "Widget",
  "docs.widgetBody":
    "A zero-dependency web component served from this host. Add it with one script tag (it mounts itself) or place the element wherever you want. Works in Qwik, Astro, React, jQuery pages and Phaser games alike.",
  "docs.widgetScript": "One tag, auto-mount",
  "docs.widgetElement": "Explicit element",
  "docs.widgetAttrsTitle": "Attributes",
  "docs.attrProjectKey": "the project's public key (required).",
  "docs.attrLang": "auto (localStorage 3m4.lang → <html lang> → browser) or any of the 34 supported locales.",
  "docs.attrTheme": "auto (localStorage 3m4.theme → system), light or dark.",
  "docs.attrAccent": "hex colour; overrides the accent set in the project settings.",
  "docs.attrHideLauncher": "no floating button; open the panel yourself with retro.open().",
  "docs.widgetJsTitle": "JavaScript API",
  "docs.widgetJsBody":
    "window.retro exposes open({type?, message?}), close(), identify({id?, email?}), setMeta(object), setLang(), setTheme() and on(event, cb) with the events open, close, submitted and error.",
  "docs.widgetScreenshot":
    "Screenshots: on desktop the widget grabs one frame through the browser's screen-capture dialog; everywhere it also accepts a file or a pasted image. Images are downscaled to 1600 px and compressed before upload. The panel hides itself during capture.",
  "docs.ingestTitle": "Ingest API",
  "docs.ingestBody":
    "POST /api/ingest/feedback with the project's public key in the X-Project-Key header (or a project_key field). JSON and form-encoded bodies are both accepted, CORS is open, and the response carries the item's number so you can show it to the user.",
  "docs.ingestField1": "type (required): bug, feedback or feature — must be enabled on the project.",
  "docs.ingestField2": "message (required, ≤ 5000 chars); title optional, defaults to the first line.",
  "docs.ingestField3": "sentiment (positive / negative / neutral) for type=feedback; email, reporter_id, page_url, app_version, locale and a metadata object (≤ 8 KB) are optional.",
  "docs.ingestField4": "screenshot: a data URL (PNG/JPEG/WebP, ≤ 1.5 MB). Dropped, not rejected, past the storage cap.",
  "docs.ingestField5": "website: honeypot — leave it empty. Bots that fill it get a fake 201 and nothing is stored.",
  "docs.ingestForm": "Plain HTML form (no JavaScript)",
  "docs.authTitle": "Authentication",
  "docs.authBody": "Three kinds of credentials, each for one job:",
  "docs.authDashboard": "Dashboard sessions: JWT bearer tokens issued by /auth/login. Hold every scope.",
  "docs.authApiKey": "Management API: API keys with a role (viewer / editor / admin). Header X-API-Key: retro_live_… (or Authorization: Bearer).",
  "docs.authPublicKey":
    "Ingest API and widget: project public keys. Header X-Project-Key: retro_pub_…. They identify one project and can only submit feedback.",
  "docs.projectsTitle": "Projects",
  "docs.projectsBody":
    "A project is one app. It owns a public key, the board settings (slug, enabled, votes, submissions), the enabled feedback types and the widget options.",
  "docs.feedbackTitle": "Feedback",
  "docs.feedbackBody":
    "Items have a per-project number, a type, an optional sentiment, a status (new → triaged → planned → in_progress → done | declined), a priority, tags, private notes and at most one screenshot. Promoting an item creates a roadmap item and links them.",
  "docs.boardTitle": "Roadmap & changelog",
  "docs.boardBody":
    "Roadmap items live in three columns and can be reordered; public ones appear on the board and collect votes. Changelog entries are Markdown with an optional version; drafts stay private until published.",
  "docs.publicTitle": "Public board endpoints",
  "docs.publicBody":
    "No key needed. They answer only while the project's board is enabled. Votes are de-duplicated per voter_id (a UUID the browser keeps) and per hashed IP per day.",
  "docs.errorsTitle": "Errors & limits",
  "docs.errorsBody":
    "Errors are JSON: { \"error\": { \"code\", \"message\" } }. Creating past a plan limit answers 402 limit_reached with error.which = projects | api_keys | roadmap_items. Feedback over the monthly budget is still accepted.",
  "docs.privacyBody":
    "Privacy: retro never stores raw IP addresses — only a salted daily hash used for rate limits and vote de-duplication. User agents are truncated and metadata is capped at 8 KB.",
  "docs.mcpTitle": "MCP (AI agents)",
  "docs.mcpBody":
    "The MCP server exposes the management API as tools, filtered by the role of the key you connect with. Destructive tools ask for confirmation. A triage_inbox prompt walks a model through new items.",
  "docs.mcpLocal": "Local (stdio, npm)",
  "docs.mcpRemote": "Remote (Streamable HTTP)",
  "docs.mcpTools":
    "Tools: list_projects, get_project, create_project, update_project, rotate_project_key, delete_project, list_feedback, get_feedback, feedback_summary, list_tags, update_feedback, add_note, promote_to_roadmap, delete_feedback, list_roadmap, create_roadmap_item, update_roadmap_item, delete_roadmap_item, list_changelog, create_changelog_entry, update_changelog_entry, delete_changelog_entry, get_usage, get_audit_log.",
  "docs.webhooksTitle": "Webhooks",
  "docs.webhooksBody":
    "Get a signed POST on your server when feedback arrives or changes status, when a roadmap item moves, or when a changelog entry is published. Add endpoints in the project settings; each one gets a secret shown once.",
  "docs.webhooksEvents": "Events: feedback.created, feedback.status_changed, roadmap.status_changed, changelog.published, ping.",
  "docs.webhooksHeaders": "Headers: X-Retro-Event, X-Retro-Delivery (unique id, use it to de-duplicate) and X-Retro-Signature (sha256=<hex HMAC-SHA256 of the raw body with your secret>).",
  "docs.webhooksRetry": "A 2xx within 10 s counts as delivered; anything else is retried with exponential backoff (1 min → 2 h, 8 attempts). The deliveries log in the project settings shows every attempt.",
  "docs.webhooksVerify": "Verify the signature",
  "docs.exportTitle": "Export",
  "docs.exportBody":
    "One call returns everything in a project as retro.project.v1 JSON (feedback with notes, roadmap, changelog) or a CSV of the feedback items. Screenshots are never included. The same buttons live in the project settings.",
  "docs.turnstileTitle": "Spam protection (Cloudflare Turnstile)",
  "docs.turnstileBody":
    "The honeypot field and per-IP rate limits are always on. For public-facing apps you can add a Cloudflare Turnstile challenge: set the site key and secret in the project settings and the widget and board render it automatically. API clients must send turnstile_token; invalid tokens get 400 captcha_failed, and if Cloudflare is unreachable the item is accepted and tagged unverified.",
  "docs.notifyTitle": "Notifications & replies",
  "docs.notifyBody":
    "The account owner gets an email per project when new feedback arrives, instantly or grouped every 15 minutes, hour or day (Dashboard → API keys → Notifications). From the inbox you can reply to any reporter who left an email: the mail goes out from retro with your address as Reply-To. Both need outbound mail configured on the server (MAIL_ENABLED).",
  "docs.duplicatesTitle": "Duplicates & saved views",
  "docs.duplicatesBody":
    "Every new item is compared with the project's recent items (trigram similarity); likely duplicates show up in the detail drawer and can be merged in one click (the merged item becomes a declined duplicate). Saved views keep your favourite inbox filters one click away.",
  "docs.colMethod": "Method",
  "docs.colPath": "Path",
  "docs.colScope": "Scope",
  "docs.colNotes": "Notes",

  // Public board
  "board.kicker": "Roadmap & feedback",
  "board.roadmap": "Roadmap",
  "board.changelog": "Changelog",
  "board.vote": "Vote",
  "board.voteFailed": "Your vote could not be saved. Please try again.",
  "board.emptyColumn": "Nothing here yet.",
  "board.completedOn": "Shipped {date}",
  "board.submitTitle": "Have an idea or found a problem?",
  "board.submitBody": "Tell us. We read everything, and the best ideas end up on this roadmap.",
  "board.type": "Type",
  "board.message": "Your message",
  "board.send": "Send",
  "board.sending": "Sending…",
  "board.submitFailed": "Could not send your feedback. Please try again.",
  "board.thanksTitle": "Thank you!",
  "board.thanksBody": "Your feedback was received as #{number}.",
  "board.captchaFailed": "The anti-spam check failed. Please try again.",
  "board.submitAnother": "Send another",
  "board.backToRoadmap": "← Back to the roadmap",
  "board.noChangelog": "No release notes yet.",
  "board.poweredBy": "Powered by",
  "board.notFoundTitle": "This board is not available",
  "board.notFoundBody": "The project may have disabled its public board, or the link is wrong.",
  "board.home": "Go to retro",

  // Sponsors
  "sponsors.title": "Sponsors",
  "sponsors.intro1": "retro is open source (MIT). Every",
  "sponsors.introLink": "Pro / Supporter",
  "sponsors.intro2": "subscriber helps keep it free to self-host — and gets a badge and a spot on this page.",
  "sponsors.intro2Early": "subscriber will help keep it free to self-host — and will get a badge and a spot on this page.",
  "sponsors.emptyTitle": "Your name could be the first on this page.",
  "sponsors.emptyBody": "Every Pro / Supporter subscriber gets a spot here and an embeddable badge.",
  "sponsors.emptyBodyEarly": "Supporter subscriptions open together with paid plans, after early access. Until then every account is free.",
  "sponsors.tierSupporter": "{tier} supporter",
  "sponsors.badgeTitle": "The supporter badge",
  "sponsors.badgeBody": "Pro supporters get an embeddable badge for their site or README:",
  "sponsors.badgeBodyEarly": "Pro supporters will get an embeddable badge for their site or README:",
  "sponsors.badgeLabel": "retro Supporter",
  "sponsors.readPlans": "Read about the upcoming plans",
  "sponsors.become": "Become a supporter",

  // Early-access banner
  "early.bannerTitle": "Early access.",
  "early.bannerText": "Every account has full access at no cost right now. Plans and limits will be introduced later, with notice before anything changes.",
  "early.bannerLink": "What paid plans will include",

  // Site-building curtain
  "building.title": "We're building retro",
  "building.body":
    "User feedback, roadmap and changelog for your apps. The site isn't open yet — but the widget, the ingest API and the MCP server keep answering just fine.",
  "building.footer": "retro.3m4.net · coming soon",
} as const;

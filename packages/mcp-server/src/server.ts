/**
 * The retro MCP server: tools, resources and prompts over the retro management API.
 *
 * Design notes (the parts worth reading before changing anything):
 *
 * - **RBAC, three layers.** The key's scopes (from `GET /apikeys/me`) decide
 *   which tools are *registered* (hidden tools are never listed), each handler
 *   re-checks its scopes at call time, and the REST API enforces the same
 *   scopes independently. See `rbac.ts`.
 * - **Human approval for destructive actions.** The four `delete_*` tools ask
 *   the user through MCP *elicitation* when the client supports it (Claude
 *   Code, the Inspector). Otherwise they refuse until the model passes
 *   `confirm: true`, which forces the model to ask the user first.
 * - **Structured outputs.** Every tool declares an `outputSchema` and returns
 *   `structuredContent`, so hosts can validate and chain results without
 *   parsing prose. Objects that mirror API responses are *loose* (extra fields
 *   allowed) so an additive API change never breaks client-side validation.
 * - **Errors are results, not exceptions.** API errors come back as
 *   `isError: true` with the stable error code, so the model can recover
 *   (e.g. `limit_reached` → tell the user to upgrade) instead of crashing.
 * - **Everything is audited**, locally (`audit.ts`) and server-side.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { compactArgs, type AuditEntry, type AuditOutcome, type AuditSink } from "./audit.js";
import { RetroApiError, type RetroClient } from "./client.js";
import { TOOL_SCOPES, hasAllScopes, type ToolName } from "./rbac.js";
import type { ChangelogEntry, FeedbackItem, KeyInfo, Project, RoadmapItem, Scope } from "./types.js";
import { VERSION } from "./version.js";

export interface RetroServerOptions {
  client: RetroClient;
  keyInfo: KeyInfo;
  audit: AuditSink;
  /** Label written to the audit log: "stdio" | "http". */
  transport?: string;
  /**
   * Whether destructive tools may ask the user via elicitation. Only safe on
   * a transport with a persistent back-channel (stdio). Default: true.
   */
  allowElicitation?: boolean;
}

// --------------------------------------------------------------------------- //
// Shared schema fragments
// --------------------------------------------------------------------------- //
const FEEDBACK_TYPES = ["bug", "feedback", "feature"] as const;
const SENTIMENTS = ["positive", "negative", "neutral"] as const;
const FEEDBACK_STATUSES = ["new", "triaged", "planned", "in_progress", "done", "declined"] as const;
const PRIORITIES = ["none", "low", "medium", "high"] as const;
const ROADMAP_STATUSES = ["planned", "in_progress", "done"] as const;
const PROJECT_KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const projectId = z.uuid().describe("The project's id (UUID), as returned by list_projects or create_project.");
const itemRef = z
  .union([z.uuid(), z.number().int().positive(), z.string().regex(/^\d+$/)])
  .describe("The feedback item's id (UUID) or its per-project number (e.g. 42, shown to users as #42).");
const typeEnum = z.enum(FEEDBACK_TYPES).describe("bug | feedback | feature.");
const sentimentEnum = z.enum(SENTIMENTS).describe("positive | negative | neutral (only meaningful for type=feedback).");
const statusEnum = z.enum(FEEDBACK_STATUSES).describe("new | triaged | planned | in_progress | done | declined.");
const priorityEnum = z.enum(PRIORITIES).describe("none | low | medium | high.");
const roadmapStatusEnum = z.enum(ROADMAP_STATUSES).describe("planned | in_progress | done.");
const tagsInput = z.array(z.string().min(1).max(50)).max(20);
const confirmFlag = z
  .boolean()
  .default(false)
  .describe("Set to true only after the user explicitly confirmed this specific deletion.");

// Output schemas. `looseObject` = additionalProperties allowed (see header).
const countsObject = z.looseObject({ feedback: z.number(), new: z.number(), roadmap: z.number() });
const projectObject = z.looseObject({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  public_key: z.string().optional(),
  public_key_prefix: z.string(),
  board_slug: z.string(),
  board_enabled: z.boolean(),
  board_url: z.string().nullable(),
  allow_votes: z.boolean(),
  allow_board_submissions: z.boolean(),
  types_enabled: z.array(z.enum(FEEDBACK_TYPES)),
  allow_screenshots: z.boolean(),
  allow_email: z.boolean(),
  counts: countsObject.optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
const noteObject = z.looseObject({
  id: z.string(),
  body: z.string(),
  author: z.looseObject({ id: z.string(), email: z.string() }).nullable().optional(),
  created_at: z.string(),
});
const screenshotObject = z.looseObject({
  content_type: z.string(),
  size: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});
const feedbackObject = z.looseObject({
  id: z.string(),
  project_id: z.string(),
  number: z.number(),
  type: z.enum(FEEDBACK_TYPES),
  sentiment: z.enum(SENTIMENTS).nullable(),
  title: z.string(),
  message: z.string(),
  status: z.enum(FEEDBACK_STATUSES),
  priority: z.enum(PRIORITIES),
  tags: z.array(z.string()),
  reporter_email: z.string().nullable().optional(),
  reporter_id: z.string().nullable().optional(),
  page_url: z.string().nullable().optional(),
  app_version: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  source: z.string(),
  has_screenshot: z.boolean(),
  screenshot: screenshotObject.nullable().optional(),
  roadmap_item_id: z.string().nullable(),
  notes: z.array(noteObject).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
const roadmapObject = z.looseObject({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(ROADMAP_STATUSES),
  position: z.number(),
  public: z.boolean(),
  votes: z.number(),
  feedback_count: z.number(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const changelogObject = z.looseObject({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  body: z.string(),
  version: z.string().nullable(),
  published_at: z.string().nullable(),
  roadmap_item_ids: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});
const summaryObject = z.looseObject({
  project_id: z.string(),
  total: z.number(),
  by_status: z.record(z.string(), z.number()),
  by_type: z.record(z.string(), z.number()),
  by_sentiment: z.record(z.string(), z.number()),
  last_7_days: z.number(),
  last_30_days: z.number(),
  top_tags: z.array(z.looseObject({ tag: z.string(), count: z.number() })),
});
const usageObject = z.looseObject({
  period_start: z.string(),
  period_end: z.string(),
  feedback: z.number(),
  attachment_bytes: z.number(),
  counts: z.looseObject({ projects: z.number(), api_keys: z.number() }),
  limits: z.record(z.string(), z.unknown()),
});
const auditEventObject = z.looseObject({
  id: z.string(),
  ts: z.string(),
  actor_type: z.string(),
  actor_id: z.string().nullable(),
  actor_label: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  outcome: z.string(),
  meta: z.record(z.string(), z.unknown()),
});

/** A handler may return a plain result, or wrap it to record a non-"ok" audit outcome. */
type Wrapped = { result: CallToolResult; outcome: AuditOutcome };
type Handled = CallToolResult | Wrapped;

function isWrapped(out: Handled): out is Wrapped {
  return (
    typeof (out as Wrapped).outcome === "string" &&
    typeof (out as Wrapped).result === "object" &&
    !("content" in out)
  );
}

function structured(value: Record<string, unknown>, summary?: string): CallToolResult {
  return {
    content: [{ type: "text", text: summary ?? JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function failure(code: string, message: string, extra: Record<string, unknown> = {}): CallToolResult {
  const detail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
  return {
    content: [{ type: "text", text: `Error (${code}): ${message}${detail}` }],
    isError: true,
  };
}

const TYPE_ICON: Record<string, string> = { bug: "🐞", feedback: "💬", feature: "💡" };
const SENTIMENT_ICON: Record<string, string> = { positive: "👍", negative: "👎", neutral: "😐" };

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

function describeItem(f: FeedbackItem): string {
  const sent = f.sentiment ? ` ${SENTIMENT_ICON[f.sentiment] ?? f.sentiment}` : "";
  const prio = f.priority !== "none" ? ` prio=${f.priority}` : "";
  const tags = f.tags.length ? ` [${f.tags.join(", ")}]` : "";
  const shot = f.has_screenshot ? " 📎" : "";
  return `#${f.number} ${TYPE_ICON[f.type] ?? f.type}${sent} ${f.status}${prio}${tags}${shot} — ${truncate(f.title, 80)} (id=${f.id})`;
}

function describeProject(p: Project): string {
  const c = p.counts ? `, ${c2(p.counts.feedback)} feedback item(s), ${p.counts.new} new, ${p.counts.roadmap} roadmap item(s)` : "";
  const board = p.board_enabled ? `, board: ${p.board_url ?? "/b/" + p.board_slug}` : ", board disabled";
  return `${p.name} (key=${p.key}, id=${p.id}${c}${board})`;
}
const c2 = (n: number) => String(n);

function describeRoadmap(r: RoadmapItem): string {
  return `${r.status} #${r.position} ${r.public ? "" : "(hidden) "}${truncate(r.title, 80)} — ${r.votes} vote(s), ${r.feedback_count} linked (id=${r.id})`;
}

function describeChangelog(c: ChangelogEntry): string {
  const when = c.published_at ? `published ${c.published_at}` : "DRAFT";
  return `${c.version ? `v${c.version} ` : ""}${truncate(c.title, 80)} — ${when} (id=${c.id})`;
}

export function buildInstructions(info: KeyInfo): string {
  return [
    `retro is a user-feedback service. You are acting for account "${info.account.name}" (plan: ${info.account.plan}).`,
    `This API key has role "${info.key.role}" with scopes: ${info.scopes.join(", ")}. Only tools allowed by those scopes are listed; if a user asks for something outside them, say the key lacks that permission instead of guessing.`,
    "Model: an account has projects (one per app); a project collects feedback items (type bug | feedback | feature, with a status new → triaged → planned → in_progress → done | declined, a priority and tags) and publishes a board: roadmap items (planned / in_progress / done, votable) and changelog entries (drafts until published). End users send feedback with the project's public key (retro_pub_...); you manage everything with this management key (retro_live_...).",
    "Feedback items are referenced by project id plus item id or number (#42). Start with list_projects, then feedback_summary or list_feedback(status=new) to triage. promote_to_roadmap turns an item into a roadmap item and links them.",
    "Deleting a project, a feedback item, a roadmap item or a changelog entry is irreversible: the delete_* tools require explicit user confirmation. Prefer status=declined over deleting feedback.",
  ].join("\n");
}

export function createRetroServer(opts: RetroServerOptions): McpServer {
  const { client, keyInfo, audit } = opts;
  const transport = opts.transport ?? "unknown";
  const allowElicitation = opts.allowElicitation ?? true;
  const scopes = new Set<Scope>(keyInfo.scopes);
  const actor = { account: keyInfo.account.id, prefix: keyInfo.key.prefix, role: keyInfo.key.role };

  const server = new McpServer(
    { name: "retro", version: VERSION },
    { instructions: buildInstructions(keyInfo) },
  );

  const log = (
    tool: ToolName,
    outcome: AuditOutcome,
    started: number,
    args?: unknown,
    extra: Partial<Pick<AuditEntry, "error" | "meta">> = {},
  ) =>
    audit.write({
      ts: new Date().toISOString(),
      event: "tool.call",
      transport,
      actor,
      tool,
      outcome,
      duration_ms: Date.now() - started,
      args: compactArgs(args),
      ...extra,
    });

  /**
   * Register a tool only if the key's scopes allow it, wrapping the handler
   * with the call-time scope re-check, error mapping and audit logging.
   */
  function tool<In extends z.ZodRawShape, Out extends z.ZodObject>(
    name: ToolName,
    config: {
      title: string;
      description: string;
      inputSchema: In;
      outputSchema: Out;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
    },
    handler: (
      args: z.infer<z.ZodObject<In>>,
      extra: Parameters<Parameters<McpServer["registerTool"]>[2]>[1],
    ) => Promise<Handled>,
  ): void {
    const required = TOOL_SCOPES[name];
    if (!hasAllScopes(scopes, required)) return; // layer 1: never listed
    const requiredLabel = required.join(" + ");

    server.registerTool(
      name,
      {
        title: config.title,
        description: `${config.description} (requires scope ${requiredLabel})`,
        inputSchema: config.inputSchema,
        outputSchema: config.outputSchema,
        annotations: { title: config.title, ...config.annotations },
      },
      (async (args: z.infer<z.ZodObject<In>>, extra: Parameters<typeof handler>[1]) => {
        const started = Date.now();
        if (!hasAllScopes(scopes, required)) {
          // layer 2: refused even if somehow invoked
          log(name, "denied", started, args, { error: { code: "insufficient_scope", message: requiredLabel } });
          return failure("insufficient_scope", `This key (role ${keyInfo.key.role}) lacks ${requiredLabel}.`, {
            required_scope: requiredLabel,
          });
        }
        try {
          const out = await handler(args, extra);
          if (isWrapped(out)) {
            log(name, out.outcome, started, args);
            return out.result;
          }
          log(name, "ok", started, args);
          return out;
        } catch (err) {
          if (err instanceof RetroApiError) {
            // layer 3 (the API said no) or any other API-level failure
            log(name, err.code === "insufficient_scope" ? "denied" : "error", started, args, {
              error: { code: err.code, message: err.message },
            });
            return failure(err.code, err.message, { status: err.status, ...err.extra });
          }
          const message = err instanceof Error ? err.message : String(err);
          log(name, "error", started, args, { error: { code: "internal_error", message } });
          return failure("internal_error", message);
        }
      }) as never,
    );
  }

  /**
   * Shared confirmation flow for destructive tools: elicit when possible,
   * otherwise require `confirm: true`. Returns null when approved.
   */
  async function confirmOrRefuse(
    confirm: boolean,
    what: string,
    toolName: ToolName,
    cancelled: Record<string, unknown>,
  ): Promise<Wrapped | null> {
    if (confirm) return null;
    const canAsk = allowElicitation && Boolean(server.server.getClientCapabilities()?.elicitation);
    if (canAsk) {
      const answer = await server.server.elicitInput({
        mode: "form",
        message: `${what} This cannot be undone.`,
        requestedSchema: {
          type: "object",
          properties: { confirm: { type: "boolean", title: "Yes, delete it", default: false } },
          required: ["confirm"],
        },
      });
      if (answer.action === "accept" && answer.content?.confirm === true) return null;
      return {
        outcome: "cancelled",
        result: structured(cancelled, "Deletion was cancelled by the user. Nothing was changed."),
      };
    }
    return {
      outcome: "pending",
      result: failure(
        "confirmation_required",
        `${what} This is irreversible. Ask the user to confirm, then call ${toolName} again with confirm=true.`,
      ),
    };
  }

  const refOf = (item: string | number): string | number => item;

  // ------------------------------------------------------------------------- //
  // Projects
  // ------------------------------------------------------------------------- //
  tool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List the account's projects, newest first, each with its feedback counts (total, new) and board status. Use q to search by name or key. Start here to find a project id for the other tools.",
      inputSchema: {
        q: z.string().optional().describe("Case-insensitive search in project name and key."),
      },
      outputSchema: z.looseObject({ items: z.array(projectObject), total: z.number() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const page = await client.listProjects(args);
      const lines = page.items.map(describeProject);
      return structured({ ...page }, `${page.total} project(s).\n${lines.join("\n")}`);
    },
  );

  tool(
    "get_project",
    {
      title: "Get project",
      description:
        "Fetch one project by id: public key (for the widget / ingest API), board settings (slug, enabled, votes, submissions), enabled feedback types and counts.",
      inputSchema: { project_id: projectId },
      outputSchema: projectObject,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) => {
      const p = await client.getProject(project_id);
      return structured({ ...p }, `${describeProject(p)}\nPublic key: ${p.public_key}\nTypes: ${p.types_enabled.join(", ")}`);
    },
  );

  tool(
    "create_project",
    {
      title: "Create project",
      description:
        "Create a project (one per app that collects feedback). Returns the project's public key (retro_pub_...) to put in the widget snippet or ingest calls, and a board slug (board starts disabled). Errors: limit_reached (which=projects) when the plan's project quota is used up, key_taken when the key already exists in this account.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("Human-friendly project name, e.g. the app's name."),
        key: z
          .string()
          .regex(PROJECT_KEY_RE)
          .optional()
          .describe("Slug, unique per account (^[a-z0-9][a-z0-9-]{0,62}$). Defaults to a slug of the name."),
        description: z.string().max(1000).optional(),
        url: z.string().url().max(2048).optional().describe("The app's public URL."),
      },
      outputSchema: projectObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const p = await client.createProject(args);
      return structured(
        { ...p },
        `Created project ${describeProject(p)}.\nPublic key: ${p.public_key}\nWidget: <script src="https://retro.3m4.net/widget.js" data-project-key="${p.public_key}" defer></script>`,
      );
    },
  );

  tool(
    "update_project",
    {
      title: "Update project",
      description:
        "Change a project's name, description, URL or board / widget settings. Only the fields you pass are changed; the key cannot change. board_enabled=true publishes the public board at board_url. Errors: slug_taken, reserved_slug, invalid types_enabled (must be a non-empty subset of bug, feedback, feature).",
      inputSchema: {
        project_id: projectId,
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(1000).optional(),
        url: z.string().url().max(2048).optional(),
        board_slug: z.string().regex(BOARD_SLUG_RE).optional().describe("Globally unique public slug (^[a-z0-9][a-z0-9-]{1,62}$)."),
        board_enabled: z.boolean().optional().describe("Publish / unpublish the public roadmap + changelog board."),
        board_title: z.string().max(120).optional(),
        board_intro: z.string().max(2000).optional().describe("Markdown shown at the top of the board."),
        allow_votes: z.boolean().optional(),
        allow_board_submissions: z.boolean().optional().describe("Whether visitors can submit ideas from the board."),
        types_enabled: z.array(typeEnum).min(1).max(3).optional(),
        allow_screenshots: z.boolean().optional(),
        allow_email: z.boolean().optional(),
        widget_accent: z.string().regex(HEX_COLOR_RE).optional().describe("Widget accent colour as #rrggbb."),
      },
      outputSchema: projectObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project_id, ...patch }) => {
      const p = await client.updateProject(project_id, patch);
      return structured({ ...p }, `Updated project ${describeProject(p)}.`);
    },
  );

  tool(
    "rotate_project_key",
    {
      title: "Rotate project public key",
      description:
        "Issue a new public key (retro_pub_...) for a project. The OLD KEY STOPS WORKING IMMEDIATELY: every widget snippet and ingest client must be updated, so only do this when the user asks to rotate the key (e.g. spam abuse), and show them the new key.",
      inputSchema: { project_id: projectId },
      outputSchema: z.looseObject({ public_key: z.string(), public_key_prefix: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ project_id }) => {
      const k = await client.rotateProjectKey(project_id);
      return structured({ ...k }, `Rotated. New public key: ${k.public_key}. The previous key is now invalid; update the widget snippet.`);
    },
  );

  tool(
    "delete_project",
    {
      title: "Delete project",
      description:
        "Permanently delete a project with ALL its feedback items, notes, screenshots, roadmap items, changelog entries and votes. IRREVERSIBLE: its widget stops working. The user must confirm: when the client supports it you will be prompted; otherwise ask the user explicitly and call again with confirm=true.",
      inputSchema: { project_id: projectId, confirm: confirmFlag },
      outputSchema: z.looseObject({ deleted: z.boolean(), id: z.string(), key: z.string(), name: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ project_id, confirm }) => {
      const p = await client.getProject(project_id);
      const n = p.counts?.feedback ?? "all its";
      const refusal = await confirmOrRefuse(
        confirm,
        `Delete project "${p.name}" (${p.key}) with ${n} feedback item(s) and its board?`,
        "delete_project",
        { deleted: false, id: p.id, key: p.key, name: p.name },
      );
      if (refusal) return refusal;
      await client.deleteProject(project_id);
      return structured({ deleted: true, id: p.id, key: p.key, name: p.name }, `Deleted project "${p.name}" (${p.key}).`);
    },
  );

  // ------------------------------------------------------------------------- //
  // Feedback
  // ------------------------------------------------------------------------- //
  tool(
    "list_feedback",
    {
      title: "List feedback",
      description:
        "List a project's feedback items with filters: status and type accept comma-separated lists (e.g. status=\"new,triaged\"), q searches title, message, reporter email and page URL. Defaults to newest first. Items omit notes; use get_feedback for the full item.",
      inputSchema: {
        project_id: projectId,
        q: z.string().max(200).optional(),
        type: z.string().optional().describe("One or more of bug, feedback, feature (comma-separated)."),
        status: z.string().optional().describe("One or more statuses, comma-separated, e.g. \"new,triaged\"."),
        sentiment: sentimentEnum.optional(),
        priority: priorityEnum.optional(),
        tag: z.string().max(50).optional(),
        has_screenshot: z.boolean().optional(),
        since: z.string().optional().describe("ISO date/datetime; only items created after it."),
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(200).default(50),
        sort: z.enum(["newest", "oldest", "votes"]).default("newest"),
      },
      outputSchema: z.looseObject({ items: z.array(feedbackObject), page: z.number(), per_page: z.number(), total: z.number() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, ...params }) => {
      const page = await client.listFeedback(project_id, params);
      const lines = page.items.map(describeItem);
      return structured(
        { ...page },
        `${page.total} item(s) total; showing page ${page.page} (${page.items.length}).\n${lines.join("\n") || "(none)"}`,
      );
    },
  );

  tool(
    "get_feedback",
    {
      title: "Get feedback item",
      description:
        "Fetch one feedback item by id or number with its full message, reporter details, page URL, app version, metadata, screenshot info and internal notes.",
      inputSchema: { project_id: projectId, item: itemRef },
      outputSchema: feedbackObject,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, item }) => {
      const f = await client.getFeedback(project_id, refOf(item));
      const meta = [
        f.reporter_email ? `reporter: ${f.reporter_email}` : null,
        f.reporter_id ? `reporter_id: ${f.reporter_id}` : null,
        f.page_url ? `page: ${f.page_url}` : null,
        f.app_version ? `version: ${f.app_version}` : null,
        f.locale ? `locale: ${f.locale}` : null,
        `source: ${f.source}`,
        `created: ${f.created_at}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const notes = (f.notes ?? []).map((n) => `  - ${n.created_at} ${n.author?.email ?? "?"}: ${n.body}`).join("\n");
      return structured({ ...f }, `${describeItem(f)}\n${meta}\n\n${f.message}\n${notes ? `\nNotes:\n${notes}` : ""}`);
    },
  );

  tool(
    "feedback_summary",
    {
      title: "Feedback summary",
      description:
        "Counts for one project: total, by status, by type, by sentiment, items in the last 7 / 30 days and the top tags. The cheapest way to answer \"how is the feedback looking?\" or to decide where to start triage.",
      inputSchema: { project_id: projectId },
      outputSchema: summaryObject,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) => {
      const s = await client.summary(project_id);
      const fmt = (o: Record<string, number>) =>
        Object.entries(o)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k} ${n}`)
          .join(", ") || "none";
      return structured(
        { ...s },
        `${s.total} item(s); last 7 days: ${s.last_7_days}, last 30 days: ${s.last_30_days}.\nBy status: ${fmt(s.by_status)}.\nBy type: ${fmt(s.by_type)}.\nBy sentiment: ${fmt(s.by_sentiment)}.\nTop tags: ${s.top_tags.map((t) => `${t.tag} (${t.count})`).join(", ") || "none"}.`,
      );
    },
  );

  tool(
    "list_tags",
    {
      title: "List tags",
      description: "Every tag used in a project's feedback items with its count. Use it to reuse existing tags when triaging instead of inventing near-duplicates.",
      inputSchema: { project_id: projectId },
      outputSchema: z.looseObject({ tags: z.array(z.looseObject({ tag: z.string(), count: z.number() })) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) => {
      const r = await client.listTags(project_id);
      return structured({ ...r }, r.tags.map((t) => `${t.tag} (${t.count})`).join(", ") || "No tags yet.");
    },
  );

  tool(
    "update_feedback",
    {
      title: "Update feedback item",
      description:
        "Triage a feedback item: change its status, priority, tags, title, type or sentiment, or link / unlink it to a roadmap item (roadmap_item_id, null to unlink). Only the fields you pass are changed. Use status=declined instead of deleting.",
      inputSchema: {
        project_id: projectId,
        item: itemRef,
        status: statusEnum.optional(),
        priority: priorityEnum.optional(),
        tags: tagsInput.optional().describe("Replaces the whole tag list."),
        title: z.string().min(1).max(140).optional(),
        type: typeEnum.optional(),
        sentiment: sentimentEnum.nullable().optional(),
        roadmap_item_id: z.uuid().nullable().optional(),
      },
      outputSchema: feedbackObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project_id, item, ...patch }) => {
      const f = await client.updateFeedback(project_id, refOf(item), patch);
      return structured({ ...f }, `Updated ${describeItem(f)}.`);
    },
  );

  tool(
    "add_note",
    {
      title: "Add internal note",
      description:
        "Append an internal note to a feedback item (visible to the team only, never to the reporter). Good for triage reasoning, duplicate references (\"dup of #12\") or next steps.",
      inputSchema: {
        project_id: projectId,
        item: itemRef,
        body: z.string().min(1).max(5000),
      },
      outputSchema: noteObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project_id, item, body }) => {
      const n = await client.addNote(project_id, refOf(item), body);
      return structured({ ...n }, `Note added (id=${n.id}).`);
    },
  );

  tool(
    "promote_to_roadmap",
    {
      title: "Promote feedback to the roadmap",
      description:
        "Turn a feedback item into a roadmap item (default status planned, title/description from the item unless overridden), link them and move the item to planned (unless it is already in_progress or done). Idempotent: an already-promoted item returns its existing roadmap item. Errors: limit_reached (which=roadmap_items).",
      inputSchema: {
        project_id: projectId,
        item: itemRef,
        title: z.string().min(1).max(140).optional(),
        description: z.string().max(5000).optional(),
        status: roadmapStatusEnum.optional(),
      },
      outputSchema: z.looseObject({ item: feedbackObject, roadmap_item: roadmapObject }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project_id, item, ...input }) => {
      const r = await client.promote(project_id, refOf(item), input);
      return structured(
        { ...r },
        `#${r.item.number} is now linked to roadmap item "${r.roadmap_item.title}" (${r.roadmap_item.status}, id=${r.roadmap_item.id}).`,
      );
    },
  );

  tool(
    "delete_feedback",
    {
      title: "Delete feedback item",
      description:
        "Permanently delete a feedback item with its notes and screenshot. IRREVERSIBLE; prefer update_feedback with status=declined. The user must confirm: when the client supports it you will be prompted; otherwise ask the user explicitly and call again with confirm=true.",
      inputSchema: { project_id: projectId, item: itemRef, confirm: confirmFlag },
      outputSchema: z.looseObject({ deleted: z.boolean(), id: z.string(), number: z.number(), project_id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ project_id, item, confirm }) => {
      const f = await client.getFeedback(project_id, refOf(item));
      const refusal = await confirmOrRefuse(
        confirm,
        `Delete feedback #${f.number} "${truncate(f.title, 60)}" (${f.type}, ${f.status})?`,
        "delete_feedback",
        { deleted: false, id: f.id, number: f.number, project_id: f.project_id },
      );
      if (refusal) return refusal;
      await client.deleteFeedback(project_id, f.id);
      return structured({ deleted: true, id: f.id, number: f.number, project_id: f.project_id }, `Deleted feedback #${f.number} (id=${f.id}).`);
    },
  );

  // ------------------------------------------------------------------------- //
  // Roadmap
  // ------------------------------------------------------------------------- //
  tool(
    "list_roadmap",
    {
      title: "List roadmap items",
      description:
        "A project's roadmap items (planned, in_progress, done) in board order, with votes and the number of linked feedback items. Hidden (non-public) items are included.",
      inputSchema: {
        project_id: projectId,
        status: roadmapStatusEnum.optional(),
      },
      outputSchema: z.looseObject({ items: z.array(roadmapObject) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, status }) => {
      const r = await client.listRoadmap(project_id, { status, include_hidden: true });
      return structured({ ...r }, r.items.map(describeRoadmap).join("\n") || "No roadmap items.");
    },
  );

  tool(
    "create_roadmap_item",
    {
      title: "Create roadmap item",
      description:
        "Add an item to the project's roadmap. New items go last in their column. public=false keeps it off the public board. Errors: limit_reached (which=roadmap_items).",
      inputSchema: {
        project_id: projectId,
        title: z.string().min(1).max(140),
        description: z.string().max(5000).optional().describe("Markdown."),
        status: roadmapStatusEnum.default("planned"),
        public: z.boolean().default(true),
      },
      outputSchema: roadmapObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project_id, ...input }) => {
      const r = await client.createRoadmapItem(project_id, input);
      return structured({ ...r }, `Created roadmap item ${describeRoadmap(r)}.`);
    },
  );

  tool(
    "update_roadmap_item",
    {
      title: "Update roadmap item",
      description:
        "Change a roadmap item's title, description, status or visibility. Moving it to done sets completed_at, and linked feedback items follow the status (planned / in_progress / done).",
      inputSchema: {
        project_id: projectId,
        roadmap_item_id: z.uuid(),
        title: z.string().min(1).max(140).optional(),
        description: z.string().max(5000).optional(),
        status: roadmapStatusEnum.optional(),
        public: z.boolean().optional(),
      },
      outputSchema: roadmapObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project_id, roadmap_item_id, ...patch }) => {
      const r = await client.updateRoadmapItem(project_id, roadmap_item_id, patch);
      return structured({ ...r }, `Updated roadmap item ${describeRoadmap(r)}.`);
    },
  );

  tool(
    "delete_roadmap_item",
    {
      title: "Delete roadmap item",
      description:
        "Permanently delete a roadmap item (linked feedback items are unlinked, not deleted; votes are lost). IRREVERSIBLE; prefer public=false to hide it. The user must confirm: when the client supports it you will be prompted; otherwise ask the user explicitly and call again with confirm=true.",
      inputSchema: { project_id: projectId, roadmap_item_id: z.uuid(), confirm: confirmFlag },
      outputSchema: z.looseObject({ deleted: z.boolean(), id: z.string(), title: z.string(), project_id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ project_id, roadmap_item_id, confirm }) => {
      const { items } = await client.listRoadmap(project_id, { include_hidden: true });
      const r = items.find((x) => x.id === roadmap_item_id);
      if (!r) return failure("not_found", "Roadmap item not found.", { status: 404 });
      const refusal = await confirmOrRefuse(
        confirm,
        `Delete roadmap item "${truncate(r.title, 60)}" (${r.status}, ${r.votes} vote(s), ${r.feedback_count} linked item(s))?`,
        "delete_roadmap_item",
        { deleted: false, id: r.id, title: r.title, project_id: r.project_id },
      );
      if (refusal) return refusal;
      await client.deleteRoadmapItem(project_id, r.id);
      return structured({ deleted: true, id: r.id, title: r.title, project_id: r.project_id }, `Deleted roadmap item "${r.title}".`);
    },
  );

  // ------------------------------------------------------------------------- //
  // Changelog
  // ------------------------------------------------------------------------- //
  tool(
    "list_changelog",
    {
      title: "List changelog entries",
      description: "A project's changelog entries, drafts first, then newest published first.",
      inputSchema: { project_id: projectId, include_drafts: z.boolean().default(true) },
      outputSchema: z.looseObject({ items: z.array(changelogObject) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, include_drafts }) => {
      const r = await client.listChangelog(project_id, { include_drafts });
      return structured({ ...r }, r.items.map(describeChangelog).join("\n") || "No changelog entries.");
    },
  );

  tool(
    "create_changelog_entry",
    {
      title: "Create changelog entry",
      description:
        "Write a changelog entry (Markdown body, optional version). Entries are drafts until published; pass publish=true to publish immediately, or publish later with update_changelog_entry.",
      inputSchema: {
        project_id: projectId,
        title: z.string().min(1).max(140),
        body: z.string().min(1).max(20000).describe("Markdown (headings, lists, links, bold, italic, code)."),
        version: z.string().max(40).optional(),
        publish: z.boolean().default(false),
      },
      outputSchema: changelogObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project_id, ...input }) => {
      const c = await client.createChangelogEntry(project_id, input);
      return structured({ ...c }, `Created changelog entry ${describeChangelog(c)}.`);
    },
  );

  tool(
    "update_changelog_entry",
    {
      title: "Update changelog entry",
      description:
        "Edit a changelog entry's title, body, version or linked roadmap items, or publish / unpublish it (published=true sets published_at the first time; false hides it again).",
      inputSchema: {
        project_id: projectId,
        changelog_entry_id: z.uuid(),
        title: z.string().min(1).max(140).optional(),
        body: z.string().min(1).max(20000).optional(),
        version: z.string().max(40).optional(),
        published: z.boolean().optional(),
        roadmap_item_ids: z.array(z.uuid()).max(50).optional(),
      },
      outputSchema: changelogObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project_id, changelog_entry_id, ...patch }) => {
      const c = await client.updateChangelogEntry(project_id, changelog_entry_id, patch);
      return structured({ ...c }, `Updated changelog entry ${describeChangelog(c)}.`);
    },
  );

  tool(
    "delete_changelog_entry",
    {
      title: "Delete changelog entry",
      description:
        "Permanently delete a changelog entry. IRREVERSIBLE; prefer published=false to hide it. The user must confirm: when the client supports it you will be prompted; otherwise ask the user explicitly and call again with confirm=true.",
      inputSchema: { project_id: projectId, changelog_entry_id: z.uuid(), confirm: confirmFlag },
      outputSchema: z.looseObject({ deleted: z.boolean(), id: z.string(), title: z.string(), project_id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ project_id, changelog_entry_id, confirm }) => {
      const { items } = await client.listChangelog(project_id, { include_drafts: true });
      const c = items.find((x) => x.id === changelog_entry_id);
      if (!c) return failure("not_found", "Changelog entry not found.", { status: 404 });
      const refusal = await confirmOrRefuse(
        confirm,
        `Delete changelog entry "${truncate(c.title, 60)}" (${c.published_at ? "published" : "draft"})?`,
        "delete_changelog_entry",
        { deleted: false, id: c.id, title: c.title, project_id: c.project_id },
      );
      if (refusal) return refusal;
      await client.deleteChangelogEntry(project_id, c.id);
      return structured({ deleted: true, id: c.id, title: c.title, project_id: c.project_id }, `Deleted changelog entry "${c.title}".`);
    },
  );

  // ------------------------------------------------------------------------- //
  // Account
  // ------------------------------------------------------------------------- //
  tool(
    "get_usage",
    {
      title: "Usage and limits",
      description:
        "This month's accepted feedback submissions, screenshot storage, and project / API key counts against the plan's limits (-1 = unlimited). Call this when a tool returns limit_reached.",
      inputSchema: {},
      outputSchema: usageObject,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const u = await client.usage();
      const lim = u.limits;
      const fmt = (n: unknown) => (n === -1 ? "unlimited" : String(n ?? "?"));
      const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
      return structured(
        { ...u },
        `Period ${u.period_start} → ${u.period_end}: ${u.feedback}/${fmt(lim.feedback_per_month)} feedback items, ${mb(u.attachment_bytes)}/${fmt(lim.attachment_storage_mb)} MB screenshots, ${u.counts.projects}/${fmt(lim.projects)} projects, ${u.counts.api_keys}/${fmt(lim.api_keys)} API keys.`,
      );
    },
  );

  tool(
    "get_audit_log",
    {
      title: "Audit log",
      description:
        "Most recent audit events for the account (who did what, when, and whether it was allowed). Actions look like feedback.update, feedback.promote, roadmap.create, changelog.publish, project.delete, auth.denied.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50),
        action: z.string().optional().describe("Filter by action, e.g. feedback.update, changelog.publish, auth.denied."),
      },
      outputSchema: z.looseObject({ items: z.array(auditEventObject) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { items } = await client.auditLog(args);
      const lines = items.map(
        (e) =>
          `${e.ts} ${e.outcome.padEnd(6)} ${e.action} by ${e.actor_type}${e.actor_label ? `:${e.actor_label}` : ""}${e.target_id ? ` → ${e.target_type}:${e.target_id}` : ""}`,
      );
      return structured({ items }, lines.join("\n") || "No audit events.");
    },
  );

  // ------------------------------------------------------------------------- //
  // Resources (read-only context the host can attach without a tool call)
  // ------------------------------------------------------------------------- //
  if (scopes.has("projects:read")) {
    server.registerResource(
      "projects",
      "retro://projects",
      {
        title: "Projects",
        description: "Every project of the account with its feedback counts and board status.",
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await client.listProjects(), null, 2) }],
      }),
    );
  }

  if (scopes.has("feedback:read")) {
    server.registerResource(
      "project-summary",
      new ResourceTemplate("retro://projects/{id}/summary", { list: undefined }),
      {
        title: "Project feedback summary",
        description: "Counts by status, type and sentiment for one project (by project id).",
        mimeType: "application/json",
      },
      async (uri, { id }) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(await client.summary(String(id)), null, 2),
          },
        ],
      }),
    );
  }

  // ------------------------------------------------------------------------- //
  // Prompts (reusable workflows the user can pick from the host UI)
  // ------------------------------------------------------------------------- //
  if (scopes.has("feedback:read")) {
    server.registerPrompt(
      "triage_inbox",
      {
        title: "Triage the inbox",
        description: "Walk through a project's new feedback: group duplicates, propose status, priority and tags, and draft roadmap items.",
        argsSchema: {
          project_id: z.string().describe("Project id (UUID)."),
        },
      },
      ({ project_id }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Call feedback_summary with project_id="${project_id}", then list_feedback with project_id="${project_id}", status="new", per_page=100 (page through if total is larger) and list_tags for the same project. Then triage the inbox:
1. Group items that describe the same bug or request; name the groups and list the item numbers in each.
2. For every item propose: status (triaged, planned or declined), priority (high for crashes, data loss or blockers; medium for broken but workaroundable; low for cosmetic or nice-to-have), and 1-3 tags, reusing existing tags whenever they fit.
3. For feature requests that appear in more than one item, or that clearly fit the product, draft a roadmap item (title + one-paragraph description) and say which items would be promoted to it.
4. Flag items that need a reply or more information from the reporter.
Present the plan as a compact table (number, title, proposed status, priority, tags, group / roadmap item). Do NOT call update_feedback, add_note, promote_to_roadmap or create_roadmap_item until the user approves the plan; then apply it exactly as approved and report what changed.`,
            },
          },
        ],
      }),
    );
  }

  return server;
}

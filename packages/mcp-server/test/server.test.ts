/**
 * End-to-end tests over a real MCP client/server pair (in-memory transport)
 * against a fake retro API. No network, no database.
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { MemoryAuditSink } from "../src/audit.js";
import { RetroClient } from "../src/client.js";
import { ALL_TOOLS, allowedTools } from "../src/rbac.js";
import { createRetroServer } from "../src/server.js";
import type {
  ChangelogEntry,
  FeedbackItem,
  KeyInfo,
  Note,
  Project,
  RoadmapItem,
  Role,
  Scope,
  Summary,
} from "../src/types.js";

import roles from "../../shared/api_key_roles.json";

const ROLE_SCOPES = Object.fromEntries(
  Object.entries(roles.roles).map(([r, v]) => [r, v.scopes as Scope[]]),
) as Record<Role, Scope[]>;

const keyInfo = (role: Role): KeyInfo => ({
  account: { id: "acc-1", name: "Test", plan: "pro", created_at: "2026-01-01T00:00:00Z" },
  key: { id: "key-1", prefix: "retro_live_test", role },
  scopes: ROLE_SCOPES[role],
});

const NOW = "2026-10-15T00:00:00Z";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = (what: string) => json(404, { error: { code: "not_found", message: `${what} not found.` } });

type StoredProject = Project & { notes: Map<string, Note[]> };

/** Just enough of the retro REST API to exercise every tool, with scope checks. */
class FakeApi {
  projects = new Map<string, StoredProject>();
  feedback = new Map<string, FeedbackItem>();
  roadmap = new Map<string, RoadmapItem>();
  changelog = new Map<string, ChangelogEntry>();
  limitReached: null | "projects" | "roadmap_items" = null;
  calls: string[] = [];
  private n = 0;

  constructor(public role: Role) {}

  private need(scope: Scope): Response | null {
    return ROLE_SCOPES[this.role].includes(scope)
      ? null
      : json(403, { error: { code: "insufficient_scope", message: `lacks ${scope}`, required_scope: scope, role: this.role } });
  }

  private counts(p: Project) {
    const items = this.feedbackOf(p.id);
    return { feedback: items.length, new: items.filter((f) => f.status === "new").length, roadmap: this.roadmapOf(p.id).length };
  }

  private view(p: StoredProject): Project {
    const { notes: _omit, ...rest } = p;
    return { ...rest, counts: this.counts(p), board_url: p.board_enabled ? `https://retro.test/b/${p.board_slug}` : null };
  }

  feedbackOf(projectId: string): FeedbackItem[] {
    return [...this.feedback.values()].filter((f) => f.project_id === projectId).sort((a, b) => b.number - a.number);
  }

  roadmapOf(projectId: string): RoadmapItem[] {
    return [...this.roadmap.values()].filter((r) => r.project_id === projectId).sort((a, b) => a.position - b.position);
  }

  private findItem(projectId: string, ref: string): FeedbackItem | undefined {
    return this.feedbackOf(projectId).find((f) => f.id === ref || String(f.number) === ref);
  }

  /** Test seam: what the ingest API would create. */
  ingest(projectId: string, input: Partial<FeedbackItem> & { message: string; type?: FeedbackItem["type"] }): FeedbackItem {
    this.n += 1;
    const number = this.feedbackOf(projectId).length + 1;
    const f: FeedbackItem = {
      id: crypto.randomUUID(),
      project_id: projectId,
      number,
      type: input.type ?? "bug",
      sentiment: input.sentiment ?? null,
      title: input.title ?? input.message.split("\n")[0]!.slice(0, 80),
      message: input.message,
      status: "new",
      priority: "none",
      tags: input.tags ?? [],
      reporter_email: input.reporter_email ?? null,
      reporter_id: null,
      page_url: input.page_url ?? null,
      app_version: null,
      locale: null,
      user_agent: "test",
      metadata: {},
      source: "api",
      has_screenshot: Boolean(input.has_screenshot),
      screenshot: input.has_screenshot ? { content_type: "image/jpeg", size: 1000, width: 10, height: 10 } : null,
      roadmap_item_id: null,
      created_at: NOW,
      updated_at: NOW,
    };
    this.feedback.set(f.id, f);
    return f;
  }

  fetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api/, "");
    this.calls.push(`${method} ${path}`);
    const headers = init?.headers as Record<string, string>;
    if (headers["X-API-Key"] !== "retro_live_test") return json(401, { error: { code: "unauthorized", message: "bad key" } });
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (path === "/apikeys/me") return json(200, keyInfo(this.role));

    // --- projects ---
    if (path === "/projects" && method === "GET") {
      const items = [...this.projects.values()].map((p) => this.view(p));
      return this.need("projects:read") ?? json(200, { items, total: items.length });
    }
    if (path === "/projects" && method === "POST") {
      const denied = this.need("projects:write");
      if (denied) return denied;
      if (this.limitReached === "projects") return json(402, { error: { code: "limit_reached", message: "Project limit reached.", which: "projects" } });
      const key = body.key ?? String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if ([...this.projects.values()].some((p) => p.key === key)) return json(409, { error: { code: "key_taken", message: `Key ${key} is taken.` } });
      this.n += 1;
      const p: StoredProject = {
        id: crypto.randomUUID(), key, name: body.name, description: body.description ?? null, url: body.url ?? null,
        public_key: `retro_pub_k${this.n}secret`, public_key_prefix: `retro_pub_k${this.n}`,
        board_slug: key, board_enabled: false, board_url: null, board_title: null, board_intro: null,
        allow_votes: true, allow_board_submissions: true, types_enabled: ["bug", "feedback", "feature"],
        allow_screenshots: true, allow_email: true, widget_accent: null,
        counts: { feedback: 0, new: 0, roadmap: 0 }, created_at: NOW, updated_at: NOW, notes: new Map(),
      };
      this.projects.set(p.id, p);
      return json(201, this.view(p));
    }
    const pm = path.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
    if (!pm) {
      if (path === "/account/usage") {
        return this.need("usage:read") ?? json(200, {
          period_start: "2026-10-01", period_end: "2026-11-01", feedback: 1234, attachment_bytes: 52428800,
          counts: { projects: this.projects.size, api_keys: 1 },
          limits: { projects: 20, api_keys: 20, feedback_per_month: 10000, attachment_storage_mb: 2048, roadmap_items_per_project: 500 },
        });
      }
      if (path === "/account/audit") {
        return this.need("audit:read") ?? json(200, {
          items: [{
            id: "ev-1", ts: NOW, actor_type: "api_key", actor_id: "key-1", actor_label: "retro_live_test",
            action: "feedback.update", target_type: "feedback", target_id: "f-1", outcome: "ok", meta: { fields: ["status"], from: "new", to: "triaged" },
          }],
        });
      }
      return notFound(`route ${method} ${path}`);
    }
    const project = this.projects.get(pm[1]!);
    if (!project) return notFound("Project");
    const sub = pm[2] ?? "";

    if (sub === "") {
      if (method === "GET") return this.need("projects:read") ?? json(200, this.view(project));
      if (method === "PATCH") {
        const denied = this.need("projects:write");
        if (denied) return denied;
        if (body.board_slug === "api") return json(400, { error: { code: "reserved_slug", message: "Reserved." } });
        Object.assign(project, body);
        return json(200, this.view(project));
      }
      if (method === "DELETE") {
        const denied = this.need("projects:delete");
        if (denied) return denied;
        this.projects.delete(project.id);
        for (const f of this.feedbackOf(project.id)) this.feedback.delete(f.id);
        for (const r of this.roadmapOf(project.id)) this.roadmap.delete(r.id);
        return new Response(null, { status: 204 });
      }
    }
    if (sub === "rotate-key" && method === "POST") {
      const denied = this.need("projects:write");
      if (denied) return denied;
      this.n += 1;
      project.public_key = `retro_pub_r${this.n}secret`;
      project.public_key_prefix = `retro_pub_r${this.n}`;
      return json(200, { public_key: project.public_key, public_key_prefix: project.public_key_prefix });
    }
    if (sub === "summary") {
      const denied = this.need("feedback:read");
      if (denied) return denied;
      const items = this.feedbackOf(project.id);
      const count = (key: (f: FeedbackItem) => string | null) => {
        const out: Record<string, number> = {};
        for (const f of items) { const k = key(f); if (k) out[k] = (out[k] ?? 0) + 1; }
        return out;
      };
      const tags = count((f) => f.tags[0] ?? null);
      const s: Summary = {
        project_id: project.id, total: items.length, by_status: count((f) => f.status), by_type: count((f) => f.type),
        by_sentiment: count((f) => f.sentiment), last_7_days: items.length, last_30_days: items.length,
        top_tags: Object.entries(tags).map(([tag, c]) => ({ tag, count: c })),
      };
      return json(200, s);
    }
    if (sub === "tags") {
      const denied = this.need("feedback:read");
      if (denied) return denied;
      const tags: Record<string, number> = {};
      for (const f of this.feedbackOf(project.id)) for (const t of f.tags) tags[t] = (tags[t] ?? 0) + 1;
      return json(200, { tags: Object.entries(tags).map(([tag, count]) => ({ tag, count })) });
    }

    // --- feedback ---
    if (sub === "feedback" && method === "GET") {
      const denied = this.need("feedback:read");
      if (denied) return denied;
      let items = this.feedbackOf(project.id);
      const status = url.searchParams.get("status");
      if (status) items = items.filter((f) => status.split(",").includes(f.status));
      const type = url.searchParams.get("type");
      if (type) items = items.filter((f) => type.split(",").includes(f.type));
      const q = url.searchParams.get("q");
      if (q) items = items.filter((f) => f.message.includes(q) || f.title.includes(q));
      if (url.searchParams.get("sort") === "oldest") items = [...items].reverse();
      return json(200, { items: items.map(({ notes: _n, ...f }) => f), page: Number(url.searchParams.get("page") ?? 1), per_page: Number(url.searchParams.get("per_page") ?? 50), total: items.length });
    }
    const fm = sub.match(/^feedback\/([^/]+)(?:\/(notes|promote|screenshot)(?:\/([^/]+))?)?$/);
    if (fm) {
      const f = this.findItem(project.id, decodeURIComponent(fm[1]!));
      if (!f) return notFound("Feedback item");
      const action = fm[2];
      if (!action) {
        if (method === "GET") return this.need("feedback:read") ?? json(200, { ...f, notes: project.notes.get(f.id) ?? [] });
        if (method === "PATCH") {
          const denied = this.need("feedback:write");
          if (denied) return denied;
          Object.assign(f, body, { updated_at: NOW });
          return json(200, f);
        }
        if (method === "DELETE") {
          const denied = this.need("feedback:delete");
          if (denied) return denied;
          this.feedback.delete(f.id);
          return new Response(null, { status: 204 });
        }
      }
      if (action === "notes" && method === "POST") {
        const denied = this.need("feedback:write");
        if (denied) return denied;
        const note: Note = { id: crypto.randomUUID(), body: body.body, author: null, created_at: NOW };
        project.notes.set(f.id, [...(project.notes.get(f.id) ?? []), note]);
        return json(201, note);
      }
      if (action === "promote" && method === "POST") {
        const denied = this.need("feedback:write") ?? this.need("board:write");
        if (denied) return denied;
        if (f.roadmap_item_id) return json(200, { item: f, roadmap_item: this.roadmap.get(f.roadmap_item_id) });
        if (this.limitReached === "roadmap_items") return json(402, { error: { code: "limit_reached", message: "Roadmap limit reached.", which: "roadmap_items" } });
        const r = this.makeRoadmap(project.id, { title: body.title ?? f.title, description: body.description ?? f.message, status: body.status ?? "planned" });
        r.feedback_count = 1;
        f.roadmap_item_id = r.id;
        if (!["in_progress", "done"].includes(f.status)) f.status = "planned";
        return json(201, { item: f, roadmap_item: r });
      }
    }

    // --- roadmap ---
    if (sub === "roadmap" && method === "GET") {
      const denied = this.need("board:read");
      if (denied) return denied;
      let items = this.roadmapOf(project.id);
      const status = url.searchParams.get("status");
      if (status) items = items.filter((r) => r.status === status);
      return json(200, { items });
    }
    if (sub === "roadmap" && method === "POST") {
      const denied = this.need("board:write");
      if (denied) return denied;
      if (this.limitReached === "roadmap_items") return json(402, { error: { code: "limit_reached", message: "Roadmap limit reached.", which: "roadmap_items" } });
      return json(201, this.makeRoadmap(project.id, body));
    }
    const rm = sub.match(/^roadmap\/([^/]+)$/);
    if (rm) {
      const r = this.roadmap.get(rm[1]!);
      if (!r || r.project_id !== project.id) return notFound("Roadmap item");
      if (method === "PATCH") {
        const denied = this.need("board:write");
        if (denied) return denied;
        Object.assign(r, body, { updated_at: NOW });
        if (body.status === "done") r.completed_at = NOW;
        for (const f of this.feedbackOf(project.id)) if (f.roadmap_item_id === r.id && body.status) f.status = body.status;
        return json(200, r);
      }
      if (method === "DELETE") {
        const denied = this.need("board:delete");
        if (denied) return denied;
        this.roadmap.delete(r.id);
        for (const f of this.feedbackOf(project.id)) if (f.roadmap_item_id === r.id) f.roadmap_item_id = null;
        return new Response(null, { status: 204 });
      }
    }

    // --- changelog ---
    if (sub === "changelog" && method === "GET") {
      const denied = this.need("board:read");
      if (denied) return denied;
      let items = [...this.changelog.values()].filter((c) => c.project_id === project.id);
      if (url.searchParams.get("include_drafts") === "false") items = items.filter((c) => c.published_at);
      return json(200, { items });
    }
    if (sub === "changelog" && method === "POST") {
      const denied = this.need("board:write");
      if (denied) return denied;
      const c: ChangelogEntry = {
        id: crypto.randomUUID(), project_id: project.id, title: body.title, body: body.body, version: body.version ?? null,
        published_at: body.publish ? NOW : null, roadmap_item_ids: [], created_at: NOW, updated_at: NOW,
      };
      this.changelog.set(c.id, c);
      return json(201, c);
    }
    const cm = sub.match(/^changelog\/([^/]+)$/);
    if (cm) {
      const c = this.changelog.get(cm[1]!);
      if (!c || c.project_id !== project.id) return notFound("Changelog entry");
      if (method === "PATCH") {
        const denied = this.need("board:write");
        if (denied) return denied;
        const { published, ...rest } = body;
        Object.assign(c, rest, { updated_at: NOW });
        if (published === true && !c.published_at) c.published_at = NOW;
        if (published === false) c.published_at = null;
        return json(200, c);
      }
      if (method === "DELETE") {
        const denied = this.need("board:delete");
        if (denied) return denied;
        this.changelog.delete(c.id);
        return new Response(null, { status: 204 });
      }
    }
    return notFound(`route ${method} ${path}`);
  };

  private makeRoadmap(projectId: string, body: { title: string; description?: string; status?: RoadmapItem["status"]; public?: boolean }): RoadmapItem {
    const r: RoadmapItem = {
      id: crypto.randomUUID(), project_id: projectId, title: body.title, description: body.description ?? null,
      status: body.status ?? "planned", position: this.roadmapOf(projectId).length, public: body.public ?? true,
      votes: 0, feedback_count: 0, completed_at: null, created_at: NOW, updated_at: NOW,
    };
    this.roadmap.set(r.id, r);
    return r;
  }
}

type Elicit = (message: string) => Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }>;

async function connect(role: Role, opts: { elicit?: Elicit; apiRole?: Role; api?: FakeApi } = {}) {
  const api = opts.api ?? new FakeApi(opts.apiRole ?? role);
  const client = new RetroClient({ baseUrl: "http://fake/api", apiKey: "retro_live_test", fetch: api.fetch as typeof fetch });
  const audit = new MemoryAuditSink();
  const server = createRetroServer({ client, keyInfo: keyInfo(role), audit, transport: "test" });

  const mcp = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: opts.elicit ? { elicitation: { form: {} } } : {} });
  if (opts.elicit) mcp.setRequestHandler(ElicitRequestSchema, async (req) => opts.elicit!(req.params.message));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);

  const call = (name: string, args: Record<string, unknown> = {}) =>
    mcp.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  const toolNames = async () => (await mcp.listTools()).tools.map((t) => t.name).sort();
  const textOf = (r: CallToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  const project = async (name = "Web app") => (await call("create_project", { name })).structuredContent as Project;
  return { api, mcp, audit, server, call, toolNames, textOf, project };
}

describe("RBAC: tool visibility follows the key's role", () => {
  test("viewer sees read-only tools only", async () => {
    const { toolNames } = await connect("viewer");
    const names = await toolNames();
    expect(names).toEqual(
      ["feedback_summary", "get_feedback", "get_project", "get_usage", "list_changelog", "list_feedback", "list_projects", "list_roadmap", "list_tags"].sort(),
    );
    expect(names).not.toContain("update_feedback");
    expect(names).not.toContain("delete_feedback");
  });

  test("editor adds write tools but no delete or audit", async () => {
    const { toolNames } = await connect("editor");
    const names = await toolNames();
    for (const t of ["create_project", "update_project", "rotate_project_key", "update_feedback", "add_note", "promote_to_roadmap", "create_roadmap_item", "update_roadmap_item", "create_changelog_entry", "update_changelog_entry"]) {
      expect(names).toContain(t);
    }
    for (const t of ["delete_project", "delete_feedback", "delete_roadmap_item", "delete_changelog_entry", "get_audit_log"]) expect(names).not.toContain(t);
  });

  test("admin sees every tool in CONTRACT.md", async () => {
    const { toolNames } = await connect("admin");
    expect(await toolNames()).toEqual([...ALL_TOOLS].sort());
    expect(ALL_TOOLS).toHaveLength(24);
  });

  test("promote_to_roadmap needs BOTH feedback:write and board:write", () => {
    expect(allowedTools(["feedback:read", "feedback:write"])).not.toContain("promote_to_roadmap");
    expect(allowedTools(["feedback:write", "board:write"])).toContain("promote_to_roadmap");
  });

  test("a hidden tool cannot be called", async () => {
    const { call, textOf, api } = await connect("viewer");
    const r = await call("create_project", { name: "x" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/not found/i);
    expect(api.calls.filter((c) => c.startsWith("POST"))).toHaveLength(0);
  });

  test("the API's own scope check is surfaced as a denied result, not a crash", async () => {
    // Server believes it is admin, API says viewer (e.g. key downgraded after start).
    const { call, textOf, audit } = await connect("admin", { apiRole: "viewer" });
    const r = await call("create_project", { name: "x" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("insufficient_scope");
    expect(textOf(r)).toContain('"required_scope":"projects:write"');
    expect(audit.entries.at(-1)?.outcome).toBe("denied");
  });
});

describe("projects", () => {
  test("create_project returns the public key and a widget snippet", async () => {
    const c = await connect("editor");
    const r = await c.call("create_project", { name: "Web app", url: "https://example.com" });
    expect(r.isError).toBeFalsy();
    const p = r.structuredContent as Project;
    expect(p.key).toBe("web-app");
    expect(p.public_key).toMatch(/^retro_pub_/);
    expect(p.board_enabled).toBe(false);
    expect(c.textOf(r)).toContain(`data-project-key="${p.public_key}"`);
    expect((await c.call("list_projects")).structuredContent).toMatchObject({ total: 1 });
  });

  test("key_taken and limit_reached surface with their codes", async () => {
    const c = await connect("editor");
    await c.project();
    const dup = await c.call("create_project", { name: "Web app" });
    expect(dup.isError).toBe(true);
    expect(c.textOf(dup)).toContain("key_taken");
    c.api.limitReached = "projects";
    const lim = await c.call("create_project", { name: "Other" });
    expect(lim.isError).toBe(true);
    expect(c.textOf(lim)).toContain("limit_reached");
    expect(c.textOf(lim)).toContain('"which":"projects"');
    expect(c.audit.entries.at(-1)?.error?.code).toBe("limit_reached");
  });

  test("update_project enables the board, rotate_project_key issues a new key", async () => {
    const c = await connect("editor");
    const p = await c.project();
    const up = (await c.call("update_project", { project_id: p.id, board_enabled: true, types_enabled: ["bug", "feature"] })).structuredContent as Project;
    expect(up.board_enabled).toBe(true);
    expect(up.board_url).toContain("/b/web-app");
    expect(up.types_enabled).toEqual(["bug", "feature"]);
    const reserved = await c.call("update_project", { project_id: p.id, board_slug: "api" });
    expect(reserved.isError).toBe(true);
    expect(c.textOf(reserved)).toContain("reserved_slug");

    const rot = await c.call("rotate_project_key", { project_id: p.id });
    expect(rot.isError).toBeFalsy();
    expect((rot.structuredContent as { public_key: string }).public_key).not.toBe(p.public_key);
  });

  test("invalid input is rejected before reaching the API", async () => {
    const c = await connect("editor");
    const before = c.api.calls.length;
    expect((await c.call("create_project", { name: "x", key: "Not A Slug" })).isError).toBe(true);
    expect((await c.call("update_project", { project_id: crypto.randomUUID(), widget_accent: "green" })).isError).toBe(true);
    expect((await c.call("update_project", { project_id: crypto.randomUUID(), types_enabled: [] })).isError).toBe(true);
    expect(c.api.calls.length).toBe(before);
  });
});

describe("feedback", () => {
  test("list_feedback filters, get_feedback by number includes notes, summary and tags", async () => {
    const c = await connect("editor");
    const p = await c.project();
    const bug = c.api.ingest(p.id, { type: "bug", message: "Export button does nothing\nSteps: click export", tags: ["export"] });
    c.api.ingest(p.id, { type: "feedback", sentiment: "positive", message: "Love it" });
    c.api.ingest(p.id, { type: "feature", message: "Dark mode please", has_screenshot: true });

    const all = (await c.call("list_feedback", { project_id: p.id })).structuredContent as { total: number; items: FeedbackItem[] };
    expect(all.total).toBe(3);
    const bugs = await c.call("list_feedback", { project_id: p.id, type: "bug", status: "new,triaged" });
    expect((bugs.structuredContent as { total: number }).total).toBe(1);
    expect(c.textOf(bugs)).toContain("#1 🐞 new [export]");
    expect(c.api.calls.at(-1)).toBe(`GET /projects/${p.id}/feedback`);

    await c.call("add_note", { project_id: p.id, item: 1, body: "dup of nothing, real bug" });
    const got = await c.call("get_feedback", { project_id: p.id, item: 1 });
    expect(got.isError).toBeFalsy();
    const f = got.structuredContent as FeedbackItem;
    expect(f.id).toBe(bug.id);
    expect(f.notes).toHaveLength(1);
    expect(c.textOf(got)).toContain("Steps: click export");
    expect(c.textOf(got)).toContain("real bug");

    const s = await c.call("feedback_summary", { project_id: p.id });
    expect(s.isError).toBeFalsy();
    expect((s.structuredContent as Summary).by_type).toEqual({ bug: 1, feedback: 1, feature: 1 });
    expect(c.textOf(s)).toContain("By sentiment: positive 1");

    const tags = await c.call("list_tags", { project_id: p.id });
    expect((tags.structuredContent as { tags: unknown[] }).tags).toEqual([{ tag: "export", count: 1 }]);
  });

  test("update_feedback triages and audits; invalid enums are rejected locally", async () => {
    const c = await connect("editor");
    const p = await c.project();
    c.api.ingest(p.id, { message: "Crash on save" });
    const r = await c.call("update_feedback", { project_id: p.id, item: 1, status: "triaged", priority: "high", tags: ["crash", "save"] });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ status: "triaged", priority: "high", tags: ["crash", "save"] });
    expect(c.textOf(r)).toContain("triaged prio=high [crash, save]");
    expect(c.audit.entries.find((e) => e.tool === "update_feedback")?.outcome).toBe("ok");

    const before = c.api.calls.length;
    expect((await c.call("update_feedback", { project_id: p.id, item: 1, status: "wontfix" })).isError).toBe(true);
    expect((await c.call("update_feedback", { project_id: p.id, item: 1, priority: "urgent" })).isError).toBe(true);
    expect(c.api.calls.length).toBe(before);
  });

  test("promote_to_roadmap links the item, is idempotent and reports limit_reached", async () => {
    const c = await connect("editor");
    const p = await c.project();
    c.api.ingest(p.id, { type: "feature", message: "Dark mode please" });
    const r = await c.call("promote_to_roadmap", { project_id: p.id, item: 1 });
    expect(r.isError).toBeFalsy();
    const out = r.structuredContent as { item: FeedbackItem; roadmap_item: RoadmapItem };
    expect(out.roadmap_item.title).toBe("Dark mode please");
    expect(out.roadmap_item.status).toBe("planned");
    expect(out.item.status).toBe("planned");
    expect(out.item.roadmap_item_id).toBe(out.roadmap_item.id);

    const again = (await c.call("promote_to_roadmap", { project_id: p.id, item: 1 })).structuredContent as { roadmap_item: RoadmapItem };
    expect(again.roadmap_item.id).toBe(out.roadmap_item.id);

    c.api.ingest(p.id, { type: "feature", message: "Another" });
    c.api.limitReached = "roadmap_items";
    const lim = await c.call("promote_to_roadmap", { project_id: p.id, item: 2 });
    expect(lim.isError).toBe(true);
    expect(c.textOf(lim)).toContain('"which":"roadmap_items"');
  });
});

describe("roadmap and changelog", () => {
  test("create / update / list roadmap items; done cascades to linked feedback", async () => {
    const c = await connect("editor");
    const p = await c.project();
    c.api.ingest(p.id, { type: "feature", message: "Dark mode" });
    const promoted = (await c.call("promote_to_roadmap", { project_id: p.id, item: 1 })).structuredContent as { roadmap_item: RoadmapItem };
    const hidden = (await c.call("create_roadmap_item", { project_id: p.id, title: "Secret", public: false })).structuredContent as RoadmapItem;
    expect(hidden.public).toBe(false);

    const list = await c.call("list_roadmap", { project_id: p.id });
    expect((list.structuredContent as { items: RoadmapItem[] }).items).toHaveLength(2);
    expect(c.textOf(list)).toContain("(hidden) Secret");

    const done = (await c.call("update_roadmap_item", { project_id: p.id, roadmap_item_id: promoted.roadmap_item.id, status: "done" })).structuredContent as RoadmapItem;
    expect(done.completed_at).toBe(NOW);
    const f = (await c.call("get_feedback", { project_id: p.id, item: 1 })).structuredContent as FeedbackItem;
    expect(f.status).toBe("done");

    const planned = (await c.call("list_roadmap", { project_id: p.id, status: "planned" })).structuredContent as { items: RoadmapItem[] };
    expect(planned.items.map((r) => r.id)).toEqual([hidden.id]);
  });

  test("changelog entries: draft, publish, unpublish, list", async () => {
    const c = await connect("editor");
    const p = await c.project();
    const draft = (await c.call("create_changelog_entry", { project_id: p.id, title: "Dark mode is here", body: "## New\n- dark mode", version: "1.5.0" })).structuredContent as ChangelogEntry;
    expect(draft.published_at).toBeNull();
    expect(c.textOf((await c.call("list_changelog", { project_id: p.id })))).toContain("v1.5.0 Dark mode is here — DRAFT");

    const pub = (await c.call("update_changelog_entry", { project_id: p.id, changelog_entry_id: draft.id, published: true })).structuredContent as ChangelogEntry;
    expect(pub.published_at).toBe(NOW);
    const published = (await c.call("list_changelog", { project_id: p.id, include_drafts: false })).structuredContent as { items: ChangelogEntry[] };
    expect(published.items).toHaveLength(1);

    const un = (await c.call("update_changelog_entry", { project_id: p.id, changelog_entry_id: draft.id, published: false })).structuredContent as ChangelogEntry;
    expect(un.published_at).toBeNull();
    const immediate = (await c.call("create_changelog_entry", { project_id: p.id, title: "Hotfix", body: "fixed", publish: true })).structuredContent as ChangelogEntry;
    expect(immediate.published_at).toBe(NOW);
  });

  test("get_usage and get_audit_log return schema-valid structured content", async () => {
    const c = await connect("admin");
    const u = await c.call("get_usage");
    expect(u.isError).toBeFalsy();
    expect(c.textOf(u)).toContain("1234/10000 feedback items");
    expect(c.textOf(u)).toContain("50.0/2048 MB screenshots");
    const a = await c.call("get_audit_log", { limit: 5 });
    expect(a.isError).toBeFalsy();
    expect((a.structuredContent as { items: unknown[] }).items).toHaveLength(1);
    expect(c.textOf(a)).toContain("feedback.update");
  });
});

describe("destructive tools require human approval", () => {
  test("delete_project refuses without confirmation and succeeds with confirm=true", async () => {
    const c = await connect("admin");
    const p = await c.project();
    c.api.ingest(p.id, { message: "x" });

    const refused = await c.call("delete_project", { project_id: p.id });
    expect(refused.isError).toBe(true);
    expect(c.textOf(refused)).toContain("confirmation_required");
    expect(c.textOf(refused)).toContain("Web app");
    expect(c.textOf(refused)).toContain("1 feedback item(s)");
    expect(c.api.projects.has(p.id)).toBe(true);
    expect(c.audit.entries.at(-1)?.outcome).toBe("pending");
    expect(c.api.calls.filter((x) => x.startsWith("DELETE"))).toHaveLength(0);

    const done = await c.call("delete_project", { project_id: p.id, confirm: true });
    expect(done.isError).toBeFalsy();
    expect(done.structuredContent).toEqual({ deleted: true, id: p.id, key: "web-app", name: "Web app" });
    expect(c.api.projects.has(p.id)).toBe(false);
    expect(c.api.feedback.size).toBe(0);
    expect(c.audit.entries.at(-1)?.outcome).toBe("ok");
  });

  test("delete_feedback, delete_roadmap_item and delete_changelog_entry follow the same flow", async () => {
    const c = await connect("admin");
    const p = await c.project();
    const f = c.api.ingest(p.id, { message: "Spam" });
    const r = (await c.call("create_roadmap_item", { project_id: p.id, title: "Old plan" })).structuredContent as RoadmapItem;
    const e = (await c.call("create_changelog_entry", { project_id: p.id, title: "Oops", body: "x" })).structuredContent as ChangelogEntry;

    for (const [tool, args] of [
      ["delete_feedback", { project_id: p.id, item: f.id }],
      ["delete_roadmap_item", { project_id: p.id, roadmap_item_id: r.id }],
      ["delete_changelog_entry", { project_id: p.id, changelog_entry_id: e.id }],
    ] as const) {
      const refused = await c.call(tool, { ...args });
      expect(refused.isError).toBe(true);
      expect(c.textOf(refused)).toContain("confirmation_required");
    }
    expect(c.api.calls.filter((x) => x.startsWith("DELETE"))).toHaveLength(0);

    const df = await c.call("delete_feedback", { project_id: p.id, item: f.id, confirm: true });
    expect(df.structuredContent).toEqual({ deleted: true, id: f.id, number: 1, project_id: p.id });
    const dr = await c.call("delete_roadmap_item", { project_id: p.id, roadmap_item_id: r.id, confirm: true });
    expect(dr.structuredContent).toMatchObject({ deleted: true, id: r.id });
    const de = await c.call("delete_changelog_entry", { project_id: p.id, changelog_entry_id: e.id, confirm: true });
    expect(de.structuredContent).toMatchObject({ deleted: true, id: e.id });
    expect(c.api.feedback.size).toBe(0);
    expect(c.api.roadmap.size).toBe(0);
    expect(c.api.changelog.size).toBe(0);

    const missing = await c.call("delete_roadmap_item", { project_id: p.id, roadmap_item_id: crypto.randomUUID(), confirm: true });
    expect(missing.isError).toBe(true);
    expect(c.textOf(missing)).toContain("not_found");
  });

  test("with elicitation, the user is asked and can accept", async () => {
    const asked: string[] = [];
    const c = await connect("admin", {
      elicit: async (message) => {
        asked.push(message);
        return { action: "accept", content: { confirm: true } };
      },
    });
    const p = await c.project();
    const f = c.api.ingest(p.id, { type: "bug", message: "Crash on save" });
    const done = await c.call("delete_feedback", { project_id: p.id, item: f.id });
    expect(done.isError).toBeFalsy();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("#1");
    expect(asked[0]).toContain("Crash on save");
    expect(c.api.feedback.has(f.id)).toBe(false);
  });

  test("with elicitation, declining cancels and nothing is deleted", async () => {
    const c = await connect("admin", { elicit: async () => ({ action: "decline" }) });
    const p = await c.project();
    const r = await c.call("delete_project", { project_id: p.id });
    expect(r.isError).toBeFalsy();
    expect(c.textOf(r)).toContain("cancelled");
    expect((r.structuredContent as { deleted: boolean }).deleted).toBe(false);
    expect(c.api.projects.has(p.id)).toBe(true);
    expect(c.audit.entries.at(-1)?.outcome).toBe("cancelled");
    expect(c.api.calls.filter((x) => x.startsWith("DELETE"))).toHaveLength(0);
  });
});

describe("resources and prompts", () => {
  test("projects resource and summary template are exposed for a viewer", async () => {
    const admin = await connect("admin");
    const p = await admin.project();
    admin.api.ingest(p.id, { message: "x" });
    const viewer = await connect("viewer", { api: Object.assign(admin.api, { role: "viewer" as Role }) });
    const res = await viewer.mcp.listResources();
    expect(res.resources.map((r) => r.uri)).toContain("retro://projects");
    const tpl = await viewer.mcp.listResourceTemplates();
    expect(tpl.resourceTemplates.map((t) => t.uriTemplate)).toContain("retro://projects/{id}/summary");
    const list = await viewer.mcp.readResource({ uri: "retro://projects" });
    expect(JSON.parse((list.contents[0] as { text: string }).text).total).toBe(1);
    const summary = await viewer.mcp.readResource({ uri: `retro://projects/${p.id}/summary` });
    expect(JSON.parse((summary.contents[0] as { text: string }).text).total).toBe(1);
  });

  test("triage_inbox prompt is available when feedback:read is granted", async () => {
    const { mcp } = await connect("viewer");
    const prompts = await mcp.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain("triage_inbox");
    const got = await mcp.getPrompt({ name: "triage_inbox", arguments: { project_id: "p-1" } });
    const text = (got.messages[0]!.content as { text: string }).text;
    expect(text).toContain('project_id="p-1"');
    expect(text).toContain("promote_to_roadmap");
  });
});

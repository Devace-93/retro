/**
 * Tool-level authorization.
 *
 * Every tool declares the scope(s) it needs. The server consults this table
 * twice (defense in depth):
 *
 *   1. at registration — tools the key cannot use are never listed, so the
 *      model is not tempted to call them;
 *   2. at call time — a tool that is somehow invoked without its scope is
 *      refused and the refusal is audited.
 *
 * The REST API enforces the same scopes independently (layer 3), so a bug in
 * this file can never *grant* access, only hide it.
 *
 * The table mirrors the "MCP (AI agents)" section of CONTRACT.md.
 */
import type { Scope } from "./types.js";

export const TOOL_SCOPES = {
  list_projects: ["projects:read"],
  get_project: ["projects:read"],
  create_project: ["projects:write"],
  update_project: ["projects:write"],
  rotate_project_key: ["projects:write"],
  delete_project: ["projects:delete"],
  list_feedback: ["feedback:read"],
  get_feedback: ["feedback:read"],
  feedback_summary: ["feedback:read"],
  list_tags: ["feedback:read"],
  update_feedback: ["feedback:write"],
  add_note: ["feedback:write"],
  promote_to_roadmap: ["feedback:write", "board:write"],
  delete_feedback: ["feedback:delete"],
  list_roadmap: ["board:read"],
  list_changelog: ["board:read"],
  create_roadmap_item: ["board:write"],
  update_roadmap_item: ["board:write"],
  create_changelog_entry: ["board:write"],
  update_changelog_entry: ["board:write"],
  delete_roadmap_item: ["board:delete"],
  delete_changelog_entry: ["board:delete"],
  get_usage: ["usage:read"],
  get_audit_log: ["audit:read"],
  // Phase 2
  export_project: ["feedback:read", "board:read"],
  reply_to_reporter: ["feedback:write"],
  merge_feedback: ["feedback:write"],
  list_saved_views: ["feedback:read"],
  create_saved_view: ["feedback:write"],
  list_webhooks: ["projects:read"],
  create_webhook: ["projects:write"],
  test_webhook: ["projects:write"],
  get_notification_settings: ["usage:read"],
  update_notification_settings: ["projects:write"],
} as const satisfies Record<string, readonly Scope[]>;

export type ToolName = keyof typeof TOOL_SCOPES;

export const ALL_TOOLS = Object.keys(TOOL_SCOPES) as ToolName[];

/** Tools that never run without explicit user confirmation. */
export const CONFIRMED_TOOLS: readonly ToolName[] = [
  "delete_project",
  "delete_feedback",
  "delete_roadmap_item",
  "delete_changelog_entry",
  "merge_feedback",
];

export function hasScope(scopes: Iterable<Scope>, scope: Scope): boolean {
  for (const s of scopes) if (s === scope) return true;
  return false;
}

/** True when every scope the tool needs is granted. */
export function hasAllScopes(scopes: Iterable<Scope>, required: readonly Scope[]): boolean {
  const set = new Set(scopes);
  return required.every((s) => set.has(s));
}

export function allowedTools(scopes: Iterable<Scope>): ToolName[] {
  const set = new Set(scopes);
  return ALL_TOOLS.filter((tool) => TOOL_SCOPES[tool].every((s) => set.has(s)));
}

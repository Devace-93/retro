#!/usr/bin/env node
/**
 * Streamable HTTP entrypoint (remote MCP).
 *
 * - One endpoint, `POST /mcp`. Auth is the retro API key as a Bearer token
 *   (`Authorization: Bearer retro_live_…`); `X-API-Key` is accepted too.
 * - Stateless: every request gets a fresh server + transport bound to the
 *   caller's key, so tenants can never share state. The cost is one
 *   `/apikeys/me` lookup per request, cached briefly per key.
 * - No elicitation here: a stateless server has no back-channel to the user,
 *   so the destructive tools fall back to the explicit `confirm=true` flow.
 */
import { createHash } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";

import { createAuditSink } from "./audit.js";
import { RetroApiError, RetroClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createRetroServer } from "./server.js";
import type { KeyInfo } from "./types.js";
import { VERSION } from "./version.js";

const cfg = loadConfig();
const audit = createAuditSink(cfg.auditLog);
const ME_CACHE_MS = 60_000;
const meCache = new Map<string, { info: KeyInfo; expires: number }>();

function extractKey(req: Request): string | undefined {
  const auth = req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.header("x-api-key")?.trim() || undefined;
}

async function resolveKey(apiKey: string): Promise<KeyInfo> {
  const id = createHash("sha256").update(apiKey).digest("hex");
  const hit = meCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.info;
  const info = await new RetroClient({ baseUrl: cfg.apiUrl, apiKey }).me();
  meCache.set(id, { info, expires: Date.now() + ME_CACHE_MS });
  return info;
}

function rpcError(res: Response, status: number, message: string): void {
  if (status === 401) res.setHeader("WWW-Authenticate", 'Bearer realm="retro-feedback-mcp"');
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", name: "retro-feedback-mcp", version: VERSION });
});

app.all("/mcp", async (req, res) => {
  const apiKey = extractKey(req);
  if (!apiKey) return rpcError(res, 401, "Missing API key. Send `Authorization: Bearer retro_live_…`.");

  let keyInfo: KeyInfo;
  try {
    keyInfo = await resolveKey(apiKey);
  } catch (err) {
    if (err instanceof RetroApiError && (err.status === 401 || err.status === 403)) {
      return rpcError(res, err.status, err.message);
    }
    return rpcError(res, 502, `Upstream retro API unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  const client = new RetroClient({ baseUrl: cfg.apiUrl, apiKey });
  const server = createRetroServer({ client, keyInfo, audit, transport: "http", allowElicitation: false });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(cfg.port, "0.0.0.0", () => {
  process.stderr.write(`retro-feedback-mcp http listening on :${cfg.port} (api: ${cfg.apiUrl})\n`);
});

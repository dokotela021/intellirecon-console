// IntelliRecon — thin backend.
//
// One file, three jobs:
//   1. Serve the built SPA (in prod) — in dev, Vite serves it and proxies here.
//   2. Bridge a real PTY to the browser over WS /pty (the in-browser terminal).
//   3. Run a Claude agent over WS /agent that can call MCP tools + the terminal.
//
// "Less backend" by design: no database, no auth service, no job queue. The
// browser holds the UI state; Claude holds the intelligence; this process only
// does the two things a browser physically can't — spawn a shell and hold an
// API key. Everything security-tool-related is delegated to MCP servers
// (configure them in mcp.config.json), mirroring the bundled engine's MCP model.

import http from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as db from "./db.mjs";
import { AGENT_MODES, DEFAULT_MODE, getMode, modesForClient } from "./agents.mjs";
import { WebSocketServer } from "ws";
import Anthropic from "@anthropic-ai/sdk";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT || 8899);
// Model + credentials. The Anthropic SDK talks to whatever ANTHROPIC_BASE_URL
// points at, so any Anthropic-compatible gateway works. To use OpenRouter's
// /v1/messages endpoint, set ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN (Bearer)
// and ANTHROPIC_MODEL instead of ANTHROPIC_API_KEY. See .env / .env.example.
const MODEL = process.env.INTELLIRECON_MODEL || process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const MAX_ROUNDS = 40; // safety cap on the agentic tool loop per user turn
// MCP tool calls (recon scans) routinely outlast the SDK's 60s default request
// timeout. Give them a generous ceiling, overridable via env.
const MCP_CALL_TIMEOUT_MS = Number(process.env.INTELLIRECON_MCP_TIMEOUT_MS || 300_000);

// ---------------------------------------------------------------------------
// node-pty is an optional native dep. If it isn't built, the terminal degrades
// to a line-oriented shell over child_process so the app still runs.
// ---------------------------------------------------------------------------
let pty = null;
try {
  pty = (await import("node-pty")).default;
} catch {
  console.warn("[intellirecon] node-pty unavailable — terminal runs in fallback (line) mode");
}

const SHELL = process.env.SHELL || "/bin/bash";
// Working directory shared by the human terminal and the agent's run_command.
let sharedCwd = process.env.INTELLIRECON_CWD || process.cwd();

// ---------------------------------------------------------------------------
// PTY sessions — one real shell per session id, kept alive independent of any
// single WebSocket. A tab attaches with its own stable id (kept in the
// browser's localStorage), so switching tabs, reloading the page, or a
// dropped connection no longer kills whatever the shell was running (a dev
// server, a long scan, tail -f, …) — only an explicit close (or the process
// exiting on its own) tears it down. Scrollback is buffered per session so a
// (re)attaching client sees what happened while it was disconnected.
// ---------------------------------------------------------------------------
const ptySessions = new Map(); // id -> { id, term, clients:Set<ws>, buffer, title, createdAt, readOnly? }
const SCROLLBACK_MAX = 200_000; // chars retained per session for late attaches

// The agent's run_command output used to be broadcast into whichever pty tab
// the browser happened to have open, so it could clobber a human's unrelated
// work in that tab mid-command. Instead it goes to exactly one pinned,
// read-only session — the frontend always shows it as its own "agent" tab
// (see TerminalTabs in terminal.tsx) — leaving every tab the operator creates
// exclusively theirs. It has no real pty (term stays null): it's a log, not a
// shell, so it reuses the same session/buffer/replay machinery for free.
const AGENT_LOG_SESSION_ID = "agent-log";

function ensureAgentLogSession() {
  let session = ptySessions.get(AGENT_LOG_SESSION_ID);
  if (!session) {
    session = {
      id: AGENT_LOG_SESSION_ID,
      term: null,
      clients: new Set(),
      buffer: "",
      title: "agent",
      createdAt: Date.now(),
      readOnly: true,
    };
    ptySessions.set(AGENT_LOG_SESSION_ID, session);
  }
  return session;
}

function broadcastToTerminals(text) {
  const session = ensureAgentLogSession();
  session.buffer += text;
  if (session.buffer.length > SCROLLBACK_MAX) session.buffer = session.buffer.slice(-SCROLLBACK_MAX);
  for (const ws of session.clients) if (ws.readyState === 1) ws.send(text);
}

// process.env carries whatever .env set for IntelliRecon's OWN agent calls
// (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL /
// ANTHROPIC_MODEL — see makeAnthropic() below). The browser terminal's shell
// is a general-purpose shell the operator also runs their own tools in
// (Claude Code's `claude` CLI included) — those vars must not leak into it,
// or `claude` silently inherits IntelliRecon's gateway/model config instead
// of the operator's own Anthropic auth. Strip them; the shell falls back to
// whatever the operator's own profile/login configures.
const SHELL_ENV = { ...process.env };
delete SHELL_ENV.ANTHROPIC_API_KEY;
delete SHELL_ENV.ANTHROPIC_AUTH_TOKEN;
delete SHELL_ENV.ANTHROPIC_BASE_URL;
delete SHELL_ENV.ANTHROPIC_MODEL;

function createPtySession(id, title) {
  const term = pty
    ? pty.spawn(SHELL, [], { name: "xterm-color", cols: 80, rows: 24, cwd: sharedCwd, env: SHELL_ENV })
    : null;
  const session = { id, term, clients: new Set(), buffer: "", title: title || "shell", createdAt: Date.now() };
  ptySessions.set(id, session);
  if (term) {
    term.onData((d) => {
      session.buffer += d;
      if (session.buffer.length > SCROLLBACK_MAX) session.buffer = session.buffer.slice(-SCROLLBACK_MAX);
      for (const ws of session.clients) if (ws.readyState === 1) ws.send(d);
    });
    term.onExit(() => closePtySession(id));
  }
  return session;
}

function closePtySession(id) {
  const session = ptySessions.get(id);
  if (!session) return;
  ptySessions.delete(id);
  for (const ws of session.clients) {
    if (ws.readyState === 1) ws.close();
  }
}

// ---------------------------------------------------------------------------
// MCP: connect to configured servers, discover their tools, expose to Claude.
// ---------------------------------------------------------------------------
const toolRegistry = new Map(); // anthropicName -> { server, mcpName, client }
const mcpClients = [];

function sanitizeToolName(server, name) {
  return `${server}__${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Push a refreshed tool list to every connected agent client. Called whenever a
// server comes online (possibly well after boot) so the MCP Tools view fills in
// without a page reload.
function refreshAgentClients() {
  for (const ws of agentWss.clients) {
    send(ws, {
      type: "ready",
      tools: toolInfoForClient(),
      model: MODEL,
      hasKey: HAS_KEY,
      modes: modesForClient(),
      mode: ws.session?.mode || DEFAULT_MODE,
    });
  }
}

// One connect attempt: spawn the server, handshake, and register its tools.
// Returns true on success. On failure it closes the transport (killing the child
// process) so a retry doesn't leak a half-connected server — this is what the
// old code got wrong: a timed-out `connect` left intellirecon_mcp.py running and
// abandoned, and IntelliRecon never picked it up when it finally came online.
async function tryConnectServer(name, spec) {
  const transport = new StdioClientTransport({
    command: spec.command,
    args: (spec.args || []).map((a) => (a.startsWith(".") ? path.resolve(ROOT, a) : a)),
    env: { ...process.env, ...(spec.env || {}) },
    cwd: ROOT,
  });
  const client = new McpClient({ name: "intellirecon", version: "1.0.0" }, { capabilities: {} });
  const startupTimeout = spec.startupTimeoutMs || 60000;
  try {
    await withTimeout(client.connect(transport), startupTimeout, `connect ${name}`);
    const { tools } = await withTimeout(client.listTools(), startupTimeout, `listTools ${name}`);
    // Per-tool call ceilings (seconds) from mcp.config.json. `default` covers
    // this server's tools; a named entry overrides it for slow enumerators
    // (amass, fierce, …). Falls back to the global MCP_CALL_TIMEOUT_MS.
    const toolTimeouts = spec.toolTimeouts || {};
    for (const t of tools) {
      const anthropicName = sanitizeToolName(name, t.name);
      const secs = toolTimeouts[t.name] ?? toolTimeouts.default;
      const timeoutMs = Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined;
      toolRegistry.set(anthropicName, { server: name, mcpName: t.name, client, schema: t, timeoutMs });
    }
    mcpClients.push({ name, client });
    console.log(`[intellirecon] MCP "${name}" connected — ${tools.length} tools`);
    return true;
  } catch (e) {
    await client.close().catch(() => {}); // terminate the spawned child before retrying
    console.warn(`[intellirecon] MCP "${name}" not ready: ${e.message}`);
    return false;
  }
}

// Keep trying a server in the background until it connects or we exhaust retries.
// Handles the common startup race where the MCP server (or the API server behind
// it) takes longer to come up than IntelliRecon's boot.
async function connectServerWithRetry(name, spec) {
  const maxAttempts = spec.connectRetries ?? 6;
  const retryDelayMs = spec.retryDelayMs ?? 10000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await tryConnectServer(name, spec)) {
      refreshAgentClients(); // late arrival — fill in the browser's tool list live
      return;
    }
    if (attempt < maxAttempts) {
      console.warn(`[intellirecon] MCP "${name}" retry ${attempt}/${maxAttempts - 1} in ${retryDelayMs / 1000}s`);
      await sleep(retryDelayMs);
    }
  }
  console.warn(`[intellirecon] MCP "${name}" gave up after ${maxAttempts} attempts`);
}

async function connectMcpServers() {
  const cfgPath = path.join(ROOT, "mcp.config.json");
  if (!existsSync(cfgPath)) return;
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch (e) {
    console.warn("[intellirecon] mcp.config.json parse error:", e.message);
    return;
  }
  const servers = cfg.mcpServers || {};
  // Connect every server in parallel; each retries independently in the
  // background so one slow server doesn't hold up the others.
  await Promise.all(
    Object.entries(servers)
      .filter(([, spec]) => spec.enabled !== false)
      .map(([name, spec]) => connectServerWithRetry(name, spec)),
  );
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)),
  ]);
}

// Built-in tools always available to the agent, independent of any MCP server.
const BUILTIN_TOOLS = [
  {
    name: "run_command",
    description:
      "Run a shell command on the operator's machine and return combined stdout/stderr. " +
      "Runs in the session working directory, which persists across calls. Use this for any " +
      "security tool available locally (nmap, ffuf, curl, dig, whois, subfinder, CloudRecon, " +
      "etc.). The output is also echoed into the operator's pinned 'agent' terminal tab " +
      "(their own manual shell tabs are untouched). Keep commands non-interactive.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute." },
        timeout_seconds: { type: "number", description: "Max seconds before killing (default 120)." },
      },
      required: ["command"],
    },
  },
  {
    name: "report_finding",
    description:
      "Record a verified security finding so it appears on the operator's Findings board. " +
      "Only report things you have evidence for from tool output.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
        target: { type: "string", description: "Host, URL, or asset the finding concerns." },
        detail: { type: "string", description: "Evidence and short explanation." },
      },
      required: ["title", "severity"],
    },
  },
];

// ---------------------------------------------------------------------------
// Knowledge base tools — the durable, cross-mode memory described in
// server/agents.mjs. query_knowledge_base and add_note are universal (every
// mode can read the whole KB and leave a note); the record_* tools are
// curated per mode via AGENT_MODES[].kbTools ("*" = all of them).
// ---------------------------------------------------------------------------
const KB_RECORD_TOOLS = [
  {
    name: "record_js_asset",
    description: "Record a JS asset (script, source map, worker, chunk) found on a target, for the knowledge base.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        url: { type: "string" },
        kind: { type: "string", enum: ["script", "sourcemap", "worker", "service_worker", "chunk"] },
        notes: { type: "string" },
      },
      required: ["target", "url"],
    },
  },
  {
    name: "record_endpoint",
    description:
      "Record or update an API endpoint spec in the knowledge base. Re-recording the same target+method+path merges in new fields instead of overwriting.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        method: { type: "string" },
        path: { type: "string" },
        source: { type: "string", description: "js | api-mapping | burp | manual" },
        auth_required: { type: "string", enum: ["yes", "no", "unknown"] },
        params: { type: "object", description: "Request params/body shape." },
        headers: { type: "object", description: "Required headers/cookies." },
        responses: { type: "object", description: "Observed status codes and what they mean." },
        notes: { type: "string" },
      },
      required: ["target", "method", "path"],
    },
  },
  {
    name: "record_role",
    description: "Record a role/privilege level discovered in the target's authorization model.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        name: { type: "string" },
        level: { type: "number", description: "Relative privilege level, higher = more privileged." },
        description: { type: "string" },
      },
      required: ["target", "name"],
    },
  },
  {
    name: "record_role_access",
    description: "Record whether a role can reach a given endpoint, for cross-role comparison.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        role: { type: "string" },
        endpoint: { type: "string", description: "e.g. 'GET /api/admin/users'." },
        accessible: { type: "string", enum: ["yes", "no", "unknown", "inconsistent"] },
        notes: { type: "string" },
      },
      required: ["target", "role", "endpoint", "accessible"],
    },
  },
  {
    name: "record_token_config",
    description: "Record or update what's known about a session/JWT/refresh/CSRF token kind for a target.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        kind: { type: "string", enum: ["jwt", "session_cookie", "refresh", "csrf"] },
        lifetime: { type: "string" },
        rotation: { type: "string" },
        algorithm: { type: "string" },
        claims: { type: "object" },
        cookie_flags: { type: "object" },
        notes: { type: "string" },
      },
      required: ["target", "kind"],
    },
  },
  {
    name: "record_business_flow",
    description: "Record or update a multi-step business workflow (registration, checkout, password reset, ...).",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        name: { type: "string" },
        steps: { type: "array", items: { type: "string" }, description: "Ordered step descriptions." },
        verified_server_side: { type: "string", enum: ["yes", "no", "partial", "unknown"] },
        notes: { type: "string" },
      },
      required: ["target", "name"],
    },
  },
  {
    name: "record_third_party",
    description: "Record a third-party origin the target depends on (CDN, storage bucket, SaaS API, OAuth provider, ...).",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        name: { type: "string" },
        category: { type: "string", description: "cdn | storage | analytics | oauth | payment | other" },
        url: { type: "string" },
        notes: { type: "string" },
      },
      required: ["target", "name"],
    },
  },
  {
    name: "record_client_observation",
    description: "Record a client-side-only observation (storage key, DOM/feature flag, console warning, cookie).",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        category: { type: "string", enum: ["storage", "dom", "feature_flag", "console", "cookie"] },
        detail: { type: "string" },
        url: { type: "string" },
      },
      required: ["target", "detail"],
    },
  },
];

const KB_UNIVERSAL_TOOLS = [
  {
    name: "query_knowledge_base",
    description:
      "Read everything recorded so far for a target: JS assets, endpoints, roles, role access, tokens, business flows, third parties, client observations, and notes. Call this first when switching into a mode or resuming work on a target.",
    input_schema: {
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    },
  },
  {
    name: "add_note",
    description: "Leave a free-text note on a target's knowledge base for a human or another agent mode to see.",
    input_schema: {
      type: "object",
      properties: { target: { type: "string" }, body: { type: "string" } },
      required: ["target", "body"],
    },
  },
];

function kbToolsForMode(mode) {
  if (mode.kbTools === "*") return KB_RECORD_TOOLS;
  const allow = new Set(mode.kbTools);
  return KB_RECORD_TOOLS.filter((t) => allow.has(t.name));
}

function anthropicToolList(mode) {
  const mcp = [...toolRegistry.entries()].map(([name, info]) => ({
    name,
    description: (info.schema.description || info.mcpName).slice(0, 1024),
    input_schema: info.schema.inputSchema || { type: "object", properties: {} },
  }));
  return [...BUILTIN_TOOLS, ...KB_UNIVERSAL_TOOLS, ...kbToolsForMode(mode), ...mcp];
}

function toolInfoForClient() {
  const builtins = BUILTIN_TOOLS.map((t) => ({
    name: t.name,
    server: "builtin",
    description: t.description,
  }));
  const kb = [...KB_UNIVERSAL_TOOLS, ...KB_RECORD_TOOLS].map((t) => ({
    name: t.name,
    server: "knowledge-base",
    description: t.description,
  }));
  const mcp = [...toolRegistry.entries()].map(([name, info]) => ({
    name,
    server: info.server,
    description: info.schema.description || info.mcpName,
  }));
  return [...builtins, ...kb, ...mcp];
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------
function runCommand(command, timeoutSeconds = 120, signal) {
  return new Promise((resolve) => {
    // Support cwd persistence for a bare `cd`.
    const cdMatch = command.trim().match(/^cd\s+(.+)$/);
    if (cdMatch) {
      const target = path.resolve(sharedCwd, cdMatch[1].trim());
      if (existsSync(target) && statSync(target).isDirectory()) {
        sharedCwd = target;
        broadcastToTerminals(`\r\n\x1b[38;5;244m[agent] cd ${cdMatch[1].trim()}\x1b[0m\r\n`);
        resolve({ ok: true, output: `cwd is now ${sharedCwd}` });
      } else {
        resolve({ ok: false, output: `no such directory: ${cdMatch[1].trim()}` });
      }
      return;
    }
    broadcastToTerminals(`\r\n\x1b[38;5;42m[agent] $ ${command}\x1b[0m\r\n`);
    // Spawn detached so the shell leads its own process group. Killing the whole
    // group (negative pid) on stop/timeout takes down grandchildren too — nmap,
    // ffuf, sleep, etc. `exec` can't do this: it only kills the direct shell and
    // leaves the real tool running as an orphan.
    const MAX_OUT = 8 * 1024 * 1024;
    let out = "";
    let truncated = false;
    let timedOut = false;
    // Same SHELL_ENV as the interactive pty (see createPtySession) — if the
    // agent itself ever shells out to `claude`, it shouldn't inherit
    // IntelliRecon's own gateway/model config either.
    const child = spawn(SHELL, ["-c", command], { cwd: sharedCwd, detached: true, env: SHELL_ENV });
    const onData = (d) => {
      const s = d.toString();
      if (!truncated) {
        out += s;
        if (out.length > MAX_OUT) {
          out = out.slice(0, MAX_OUT);
          truncated = true;
        }
      }
      broadcastToTerminals(s.replace(/\n/g, "\r\n")); // live echo to the terminal
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutSeconds * 1000);
    const onAbort = () => killGroup();
    if (signal) {
      if (signal.aborted) killGroup();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const finish = (result) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    child.on("error", (err) => finish({ ok: false, output: out || String(err.message) }));
    child.on("close", (code) => {
      const body = out + (truncated ? "\n[output truncated]" : "");
      if (signal?.aborted) {
        broadcastToTerminals(`\r\n\x1b[38;5;208m[agent] stopped by operator\x1b[0m\r\n`);
        finish({ ok: false, output: (body ? body + "\n" : "") + "[stopped by operator]" });
      } else if (timedOut) {
        finish({ ok: false, output: body + `\n[timed out after ${timeoutSeconds}s]` });
      } else {
        finish({ ok: code === 0, output: body || "(no output)" });
      }
    });
  });
}

async function executeTool(name, input, onFinding, signal) {
  if (name === "run_command") {
    return runCommand(String(input.command || ""), Number(input.timeout_seconds) || 120, signal);
  }
  if (name === "report_finding") {
    onFinding?.({
      title: String(input.title || "Untitled"),
      severity: ["critical", "high", "medium", "low", "info"].includes(input.severity)
        ? input.severity
        : "info",
      target: input.target ? String(input.target) : undefined,
      detail: input.detail ? String(input.detail) : undefined,
    });
    return { ok: true, output: "recorded" };
  }
  if (name === "query_knowledge_base") {
    const summary = db.knowledgeBaseSummary(String(input.target || ""));
    return { ok: true, output: JSON.stringify(summary, null, 2) };
  }
  if (name === "add_note") {
    db.addKbNote({ target: String(input.target || ""), agent: input.agent ? String(input.agent) : undefined, body: String(input.body || "") });
    return { ok: true, output: "note added" };
  }
  if (name === "record_js_asset") {
    db.recordJsAsset({
      target: String(input.target || ""),
      url: String(input.url || ""),
      kind: input.kind ? String(input.kind) : undefined,
      notes: input.notes ? String(input.notes) : undefined,
    });
    return { ok: true, output: "recorded" };
  }
  if (name === "record_endpoint") {
    db.recordEndpoint({
      target: String(input.target || ""),
      method: String(input.method || "").toUpperCase(),
      path: String(input.path || ""),
      source: input.source ? String(input.source) : undefined,
      authRequired: input.auth_required ? String(input.auth_required) : undefined,
      paramsJson: input.params ? JSON.stringify(input.params) : undefined,
      headersJson: input.headers ? JSON.stringify(input.headers) : undefined,
      responsesJson: input.responses ? JSON.stringify(input.responses) : undefined,
      notes: input.notes ? String(input.notes) : undefined,
    });
    return { ok: true, output: "recorded" };
  }
  if (name === "record_role") {
    db.recordRole({
      target: String(input.target || ""),
      name: String(input.name || ""),
      level: Number.isFinite(input.level) ? input.level : undefined,
      description: input.description ? String(input.description) : undefined,
    });
    return { ok: true, output: "recorded" };
  }
  if (name === "record_role_access") {
    db.recordRoleAccess({
      target: String(input.target || ""),
      role: String(input.role || ""),
      endpoint: String(input.endpoint || ""),
      accessible: String(input.accessible || "unknown"),
      notes: input.notes ? String(input.notes) : undefined,
    });
    return { ok: true, output: "recorded" };
  }
  if (name === "record_token_config") {
    db.recordAuthToken({
      target: String(input.target || ""),
      kind: String(input.kind || ""),
      lifetime: input.lifetime ? String(input.lifetime) : undefined,
      rotation: input.rotation ? String(input.rotation) : undefined,
      algorithm: input.algorithm ? String(input.algorithm) : undefined,
      claimsJson: input.claims ? JSON.stringify(input.claims) : undefined,
      cookieFlagsJson: input.cookie_flags ? JSON.stringify(input.cookie_flags) : undefined,
      notes: input.notes ? String(input.notes) : undefined,
    });
    return { ok: true, output: "recorded" };
  }
  if (name === "record_business_flow") {
    db.recordBusinessFlow({
      target: String(input.target || ""),
      name: String(input.name || ""),
      stepsJson: Array.isArray(input.steps) ? JSON.stringify(input.steps) : undefined,
      verifiedServerSide: input.verified_server_side ? String(input.verified_server_side) : undefined,
      notes: input.notes ? String(input.notes) : undefined,
    });
    return { ok: true, output: "recorded" };
  }
  if (name === "record_third_party") {
    db.recordThirdParty({
      target: String(input.target || ""),
      name: String(input.name || ""),
      category: input.category ? String(input.category) : undefined,
      url: input.url ? String(input.url) : undefined,
      notes: input.notes ? String(input.notes) : undefined,
    });
    return { ok: true, output: "recorded" };
  }
  if (name === "record_client_observation") {
    db.recordClientObservation({
      target: String(input.target || ""),
      category: input.category ? String(input.category) : undefined,
      detail: String(input.detail || ""),
      url: input.url ? String(input.url) : undefined,
    });
    return { ok: true, output: "recorded" };
  }
  const info = toolRegistry.get(name);
  if (!info) return { ok: false, output: `unknown tool: ${name}` };
  try {
    const result = await info.client.callTool(
      { name: info.mcpName, arguments: input || {} },
      undefined,
      // Cap the wait, but let servers that emit progress notifications keep the
      // request alive past the base timeout (long crawls, brute-forcers, etc.).
      // `signal` forwards an operator "stop" as an MCP cancellation.
      { timeout: info.timeoutMs || MCP_CALL_TIMEOUT_MS, resetTimeoutOnProgress: true, signal },
    );
    const text = (result.content || [])
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
      .join("\n");
    return { ok: !result.isError, output: text || "(no output)" };
  } catch (e) {
    if (signal?.aborted) return { ok: false, output: "[stopped by operator]" };
    // MCP request-timeout (JSON-RPC -32001): the tool exceeded its ceiling. The
    // scan may still be running on the MCP server; guide the agent to bound it
    // rather than replay the same heavyweight call.
    const secs = Math.round((info.timeoutMs || MCP_CALL_TIMEOUT_MS) / 1000);
    if (e?.code === -32001 || /timed out/i.test(e?.message || "")) {
      return {
        ok: false,
        output:
          `[${info.mcpName} exceeded its ${secs}s time limit and was not awaited further] ` +
          `Do not simply retry the same call. Narrow the scope (e.g. a passive/faster mode, ` +
          `fewer sources, a smaller wordlist, or a shorter tool-level -timeout), or raise this ` +
          `tool's budget via "toolTimeouts" in mcp.config.json.`,
      };
    }
    return { ok: false, output: `MCP call failed: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Run persistence — mirror each turn's tool output + findings to disk under the
// shared cwd, so a Claude Code session started in the terminal tab can pick up
// exactly where the agent left off. Raw per-tool files are written live (with a
// pointer echoed to the terminal); a HANDOFF.md brief, run.json, and a merged
// subdomains.txt are written when the turn ends. All best-effort: a filesystem
// error is logged and never breaks the agent.
// ---------------------------------------------------------------------------
const RUNS_DIRNAME = "intellirecon-runs";

function slug(s, fallback = "run") {
  const out = String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return out || fallback;
}

// Best guess at a run's primary target from a tool input object.
function targetFromInput(input) {
  if (!input || typeof input !== "object") return null;
  for (const k of ["domain", "target", "host", "hostname", "url", "ip"]) {
    if (typeof input[k] === "string" && input[k].trim()) return input[k].trim();
  }
  return null;
}

// Pull apparent subdomains of `domain` out of arbitrary tool text.
function extractSubdomains(text, domain) {
  if (!domain) return [];
  const base = String(domain)
    .replace(/^https?:\/\//, "")
    .replace(/[:/].*$/, "")
    .replace(/^\*+\./, "");
  if (!base.includes(".")) return []; // not a domain (e.g. bare IP)
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\\.)+${esc}\\b`, "gi");
  const set = new Set();
  for (const m of String(text || "").matchAll(re)) set.add(m[0].toLowerCase());
  return [...set].sort();
}

// Pull every hostname-shaped string out of text, with no target domain to
// filter by. Used for CloudRecon output: its whole point is surfacing
// hostnames living on an IP that the operator didn't already know belonged to
// a domain, so the domain-suffix filter in extractSubdomains would exclude
// exactly the things it's meant to find.
function extractAllHostnames(text) {
  const re = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;
  const set = new Set();
  for (const m of String(text || "").matchAll(re)) set.add(m[0].toLowerCase());
  return [...set].sort();
}

function isCloudReconTool(t) {
  return t.name === "run_command" && /\bcloudrecon\b/i.test(t.input?.command || "");
}

function ensureRunDir(run) {
  if (run.dir) return run.dir;
  const target = slug(run.target || "run");
  const stamp = new Date(run.startedAt)
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const dir = path.join(sharedCwd, RUNS_DIRNAME, target, stamp);
  mkdirSync(dir, { recursive: true });
  run.dir = dir;
  run.relDir = path.relative(sharedCwd, dir);
  // Best-effort `latest` symlink per target so `cd .../latest && claude` works.
  try {
    const latest = path.join(sharedCwd, RUNS_DIRNAME, target, "latest");
    try { rmSync(latest, { force: true }); } catch { /* nothing to remove */ }
    symlinkSync(stamp, latest, "dir");
  } catch { /* symlinks may be unsupported on this fs — non-fatal */ }
  return dir;
}

// Write one tool's raw output as it finishes, and echo a pointer to the terminal.
function persistToolOutput(run, entry) {
  try {
    const dir = ensureRunDir(run);
    const fname = `${String(++run.seq).padStart(2, "0")}-${slug(entry.name, "tool")}.txt`;
    const header =
      `# ${entry.name} (${entry.server})\n` +
      `# input: ${JSON.stringify(entry.input)}\n` +
      `# ok: ${entry.ok}\n\n`;
    writeFileSync(path.join(dir, fname), header + (entry.output || ""));
    entry.file = fname;
    broadcastToTerminals(
      `\r\n\x1b[38;5;244m[agent] ${entry.name} → ${path.join(run.relDir, fname)}\x1b[0m\r\n`,
    );
  } catch (e) {
    console.warn("[intellirecon] run persist (tool) failed:", e.message);
  }
}

function renderHandoff(run, subList) {
  const L = [];
  L.push(`# IntelliRecon handoff — ${run.target || "recon run"}`);
  L.push("");
  L.push(`- **Request:** ${run.userText}`);
  L.push(`- **Target:** ${run.target || "(not detected)"}`);
  L.push(`- **When:** ${new Date(run.startedAt).toISOString()}`);
  L.push(
    `- **Tools run:** ${run.tools.length}  ·  **Findings:** ${run.findings.length}  ·  **Subdomains:** ${subList.length}`,
  );
  L.push("");
  L.push("## Tools");
  L.push("");
  for (const t of run.tools) {
    const dur = t.endedAt ? `${((t.endedAt - t.startedAt) / 1000).toFixed(1)}s` : "";
    L.push(`- \`${t.name}\` (${t.server}) — ${t.ok ? "ok" : "FAILED"} ${dur} → \`${t.file || "-"}\``);
  }
  L.push("");
  if (subList.length) {
    L.push(`## Subdomains (${subList.length})`);
    L.push("");
    L.push("Full list in `subdomains.txt`. Sample:");
    L.push("");
    L.push("```");
    L.push(subList.slice(0, 40).join("\n"));
    if (subList.length > 40) L.push(`… +${subList.length - 40} more`);
    L.push("```");
    L.push("");
  }
  if (run.findings.length) {
    L.push("## Findings");
    L.push("");
    for (const f of run.findings) {
      L.push(`- **[${f.severity}]** ${f.title}${f.target ? ` — \`${f.target}\`` : ""}`);
      if (f.detail) L.push(`  ${String(f.detail).replace(/\n/g, " ")}`);
    }
    L.push("");
  }
  L.push("## Start here (for Claude Code)");
  L.push("");
  L.push("You are picking up an IntelliRecon recon run. Raw tool output is in the");
  L.push("`NN-<tool>.txt` files, structured data in `run.json`, and merged subdomains in");
  L.push("`subdomains.txt`. Review them, then recommend concrete next steps:");
  L.push("");
  L.push("- Which discovered hosts are live and worth probing (resolve + HTTP status).");
  L.push("- Notable subdomains (dev/staging/admin/api/vpn/mail) and why they matter.");
  L.push("- Gaps in coverage and the next tool to run.");
  L.push("- Any finding worth verifying or escalating — and how.");
  L.push("");
  L.push("Only act within the authorized scope for this target.");
  L.push("");
  return L.join("\n") + "\n";
}

// Write the end-of-turn artifacts. Returns the run directory, or null if nothing ran.
function finalizeRun(run) {
  if (!run.tools.length) return null;
  try {
    const dir = ensureRunDir(run);
    const subs = new Set();
    for (const t of run.tools) {
      for (const s of extractSubdomains(t.output, run.target)) subs.add(s);
      if (isCloudReconTool(t)) for (const s of extractAllHostnames(t.output)) subs.add(s);
    }
    const subList = [...subs].sort();
    db.upsertSubdomains(run.target, subList);
    db.insertRun({
      id: run.id,
      target: run.target || null,
      request: run.userText,
      startedAt: run.startedAt,
      endedAt: Date.now(),
      dir: run.relDir,
    });
    if (subList.length) writeFileSync(path.join(dir, "subdomains.txt"), subList.join("\n") + "\n");
    if (run.findings.length) {
      writeFileSync(path.join(dir, "findings.json"), JSON.stringify(run.findings, null, 2) + "\n");
    }
    const runJson = {
      target: run.target || null,
      request: run.userText,
      startedAt: new Date(run.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      tools: run.tools.map((t) => ({
        name: t.name,
        server: t.server,
        ok: t.ok,
        input: t.input,
        file: t.file || null,
        ms: t.endedAt ? t.endedAt - t.startedAt : null,
      })),
      findings: run.findings,
      subdomains: subList,
    };
    writeFileSync(path.join(dir, "run.json"), JSON.stringify(runJson, null, 2) + "\n");
    writeFileSync(path.join(dir, "HANDOFF.md"), renderHandoff(run, subList));
    broadcastToTerminals(
      `\r\n\x1b[38;5;42m[agent] run saved → ${run.relDir}\x1b[0m\r\n` +
        `\x1b[38;5;244m         cd ${run.relDir} && claude   # continue from here\x1b[0m\r\n`,
    );
    return dir;
  } catch (e) {
    console.warn("[intellirecon] run finalize failed:", e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The Claude agent loop (one per /agent socket)
// ---------------------------------------------------------------------------
// When an auth token is present (gateway/Bearer mode, e.g. OpenRouter), use it
// exclusively and pass apiKey: null so the SDK does NOT also send an x-api-key
// header. A stray ANTHROPIC_API_KEY left in the shell env would otherwise ride
// along and make gateways misroute to the wrong upstream provider.
function makeAnthropic() {
  if (!HAS_KEY) return null;
  const baseURL = process.env.ANTHROPIC_BASE_URL || undefined;
  if (process.env.ANTHROPIC_AUTH_TOKEN) {
    return new Anthropic({ authToken: process.env.ANTHROPIC_AUTH_TOKEN, apiKey: null, baseURL });
  }
  return new Anthropic({ baseURL });
}
const anthropic = makeAnthropic();

const SYSTEM_PROMPT = `You are IntelliRecon, an autonomous reconnaissance and security-assessment agent operating inside the operator's browser console. You have a live shell (run_command) and any connected MCP security tools.

Operating principles:
- The operator runs you for authorized security testing, bug bounty, and CTF work. Assume you have permission for the targets they give you; if a target looks like it may be out of scope or third-party, say so before acting.
- Work the methodology: scope, enumerate, probe, verify. Prefer connected MCP tools when available; fall back to run_command for standard CLI tools.
- Parallelize independent work: when several tools don't depend on each other's output (e.g. subfinder + amass + dnsenum on the same domain, or scanning several hosts), emit them as multiple tool calls in ONE turn — they run concurrently. Only serialize a step when it genuinely needs a previous result. Keep commands non-interactive (no prompts, no pagers).
- To find hostnames from IPs/CIDRs (cloud ranges, ASN blocks, pivoting off a known IP) instead of DNS-based enumeration, use CloudRecon via run_command: \`CloudRecon scrape -i <ips-or-cidrs> -p 443,8443\` prints the CNs/SANs off certs served on those hosts straight to stdout, good for a handful of IPs (\`-i\` takes comma-separated IPs/CIDRs or a file path). For bigger ranges, \`CloudRecon store -i <file-or-cidrs> -db <db>\` persists Org/CN/SAN into a local db, then \`CloudRecon retr -db <db> -san <keyword>\` (or \`-cn\`/\`-org\`/\`-ip\`, \`-all\` for everything) queries it later without rescanning. This surfaces hostnames sharing infrastructure — dev/staging boxes, other domains parked on the same IP — that subfinder/amass won't find since they never touch DNS.
- Long enumerations (amass, deep recon, brute-forcers) can legitimately take many minutes. That is expected — do not abandon or duplicate a scan just because it is slow; let it finish and work on other independent tasks meanwhile. If a tool reports it exceeded its time limit, narrow its scope rather than replaying the same heavy call.
- When you confirm something real with evidence, call report_finding. Do not report guesses.
- Be concise in chat: say what you're doing and what you found, not a wall of raw output (the operator sees the terminal and tool feed already).
- Lead with the outcome. When a task is done, summarize what you found and the suggested next step.`;

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

async function runAgentTurn(ws, session, userText) {
  session.messages.push({ role: "user", content: userText });
  session.aborted = false;
  send(ws, { type: "status", state: "thinking" });

  const mode = getMode(session.mode);
  const tools = anthropicToolList(mode);
  const system = mode.briefing ? `${SYSTEM_PROMPT}\n\n---\n\n${mode.briefing}` : SYSTEM_PROMPT;

  // Accumulates this turn's tool output + findings, mirrored to disk (see
  // finalizeRun) so the terminal-side Claude Code can continue from the results.
  const run = {
    id: randomUUID(),
    startedAt: Date.now(),
    userText,
    target: null,
    tools: [],
    findings: [],
    seq: 0,
    dir: null,
  };
  // Write the runs row up front. findings.run_id is a foreign key to
  // runs.id, and report_finding can fire mid-turn — long before finalizeRun
  // would otherwise write this row — so without this every finding insert
  // fails its FK check. finalizeRun's upsert later fills in target/endedAt/dir.
  db.insertRun({ id: run.id, target: run.target, request: run.userText, startedAt: run.startedAt, endedAt: null, dir: run.dir });

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (session.aborted) break;
    let final;
    try {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        system,
        messages: session.messages,
        tools,
      });
      stream.on("text", (t) => send(ws, { type: "assistant_delta", text: t }));
      final = await stream.finalMessage();
    } catch (e) {
      send(ws, { type: "error", message: `Model error: ${e.message}` });
      break;
    }
    send(ws, { type: "assistant_done" });
    session.messages.push({ role: "assistant", content: final.content });

    if (session.aborted) break;

    const toolUses = final.content.filter((b) => b.type === "tool_use");
    if (final.stop_reason !== "tool_use" || toolUses.length === 0) break;

    // Fix the run's target (and thus its directory name) from the first tool
    // input that carries one, before any output is written.
    if (!run.target) {
      for (const tu of toolUses) {
        const t = targetFromInput(tu.input);
        if (t) { run.target = t; break; }
      }
    }

    // Run every tool_use in this turn concurrently. When the model batches
    // independent scans into one turn (subfinder + amass + dnsenum + …), they
    // overlap instead of running back-to-back — long enumerations no longer
    // block quicker ones. Each call keeps its own AbortController in
    // session.inflight, so global Stop and per-tool stop both still work.
    send(ws, {
      type: "status",
      state: "running",
      label: toolUses.length > 1 ? `${toolUses.length} tools` : toolUses[0].name,
    });
    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const server = toolRegistry.get(tu.name)?.server || "builtin";
        send(ws, { type: "tool_call", id: tu.id, name: tu.name, server, input: tu.input });
        const controller = new AbortController();
        if (session.aborted) controller.abort();
        session.inflight.set(tu.id, controller);
        const startedAt = Date.now();
        const { ok, output } = await executeTool(
          tu.name,
          tu.input,
          (f) => {
            const finding = { id: randomUUID(), at: Date.now(), runId: run.id, ...f };
            run.findings.push(finding);
            db.insertFinding(finding);
            send(ws, { type: "finding", finding });
          },
          controller.signal,
        );
        session.inflight.delete(tu.id);
        send(ws, { type: "tool_result", id: tu.id, name: tu.name, ok, output });
        // Mirror this tool's raw output to the run directory as it completes.
        const entry = { id: tu.id, name: tu.name, server, input: tu.input, ok, output, startedAt, endedAt: Date.now() };
        run.tools.push(entry);
        persistToolOutput(run, entry);
        return {
          type: "tool_result",
          tool_use_id: tu.id,
          content: (output || "").slice(0, 60000),
          is_error: !ok,
        };
      }),
    );
    session.messages.push({ role: "user", content: results });
    if (session.aborted) break;
    send(ws, { type: "status", state: "thinking" });
  }

  finalizeRun(run); // write HANDOFF.md / run.json / subdomains.txt for this turn
  send(ws, { type: "status", state: "idle" });
}

// ---------------------------------------------------------------------------
// HTTP + static file serving (prod). In dev, Vite owns the SPA.
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const httpServer = http.createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, model: MODEL, hasKey: HAS_KEY, tools: toolRegistry.size }));
    return;
  }
  if (req.url === "/api/pty-sessions") {
    res.writeHead(200, { "content-type": "application/json" });
    const sessions = [...ptySessions.values()].map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt }));
    res.end(JSON.stringify({ sessions }));
    return;
  }
  // Durable, queryable recon data (see db.mjs) — findings/runs/subdomains
  // outlive a browser refresh or a cleared localStorage.
  const { pathname, searchParams } = new URL(req.url, "http://localhost");
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (pathname === "/api/findings" && req.method === "GET") {
    return json(200, { findings: db.listFindings() });
  }
  if (pathname === "/api/findings" && req.method === "DELETE") {
    db.clearFindings();
    return json(200, { ok: true });
  }
  const findingMatch = pathname.match(/^\/api\/findings\/([^/]+)$/);
  if (findingMatch && req.method === "DELETE") {
    db.deleteFinding(decodeURIComponent(findingMatch[1]));
    return json(200, { ok: true });
  }
  if (pathname === "/api/runs" && req.method === "GET") {
    return json(200, { runs: db.listRuns() });
  }
  if (pathname === "/api/subdomains" && req.method === "GET") {
    return json(200, { subdomains: db.listSubdomains(searchParams.get("target") || "") });
  }
  if (pathname === "/api/kb/targets" && req.method === "GET") {
    return json(200, { targets: db.listKbTargets() });
  }
  if (pathname === "/api/kb" && req.method === "GET") {
    const target = searchParams.get("target") || "";
    if (!target) return json(400, { error: "target is required" });
    return json(200, db.knowledgeBaseSummary(target));
  }
  if (pathname === "/api/agent-modes" && req.method === "GET") {
    return json(200, { modes: modesForClient() });
  }
  // Static assets from dist (prod build). SPA fallback to index.html.
  if (!existsSync(DIST)) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>IntelliRecon backend running</h1><p>Run <code>npm run dev</code> for the UI, or <code>npm run serve</code> for a production build.</p>");
    return;
  }
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let filePath = path.join(DIST, urlPath);
  if (!filePath.startsWith(DIST)) filePath = path.join(DIST, "index.html"); // traversal guard
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, "index.html");
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(filePath));
});

// ---------------------------------------------------------------------------
// WebSocket routing: /pty (terminal) and /agent (Claude)
// ---------------------------------------------------------------------------
const ptyWss = new WebSocketServer({ noServer: true });
const agentWss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/pty") {
    ptyWss.handleUpgrade(req, socket, head, (ws) => ptyWss.emit("connection", ws, req));
  } else if (pathname === "/agent") {
    agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

ptyWss.on("connection", (ws, req) => {
  const { searchParams } = new URL(req.url, "http://localhost");
  const id = searchParams.get("session") || randomUUID();
  const title = searchParams.get("title") || undefined;

  const isAgentLog = id === AGENT_LOG_SESSION_ID;
  const attaching = ptySessions.has(id);
  const session = isAgentLog ? ensureAgentLogSession() : attaching ? ptySessions.get(id) : createPtySession(id, title);
  if (!isAgentLog && attaching && title) session.title = title;

  session.clients.add(ws);

  if (session.readOnly) {
    if (session.buffer) ws.send(session.buffer); // replay whatever the agent has logged so far
  } else if (!session.term) {
    ws.send("IntelliRecon terminal (fallback line mode — node-pty not built).\r\n$ ");
  } else if (attaching && session.buffer) {
    ws.send(session.buffer); // replay scrollback so a (re)attaching client sees history
  }

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.close) {
      if (!session.readOnly) {
        session.term?.kill();
        closePtySession(id);
      }
      return;
    }
    if (msg.i !== undefined) {
      if (session.readOnly) return; // log only — no shell behind it to send keystrokes to
      if (session.term) session.term.write(msg.i);
      else if (msg.i === "\r") ws.send("\r\n(fallback mode: use the agent's run_command)\r\n$ ");
    } else if (Array.isArray(msg.r) && session.term) {
      try {
        session.term.resize(msg.r[0], msg.r[1]);
      } catch {
        /* ignore */
      }
    }
  });

  ws.on("close", () => {
    session.clients.delete(ws);
    // The session (and its shell) is intentionally left running with zero
    // clients — see the PTY sessions comment above. Only {close:true} or the
    // shell process exiting removes it.
  });
});

agentWss.on("connection", (ws) => {
  const session = { messages: [], aborted: false, inflight: new Map(), mode: DEFAULT_MODE };
  ws.session = session; // so refreshAgentClients() can report this connection's current mode
  send(ws, {
    type: "ready",
    tools: toolInfoForClient(),
    model: MODEL,
    hasKey: HAS_KEY,
    modes: modesForClient(),
    mode: session.mode,
  });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "stop") {
      session.aborted = true;
      for (const c of session.inflight.values()) c.abort();
      session.inflight.clear();
      send(ws, { type: "status", state: "idle" });
      return;
    }
    if (msg.type === "stop_tool") {
      // Stop a single in-flight tool call, leaving the rest of the turn running.
      session.inflight.get(String(msg.id))?.abort();
      return;
    }
    if (msg.type === "set_mode") {
      const mode = AGENT_MODES.find((m) => m.id === msg.mode);
      if (mode) {
        session.mode = mode.id;
        send(ws, { type: "mode_set", mode: mode.id });
      }
      return;
    }
    if (msg.type === "user") {
      if (!anthropic) {
        send(ws, { type: "error", message: "ANTHROPIC_API_KEY is not set on the backend." });
        return;
      }
      try {
        await runAgentTurn(ws, session, String(msg.text || ""));
      } catch (e) {
        send(ws, { type: "error", message: e.message });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Boot — listen FIRST so the browser's WS reconnects and /api/health probes
// connect immediately, then wire up MCP servers in the background. Blocking the
// listen on MCP startup (which can take several seconds) is what made Vite's WS
// proxy spam ECONNREFUSED against a not-yet-listening backend during `npm run dev`.
// ---------------------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log(`\n  IntelliRecon backend on http://localhost:${PORT}`);
  const via = process.env.ANTHROPIC_BASE_URL ? `  endpoint: ${process.env.ANTHROPIC_BASE_URL}` : "";
  console.log(`  model: ${MODEL}   auth: ${HAS_KEY ? "set" : "MISSING"}${via}`);
  console.log("  connecting MCP servers…");
  console.log(existsSync(DIST) ? "  serving built UI from dist/" : "  UI: run `npm run dev` (Vite) in another terminal\n");
});

connectMcpServers().then(() => {
  console.log(`  MCP tools ready: ${toolRegistry.size}`);
  refreshAgentClients();
});

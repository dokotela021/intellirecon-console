// Durable, queryable storage for IntelliRecon — a single SQLite file, owned
// by this backend process. It sits alongside (not instead of) the per-run
// archive in intellirecon-runs/: the archive is the full raw record of one
// turn for a human or Claude Code to read; this DB is the queryable index
// across every run — findings, run history, and every subdomain ever seen
// per target — that survives a browser refresh, a cleared localStorage, or
// a different browser entirely.
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.INTELLIRECON_DB || path.join(ROOT, "intellirecon.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    target TEXT,
    request TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    dir TEXT
  );

  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id),
    title TEXT NOT NULL,
    severity TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_findings_created_at ON findings(created_at);

  CREATE TABLE IF NOT EXISTS subdomains (
    target TEXT NOT NULL,
    hostname TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    PRIMARY KEY (target, hostname)
  );

  -- Knowledge base: the durable, cross-agent memory the 9 recon agent modes
  -- read and write so later runs build on earlier ones instead of redoing
  -- reconnaissance. Every table is keyed by "target" (the same free-text host
  -- used elsewhere in this file) so a mode switch mid-investigation still sees
  -- what other modes already found.

  CREATE TABLE IF NOT EXISTS js_assets (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    url TEXT NOT NULL,
    kind TEXT,
    notes TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    UNIQUE(target, url)
  );

  CREATE TABLE IF NOT EXISTS endpoints (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    source TEXT,
    auth_required TEXT,
    params_json TEXT,
    headers_json TEXT,
    responses_json TEXT,
    notes TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    UNIQUE(target, method, path)
  );

  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    name TEXT NOT NULL,
    level INTEGER,
    description TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(target, name)
  );

  CREATE TABLE IF NOT EXISTS role_access (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    role TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    accessible TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(target, role, endpoint)
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    kind TEXT NOT NULL,
    lifetime TEXT,
    rotation TEXT,
    algorithm TEXT,
    claims_json TEXT,
    cookie_flags_json TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(target, kind)
  );

  CREATE TABLE IF NOT EXISTS business_flows (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    name TEXT NOT NULL,
    steps_json TEXT,
    verified_server_side TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(target, name)
  );

  CREATE TABLE IF NOT EXISTS third_parties (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    url TEXT,
    notes TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(target, name)
  );

  CREATE TABLE IF NOT EXISTS client_observations (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    category TEXT,
    detail TEXT NOT NULL,
    url TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kb_notes (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    agent TEXT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const stmts = {
  upsertRun: db.prepare(`
    INSERT INTO runs (id, target, request, started_at, ended_at, dir)
    VALUES (@id, @target, @request, @startedAt, @endedAt, @dir)
    ON CONFLICT(id) DO UPDATE SET target = excluded.target, ended_at = excluded.ended_at, dir = excluded.dir
  `),
  listRuns: db.prepare(`
    SELECT r.id, r.target, r.request, r.started_at AS startedAt, r.ended_at AS endedAt, r.dir,
           COUNT(f.id) AS findingsCount
    FROM runs r LEFT JOIN findings f ON f.run_id = r.id
    GROUP BY r.id ORDER BY r.started_at DESC LIMIT 200
  `),
  insertFinding: db.prepare(`
    INSERT INTO findings (id, run_id, title, severity, target, detail, created_at)
    VALUES (@id, @runId, @title, @severity, @target, @detail, @at)
  `),
  listFindings: db.prepare(`
    SELECT id, run_id AS runId, title, severity, target, detail, created_at AS at
    FROM findings ORDER BY created_at DESC LIMIT 1000
  `),
  deleteFinding: db.prepare(`DELETE FROM findings WHERE id = ?`),
  clearFindings: db.prepare(`DELETE FROM findings`),
  upsertSubdomain: db.prepare(`
    INSERT INTO subdomains (target, hostname, first_seen, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(target, hostname) DO UPDATE SET last_seen = excluded.last_seen
  `),
  listSubdomains: db.prepare(`
    SELECT hostname, first_seen AS firstSeen, last_seen AS lastSeen
    FROM subdomains WHERE target = ? ORDER BY hostname
  `),

  upsertJsAsset: db.prepare(`
    INSERT INTO js_assets (id, target, url, kind, notes, first_seen, last_seen)
    VALUES (@id, @target, @url, @kind, @notes, @at, @at)
    ON CONFLICT(target, url) DO UPDATE SET
      kind = excluded.kind, notes = COALESCE(excluded.notes, js_assets.notes), last_seen = excluded.last_seen
  `),
  listJsAssets: db.prepare(`
    SELECT id, url, kind, notes, first_seen AS firstSeen, last_seen AS lastSeen
    FROM js_assets WHERE target = ? ORDER BY last_seen DESC
  `),

  upsertEndpoint: db.prepare(`
    INSERT INTO endpoints (id, target, method, path, source, auth_required, params_json, headers_json, responses_json, notes, first_seen, last_seen)
    VALUES (@id, @target, @method, @path, @source, @authRequired, @paramsJson, @headersJson, @responsesJson, @notes, @at, @at)
    ON CONFLICT(target, method, path) DO UPDATE SET
      source = COALESCE(excluded.source, endpoints.source),
      auth_required = COALESCE(excluded.auth_required, endpoints.auth_required),
      params_json = COALESCE(excluded.params_json, endpoints.params_json),
      headers_json = COALESCE(excluded.headers_json, endpoints.headers_json),
      responses_json = COALESCE(excluded.responses_json, endpoints.responses_json),
      notes = COALESCE(excluded.notes, endpoints.notes),
      last_seen = excluded.last_seen
  `),
  listEndpoints: db.prepare(`
    SELECT id, method, path, source, auth_required AS authRequired, params_json AS paramsJson,
           headers_json AS headersJson, responses_json AS responsesJson, notes,
           first_seen AS firstSeen, last_seen AS lastSeen
    FROM endpoints WHERE target = ? ORDER BY path, method
  `),

  upsertRole: db.prepare(`
    INSERT INTO roles (id, target, name, level, description, created_at)
    VALUES (@id, @target, @name, @level, @description, @at)
    ON CONFLICT(target, name) DO UPDATE SET
      level = COALESCE(excluded.level, roles.level), description = COALESCE(excluded.description, roles.description)
  `),
  listRoles: db.prepare(`
    SELECT id, name, level, description, created_at AS at FROM roles WHERE target = ? ORDER BY level, name
  `),

  upsertRoleAccess: db.prepare(`
    INSERT INTO role_access (id, target, role, endpoint, accessible, notes, created_at)
    VALUES (@id, @target, @role, @endpoint, @accessible, @notes, @at)
    ON CONFLICT(target, role, endpoint) DO UPDATE SET
      accessible = excluded.accessible, notes = COALESCE(excluded.notes, role_access.notes)
  `),
  listRoleAccess: db.prepare(`
    SELECT id, role, endpoint, accessible, notes, created_at AS at FROM role_access WHERE target = ? ORDER BY endpoint, role
  `),

  upsertAuthToken: db.prepare(`
    INSERT INTO auth_tokens (id, target, kind, lifetime, rotation, algorithm, claims_json, cookie_flags_json, notes, created_at, updated_at)
    VALUES (@id, @target, @kind, @lifetime, @rotation, @algorithm, @claimsJson, @cookieFlagsJson, @notes, @at, @at)
    ON CONFLICT(target, kind) DO UPDATE SET
      lifetime = COALESCE(excluded.lifetime, auth_tokens.lifetime),
      rotation = COALESCE(excluded.rotation, auth_tokens.rotation),
      algorithm = COALESCE(excluded.algorithm, auth_tokens.algorithm),
      claims_json = COALESCE(excluded.claims_json, auth_tokens.claims_json),
      cookie_flags_json = COALESCE(excluded.cookie_flags_json, auth_tokens.cookie_flags_json),
      notes = COALESCE(excluded.notes, auth_tokens.notes),
      updated_at = excluded.updated_at
  `),
  listAuthTokens: db.prepare(`
    SELECT id, kind, lifetime, rotation, algorithm, claims_json AS claimsJson, cookie_flags_json AS cookieFlagsJson,
           notes, created_at AS createdAt, updated_at AS updatedAt
    FROM auth_tokens WHERE target = ? ORDER BY kind
  `),

  upsertBusinessFlow: db.prepare(`
    INSERT INTO business_flows (id, target, name, steps_json, verified_server_side, notes, created_at, updated_at)
    VALUES (@id, @target, @name, @stepsJson, @verifiedServerSide, @notes, @at, @at)
    ON CONFLICT(target, name) DO UPDATE SET
      steps_json = COALESCE(excluded.steps_json, business_flows.steps_json),
      verified_server_side = COALESCE(excluded.verified_server_side, business_flows.verified_server_side),
      notes = COALESCE(excluded.notes, business_flows.notes),
      updated_at = excluded.updated_at
  `),
  listBusinessFlows: db.prepare(`
    SELECT id, name, steps_json AS stepsJson, verified_server_side AS verifiedServerSide, notes,
           created_at AS createdAt, updated_at AS updatedAt
    FROM business_flows WHERE target = ? ORDER BY name
  `),

  upsertThirdParty: db.prepare(`
    INSERT INTO third_parties (id, target, name, category, url, notes, created_at)
    VALUES (@id, @target, @name, @category, @url, @notes, @at)
    ON CONFLICT(target, name) DO UPDATE SET
      category = COALESCE(excluded.category, third_parties.category),
      url = COALESCE(excluded.url, third_parties.url),
      notes = COALESCE(excluded.notes, third_parties.notes)
  `),
  listThirdParties: db.prepare(`
    SELECT id, name, category, url, notes, created_at AS at FROM third_parties WHERE target = ? ORDER BY category, name
  `),

  insertClientObservation: db.prepare(`
    INSERT INTO client_observations (id, target, category, detail, url, created_at)
    VALUES (@id, @target, @category, @detail, @url, @at)
  `),
  listClientObservations: db.prepare(`
    SELECT id, category, detail, url, created_at AS at FROM client_observations WHERE target = ? ORDER BY created_at DESC
  `),

  insertKbNote: db.prepare(`
    INSERT INTO kb_notes (id, target, agent, body, created_at)
    VALUES (@id, @target, @agent, @body, @at)
  `),
  listKbNotes: db.prepare(`
    SELECT id, agent, body, created_at AS at FROM kb_notes WHERE target = ? ORDER BY created_at DESC
  `),

  kbTargets: db.prepare(`
    SELECT target FROM js_assets
    UNION SELECT target FROM endpoints
    UNION SELECT target FROM roles
    UNION SELECT target FROM auth_tokens
    UNION SELECT target FROM business_flows
    UNION SELECT target FROM third_parties
    UNION SELECT target FROM client_observations
    UNION SELECT target FROM kb_notes
    ORDER BY target
  `),
};

// better-sqlite3 rejects binding `undefined` (only `null` is allowed for a
// missing value), but optional fields like Finding.target/detail are
// frequently undefined rather than explicitly null.
function nullifyUndefined(obj) {
  const out = {};
  for (const k in obj) out[k] = obj[k] === undefined ? null : obj[k];
  return out;
}

export function insertRun(run) {
  stmts.upsertRun.run(nullifyUndefined(run));
}

export function listRuns() {
  return stmts.listRuns.all();
}

export function insertFinding(finding) {
  stmts.insertFinding.run(nullifyUndefined(finding));
}

export function listFindings() {
  return stmts.listFindings.all();
}

export function deleteFinding(id) {
  stmts.deleteFinding.run(id);
}

export function clearFindings() {
  stmts.clearFindings.run();
}

export function upsertSubdomains(target, hostnames) {
  if (!target || !hostnames.length) return;
  const now = Date.now();
  const tx = db.transaction((rows) => {
    for (const h of rows) stmts.upsertSubdomain.run(target, h, now, now);
  });
  tx(hostnames);
}

export function listSubdomains(target) {
  return stmts.listSubdomains.all(target);
}

// --- Knowledge base -------------------------------------------------------
// Every recordX/upsertX below stamps `id` and `at` itself so callers (the
// agent tool handlers in server.mjs) only need to pass the business fields.

// better-sqlite3 throws "Missing named parameter" if a @placeholder's key is
// absent from the bound object at all (not just undefined) — so every
// recordX below explicitly lists its optional fields (object-literal
// shorthand always creates the key, even when the value is undefined) rather
// than spreading an arbitrary caller-supplied row.

export function recordJsAsset({ target, url, kind, notes }) {
  stmts.upsertJsAsset.run(nullifyUndefined({ id: randomUUID(), at: Date.now(), target, url, kind, notes }));
}
export function listJsAssets(target) {
  return stmts.listJsAssets.all(target);
}

export function recordEndpoint({ target, method, path, source, authRequired, paramsJson, headersJson, responsesJson, notes }) {
  stmts.upsertEndpoint.run(
    nullifyUndefined({ id: randomUUID(), at: Date.now(), target, method, path, source, authRequired, paramsJson, headersJson, responsesJson, notes }),
  );
}
export function listEndpoints(target) {
  return stmts.listEndpoints.all(target);
}

export function recordRole({ target, name, level, description }) {
  stmts.upsertRole.run(nullifyUndefined({ id: randomUUID(), at: Date.now(), target, name, level, description }));
}
export function listRoles(target) {
  return stmts.listRoles.all(target);
}

export function recordRoleAccess({ target, role, endpoint, accessible, notes }) {
  stmts.upsertRoleAccess.run(nullifyUndefined({ id: randomUUID(), at: Date.now(), target, role, endpoint, accessible, notes }));
}
export function listRoleAccess(target) {
  return stmts.listRoleAccess.all(target);
}

export function recordAuthToken({ target, kind, lifetime, rotation, algorithm, claimsJson, cookieFlagsJson, notes }) {
  stmts.upsertAuthToken.run(
    nullifyUndefined({ id: randomUUID(), at: Date.now(), target, kind, lifetime, rotation, algorithm, claimsJson, cookieFlagsJson, notes }),
  );
}
export function listAuthTokens(target) {
  return stmts.listAuthTokens.all(target);
}

export function recordBusinessFlow({ target, name, stepsJson, verifiedServerSide, notes }) {
  stmts.upsertBusinessFlow.run(
    nullifyUndefined({ id: randomUUID(), at: Date.now(), target, name, stepsJson, verifiedServerSide, notes }),
  );
}
export function listBusinessFlows(target) {
  return stmts.listBusinessFlows.all(target);
}

export function recordThirdParty({ target, name, category, url, notes }) {
  stmts.upsertThirdParty.run(nullifyUndefined({ id: randomUUID(), at: Date.now(), target, name, category, url, notes }));
}
export function listThirdParties(target) {
  return stmts.listThirdParties.all(target);
}

export function recordClientObservation({ target, category, detail, url }) {
  stmts.insertClientObservation.run(nullifyUndefined({ id: randomUUID(), at: Date.now(), target, category, detail, url }));
}
export function listClientObservations(target) {
  return stmts.listClientObservations.all(target);
}

export function addKbNote({ target, agent, body }) {
  stmts.insertKbNote.run(nullifyUndefined({ id: randomUUID(), at: Date.now(), target, agent, body }));
}
export function listKbNotes(target) {
  return stmts.listKbNotes.all(target);
}

export function listKbTargets() {
  return stmts.kbTargets.all().map((r) => r.target);
}

// Everything known about one target, across every KB table — what the
// query_knowledge_base agent tool and the GET /api/kb endpoint both return.
export function knowledgeBaseSummary(target) {
  return {
    target,
    jsAssets: listJsAssets(target),
    endpoints: listEndpoints(target),
    roles: listRoles(target),
    roleAccess: listRoleAccess(target),
    authTokens: listAuthTokens(target),
    businessFlows: listBusinessFlows(target),
    thirdParties: listThirdParties(target),
    clientObservations: listClientObservations(target),
    notes: listKbNotes(target),
  };
}

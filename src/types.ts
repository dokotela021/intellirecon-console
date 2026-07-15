// Shared wire types between the browser and the thin backend.

export interface ToolInfo {
  name: string;
  server: string;
  description: string;
}

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  streaming?: boolean;
}

export interface ToolEvent {
  id: string;
  name: string;
  server: string;
  input: unknown;
  status: "running" | "ok" | "error";
  output?: string;
  startedAt: number;
  endedAt?: number;
}

export interface Finding {
  id: string;
  runId?: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  target?: string;
  detail?: string;
  at: number;
}

// One of the 9 specialized recon lenses (server/agents.mjs) the single agent
// loop can be switched into — a system-prompt briefing + curated KB tools,
// not a separate process.
export interface AgentMode {
  id: string;
  label: string;
  summary: string;
}

// server -> client on the /agent socket
export type AgentServerMsg =
  | { type: "ready"; tools: ToolInfo[]; model: string; hasKey: boolean; modes: AgentMode[]; mode: string }
  | { type: "mode_set"; mode: string }
  | { type: "status"; state: "idle" | "thinking" | "running"; label?: string }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_done" }
  | { type: "tool_call"; id: string; name: string; server: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; output: string }
  | { type: "finding"; finding: Finding }
  | { type: "error"; message: string };

// client -> server on the /agent socket
export type AgentClientMsg =
  | { type: "user"; text: string }
  | { type: "stop" }
  | { type: "stop_tool"; id: string }
  | { type: "set_mode"; mode: string };

// --- Knowledge base (GET /api/kb?target=...) --------------------------------

export interface JsAsset {
  id: string;
  url: string;
  kind?: string;
  notes?: string;
  firstSeen: number;
  lastSeen: number;
}

export interface KbEndpoint {
  id: string;
  method: string;
  path: string;
  source?: string;
  authRequired?: string;
  paramsJson?: string;
  headersJson?: string;
  responsesJson?: string;
  notes?: string;
  firstSeen: number;
  lastSeen: number;
}

export interface KbRole {
  id: string;
  name: string;
  level?: number;
  description?: string;
  at: number;
}

export interface KbRoleAccess {
  id: string;
  role: string;
  endpoint: string;
  accessible?: string;
  notes?: string;
  at: number;
}

export interface KbAuthToken {
  id: string;
  kind: string;
  lifetime?: string;
  rotation?: string;
  algorithm?: string;
  claimsJson?: string;
  cookieFlagsJson?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KbBusinessFlow {
  id: string;
  name: string;
  stepsJson?: string;
  verifiedServerSide?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KbThirdParty {
  id: string;
  name: string;
  category?: string;
  url?: string;
  notes?: string;
  at: number;
}

export interface KbClientObservation {
  id: string;
  category?: string;
  detail: string;
  url?: string;
  at: number;
}

export interface KbNote {
  id: string;
  agent?: string;
  body: string;
  at: number;
}

export interface KnowledgeBase {
  target: string;
  jsAssets: JsAsset[];
  endpoints: KbEndpoint[];
  roles: KbRole[];
  roleAccess: KbRoleAccess[];
  authTokens: KbAuthToken[];
  businessFlows: KbBusinessFlow[];
  thirdParties: KbThirdParty[];
  clientObservations: KbClientObservation[];
  notes: KbNote[];
}

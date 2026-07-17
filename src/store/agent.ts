import { create } from "zustand";
import { wsUrl } from "@/lib/utils";
import type {
  AgentMode,
  AgentServerMsg,
  ChatMessage,
  Finding,
  ToolEvent,
  ToolInfo,
} from "@/types";

type ConnState = "connecting" | "open" | "closed";

interface AgentStore {
  conn: ConnState;
  status: "idle" | "thinking" | "running";
  statusLabel?: string;
  model: string;
  models: string[];
  hasKey: boolean;
  tools: ToolInfo[];
  modes: AgentMode[];
  mode: string;
  messages: ChatMessage[];
  toolEvents: ToolEvent[];
  findings: Finding[];
  connect: () => void;
  disconnect: () => void;
  loadFindings: () => void;
  send: (text: string) => void;
  setMode: (mode: string) => void;
  setModel: (model: string) => void;
  stop: () => void;
  stopTool: (id: string) => void;
  removeToolEvent: (id: string) => void;
  clearToolEvents: () => void;
  clear: () => void;
  clearFindings: () => void;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const uid = () => Math.random().toString(36).slice(2, 10);

// Findings are the tool's durable output — persisted server-side in SQLite
// (server/db.mjs), not the browser, so they survive a page reload, a cleared
// localStorage, or opening the app from a different browser. Chat messages
// and tool events are deliberately NOT persisted: the backend agent session
// is in-memory per socket, so restoring a transcript would imply context the
// agent no longer has after a reconnect.
export const useAgent = create<AgentStore>((set, get) => ({
  conn: "closed",
  status: "idle",
  model: "",
  models: [],
  hasKey: false,
  tools: [],
  modes: [],
  mode: "general",
  messages: [],
  toolEvents: [],
  findings: [],

  loadFindings: () => {
    fetch("/api/findings")
      .then((r) => r.json())
      .then((data) => set({ findings: data.findings ?? [] }))
      .catch(() => {
        /* backend unreachable — findings stay empty until it's up */
      });
  },

  connect: () => {
    if (socket && socket.readyState <= 1) return;
    set({ conn: "connecting" });
    const ws = new WebSocket(wsUrl("/agent"));
    socket = ws;

    ws.onopen = () => set({ conn: "open" });
    ws.onclose = () => {
      set({ conn: "closed", status: "idle" });
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => get().connect(), 2000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (ev) => {
      let msg: AgentServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready":
          set({
            tools: msg.tools,
            model: msg.model,
            models: msg.models,
            hasKey: msg.hasKey,
            modes: msg.modes,
            mode: msg.mode,
          });
          break;
        case "mode_set":
          set({ mode: msg.mode });
          break;
        case "model_set":
          set({ model: msg.model });
          break;
        case "status":
          set({ status: msg.state, statusLabel: msg.label });
          break;
        case "assistant_delta": {
          const msgs = get().messages.slice();
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            msgs[msgs.length - 1] = { ...last, text: last.text + msg.text };
          } else {
            msgs.push({ id: uid(), role: "assistant", text: msg.text, streaming: true });
          }
          set({ messages: msgs });
          break;
        }
        case "assistant_done": {
          const msgs = get().messages.slice();
          const last = msgs[msgs.length - 1];
          if (last && last.streaming) msgs[msgs.length - 1] = { ...last, streaming: false };
          set({ messages: msgs });
          break;
        }
        case "tool_call":
          set({
            toolEvents: [
              {
                id: msg.id,
                name: msg.name,
                server: msg.server,
                input: msg.input,
                status: "running" as const,
                startedAt: Date.now(),
              },
              ...get().toolEvents,
            ].slice(0, 200),
          });
          break;
        case "tool_result":
          set({
            toolEvents: get().toolEvents.map((t) =>
              t.id === msg.id
                ? { ...t, status: msg.ok ? "ok" : "error", output: msg.output, endedAt: Date.now() }
                : t,
            ),
          });
          break;
        case "finding": {
          // Server already persisted this (with a stable id/at) before sending it.
          set({ findings: [msg.finding, ...get().findings].slice(0, 500) });
          break;
        }
        case "error": {
          const msgs = get().messages.slice();
          msgs.push({ id: uid(), role: "assistant", text: `⚠️ ${msg.message}` });
          set({ messages: msgs, status: "idle" });
          break;
        }
      }
    };
  },

  disconnect: () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
    socket = null;
  },

  send: (text: string) => {
    const t = text.trim();
    if (!t) return;
    const msgs = get().messages.slice();
    msgs.push({ id: uid(), role: "user", text: t });
    set({ messages: msgs, status: "thinking" });
    socket?.send(JSON.stringify({ type: "user", text: t }));
  },

  // Optimistic: the server echoes mode_set back, but flipping local state
  // immediately keeps the dropdown from lagging a round trip.
  setMode: (mode: string) => {
    set({ mode });
    socket?.send(JSON.stringify({ type: "set_mode", mode }));
  },

  // Optimistic for the same reason as setMode — the dropdown only ever offers
  // values from the server's own `models` list, so this can't select bad state.
  setModel: (model: string) => {
    set({ model });
    socket?.send(JSON.stringify({ type: "set_model", model }));
  },

  stop: () => socket?.send(JSON.stringify({ type: "stop" })),

  // Ask the backend to cancel a single in-flight tool call. The tool_result it
  // sends back flips the row to "error", so no optimistic local update needed.
  stopTool: (id: string) => socket?.send(JSON.stringify({ type: "stop_tool", id })),

  // Remove one row from the feed (local view only) or clear the whole feed.
  removeToolEvent: (id: string) =>
    set({ toolEvents: get().toolEvents.filter((t) => t.id !== id) }),
  clearToolEvents: () => set({ toolEvents: [] }),

  // Clears the current conversation and tool feed, but keeps the durable
  // findings board — those are cleared explicitly from the Findings page.
  clear: () => set({ messages: [], toolEvents: [] }),

  clearFindings: () => {
    fetch("/api/findings", { method: "DELETE" }).catch(() => {
      /* best-effort — local state clears regardless */
    });
    set({ findings: [] });
  },
}));

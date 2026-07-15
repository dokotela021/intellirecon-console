import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Bot, Plus, TerminalSquare, Trash2, X } from "lucide-react";
import { wsUrl, cn } from "@/lib/utils";

// Reserved session id for the agent's own pinned, read-only tab (see
// AGENT_LOG_SESSION_ID in server.mjs) — run_command output lands only here,
// never in a tab the operator created for their own manual shell work.
const AGENT_TAB_ID = "agent-log";

export type TerminalHandle = {
  closeSession: () => void;
  clear: () => void;
};

// A live PTY rendered in the browser. Keystrokes go up the /pty WebSocket as
// JSON control frames; raw shell output comes back down as text frames. The
// same shell/cwd is what the Claude agent's run_command tool operates in, so
// what you type and what the agent runs share one session.
//
// `sessionId` addresses a server-side pty session that outlives this
// component: switching tabs (which unmounts this pane) or reloading the page
// only closes the WebSocket, not the underlying shell — the backend keeps it
// running and buffers its output, replaying that scrollback when a client
// reattaches. Only closeSession() (wired to the tab's close button) actually
// tears the shell down.
const TerminalPane = forwardRef<TerminalHandle, { sessionId: string; title: string; readOnly?: boolean }>(
  function TerminalPane({ sessionId, title, readOnly }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<Terminal | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);

    useImperativeHandle(ref, () => ({
      closeSession: () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ close: true }));
        }
      },
      clear: () => termRef.current?.clear(),
    }));

    useEffect(() => {
      if (!hostRef.current) return;

      const term = new Terminal({
        fontFamily:
          '"Geist Mono", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
        fontSize: 12.5,
        lineHeight: 1.35,
        cursorBlink: !readOnly,
        disableStdin: readOnly,
        allowProposedApi: true,
        theme: {
          background: "#050505",
          foreground: "#e4e4e7",
          cursor: "#10b981",
          selectionBackground: "#10b98133",
          black: "#050505",
          brightBlack: "#52525b",
          green: "#10b981",
          brightGreen: "#34d399",
          cyan: "#22d3ee",
          brightCyan: "#67e8f9",
          red: "#ef4444",
          yellow: "#f59e0b",
          blue: "#3b82f6",
          magenta: "#a855f7",
          white: "#e4e4e7",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      fit.fit();
      termRef.current = term;

      let ws: WebSocket;
      let alive = true;

      const connect = () => {
        const q = new URLSearchParams({ session: sessionId, title });
        ws = new WebSocket(wsUrl(`/pty?${q}`));
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          sendResize();
        };
        ws.onmessage = (ev) => term.write(ev.data as string);
        ws.onclose = () => {
          setConnected(false);
          if (alive) setTimeout(connect, 1500);
        };
        ws.onerror = () => ws.close();
      };

      const sendResize = () => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ r: [term.cols, term.rows] }));
        }
      };

      term.onData((d) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ i: d }));
      });

      const ro = new ResizeObserver(() => {
        try {
          fit.fit();
          sendResize();
        } catch {
          /* element detached */
        }
      });
      ro.observe(hostRef.current);

      connect();

      return () => {
        alive = false;
        ro.disconnect();
        ws?.close();
        term.dispose();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div ref={hostRef} className="min-h-0 flex-1" />
        <div className="sr-only">{connected ? "connected" : "connecting"}</div>
      </div>
    );
  },
);

const TABS_KEY = "intellirecon:terminal-tabs";

type Tab = { id: string; title: string };

function newTabId(): string {
  return crypto.randomUUID();
}

function loadTabs(): Tab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* corrupt/unavailable storage — fall through to a fresh tab */
  }
  return [{ id: newTabId(), title: "1" }];
}

function saveTabs(tabs: Tab[]) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    /* storage unavailable (private mode, quota) — tabs just won't survive a reload */
  }
}

// Tab strip + one live pane. Each user-created tab is its own server-side pty
// session (see server.mjs); only the active tab's pane is mounted, but
// switching away doesn't close the session — the shell keeps running
// server-side and the next visit replays its buffered output.
//
// The first tab is always the pinned, read-only "agent" tab — every
// run_command call lands there (and only there), so an operator's own shell
// tabs never get clobbered by agent output while they're working in them.
// It isn't part of the persisted tab list: it's synthesized here and always
// present, even on a fresh browser with no saved tabs.
export function TerminalTabs() {
  const [tabs, setTabs] = useState<Tab[]>(loadTabs);
  const [activeId, setActiveId] = useState<string>(() => loadTabs()[0].id);
  const paneRefs = useRef<Map<string, TerminalHandle>>(new Map());

  useEffect(() => saveTabs(tabs), [tabs]);

  const addTab = () => {
    const tab = { id: newTabId(), title: String(tabs.length + 1) };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  };

  const closeTab = (id: string) => {
    paneRefs.current.get(id)?.closeSession();
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = { id: newTabId(), title: "1" };
        setActiveId(fresh.id);
        return [fresh];
      }
      if (activeId === id) setActiveId(next[next.length - 1].id);
      return next;
    });
  };

  const allTabs: Tab[] = [{ id: AGENT_TAB_ID, title: "agent" }, ...tabs];
  const active = allTabs.find((t) => t.id === activeId) ?? allTabs[0];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-card px-2">
        <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-recon" />
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {allTabs.map((t) => {
            const isAgent = t.id === AGENT_TAB_ID;
            return (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={cn(
                  "group flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px]",
                  t.id === active?.id
                    ? isAgent
                      ? "bg-recon-dim/30 text-recon"
                      : "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
                title={isAgent ? "Agent output (read-only) — your shell tabs stay untouched" : `shell ${t.title}`}
              >
                {isAgent && <Bot className="h-3 w-3" />}
                <span className="mono">{t.title}</span>
                {!isAgent && tabs.length > 1 && (
                  <X
                    className="h-3 w-3 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                  />
                )}
              </button>
            );
          })}
          <button
            onClick={addTab}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="New terminal tab"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          onClick={() => paneRefs.current.get(active?.id ?? "")?.clear()}
          className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Clear"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {active && (
          <TerminalPane
            key={active.id}
            ref={(el) => {
              if (el) paneRefs.current.set(active.id, el);
              else paneRefs.current.delete(active.id);
            }}
            sessionId={active.id}
            title={active.title}
            readOnly={active.id === AGENT_TAB_ID}
          />
        )}
      </div>
    </div>
  );
}

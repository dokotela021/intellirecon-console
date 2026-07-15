import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Bot, User, Trash2 } from "lucide-react";
import { useAgent } from "@/store/agent";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Recon scanme.nmap.org — start with an nmap service scan",
  "Enumerate subdomains of example.com and summarize the attack surface",
  "Run a nuclei scan against http://testphp.vulnweb.com and triage findings",
];

export function AgentChat() {
  const messages = useAgent((s) => s.messages);
  const status = useAgent((s) => s.status);
  const hasKey = useAgent((s) => s.hasKey);
  const send = useAgent((s) => s.send);
  const clear = useAgent((s) => s.clear);
  const modes = useAgent((s) => s.modes);
  const mode = useAgent((s) => s.mode);
  const setMode = useAgent((s) => s.setMode);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeMode = modes.find((m) => m.id === mode);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    if (!input.trim()) return;
    send(input);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Sparkles className="h-3.5 w-3.5 text-cyan" />
        <span className="text-xs font-medium">Agent</span>
        {modes.length > 0 && (
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            title={activeMode?.summary}
            className="ml-1 max-w-[9.5rem] truncate rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-ring"
          >
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={clear}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Clear conversation"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {activeMode && activeMode.id !== "general" && (
        <div className="shrink-0 border-b border-border bg-recon-dim/10 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="text-recon">{activeMode.label}</span> — {activeMode.summary}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background">
              <Bot className="h-6 w-6 text-recon" />
            </div>
            <div className="max-w-sm space-y-1">
              <p className="text-sm font-medium">Autonomous recon, in your browser</p>
              <p className="text-xs text-muted-foreground">
                Describe a target and the agent plans, runs MCP security tools, reads the
                terminal, and reports verified findings.
              </p>
            </div>
            <div className="w-full max-w-sm space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-recon/40 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className="flex gap-2.5">
            <div
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border",
                m.role === "user" ? "bg-background" : "bg-recon-dim/40",
              )}
            >
              {m.role === "user" ? (
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Bot className="h-3.5 w-3.5 text-recon" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mono">
                {m.role === "user" ? "you" : "agent"}
              </div>
              <div className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                {m.text}
                {m.streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-recon align-middle" />}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {!hasKey && (
          <div className="mb-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-[11px] text-warning">
            No ANTHROPIC_API_KEY on the backend — set it and restart to enable the agent.
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Describe a target or task…  (Enter to send, Shift+Enter for newline)"
            className="max-h-32 min-h-[38px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ring"
          />
          <button
            onClick={submit}
            disabled={!input.trim() || status !== "idle"}
            className="flex h-[38px] items-center gap-1.5 rounded-md bg-recon px-3 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

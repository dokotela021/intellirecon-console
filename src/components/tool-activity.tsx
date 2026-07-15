import { useState } from "react";
import { ChevronRight, Wrench, CheckCircle2, XCircle, Loader2, Square, X, Trash2 } from "lucide-react";
import { useAgent } from "@/store/agent";
import { cn } from "@/lib/utils";
import { shortTime } from "@/lib/utils";
import type { ToolEvent } from "@/types";

function Row({ ev }: { ev: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const stopTool = useAgent((s) => s.stopTool);
  const removeToolEvent = useAgent((s) => s.removeToolEvent);
  const dur = ev.endedAt ? `${((ev.endedAt - ev.startedAt) / 1000).toFixed(1)}s` : "";
  const running = ev.status === "running";
  return (
    <div className="border-b border-border/60 last:border-0">
      <div className="group flex w-full items-center gap-2 px-3 py-2 hover:bg-accent/30">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          {running ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan" />
          ) : ev.status === "ok" ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-recon" />
          ) : (
            <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          )}
          <span className="truncate font-mono text-xs">{ev.name}</span>
          <span className="rounded bg-secondary px-1 py-0.5 text-[9px] text-muted-foreground">{ev.server}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums mono">
            {dur || shortTime(ev.startedAt)}
          </span>
        </button>

        {running && (
          <button
            onClick={() => stopTool(ev.id)}
            title="Stop this tool"
            aria-label="Stop this tool"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          >
            <Square className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={() => removeToolEvent(ev.id)}
          title="Remove from feed"
          aria-label="Remove from feed"
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {open && (
        <div className="space-y-2 px-3 pb-3 pl-8">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground mono">input</div>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 text-[11px] text-foreground/80">
              {JSON.stringify(ev.input, null, 2)}
            </pre>
          </div>
          {ev.output !== undefined && (
            <div>
              <div className="text-[10px] uppercase text-muted-foreground mono">output</div>
              <pre className="mt-1 max-h-56 overflow-auto rounded bg-background p-2 text-[11px] text-foreground/80 whitespace-pre-wrap">
                {ev.output.slice(0, 8000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolActivity() {
  const events = useAgent((s) => s.toolEvents);
  const clearToolEvents = useAgent((s) => s.clearToolEvents);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Wrench className="h-3.5 w-3.5 text-cyan" />
        <span className="text-xs font-medium">Tool Activity</span>
        {events.length > 0 && (
          <>
            <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
              {events.length}
            </span>
            <button
              onClick={clearToolEvents}
              title="Clear feed"
              aria-label="Clear feed"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            MCP tool calls will stream here as the agent works.
          </div>
        ) : (
          events.map((ev) => <Row key={ev.id} ev={ev} />)
        )}
      </div>
    </div>
  );
}

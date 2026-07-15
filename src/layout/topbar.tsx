import { Menu, Radar, Square } from "lucide-react";
import { useAgent } from "@/store/agent";
import { cn } from "@/lib/utils";

export function Topbar({ onMenuToggle }: { onMenuToggle: () => void }) {
  const status = useAgent((s) => s.status);
  const statusLabel = useAgent((s) => s.statusLabel);
  const stop = useAgent((s) => s.stop);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <button
        onClick={onMenuToggle}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent md:hidden"
        aria-label="Toggle menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-2 md:hidden">
        <Radar className="h-4 w-4 text-recon" />
        <span className="text-sm font-semibold">IntelliRecon</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-xs">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              status === "idle"
                ? "bg-muted-foreground"
                : status === "thinking"
                  ? "bg-cyan pulse-dot"
                  : "bg-recon pulse-dot",
            )}
          />
          <span className="text-muted-foreground mono">
            {status === "idle" ? "idle" : statusLabel || status}
          </span>
        </div>

        {status !== "idle" && (
          <button
            onClick={stop}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive"
          >
            <Square className="h-3 w-3" />
            Stop
          </button>
        )}
      </div>
    </header>
  );
}

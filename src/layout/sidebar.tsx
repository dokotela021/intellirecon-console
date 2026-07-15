import { NavLink } from "react-router-dom";
import {
  Activity,
   Radar,
  ShieldAlert,
  History,
  TerminalSquare,
  Settings,
  Boxes,
  BrainCircuit,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgent } from "@/store/agent";

const NAV = [
  { to: "/", label: "Console", icon: TerminalSquare, end: true },
  { to: "/findings", label: "Findings", icon: ShieldAlert },
  { to: "/knowledge", label: "Knowledge Base", icon: BrainCircuit },
  { to: "/history", label: "History", icon: History },
  { to: "/tools", label: "MCP Tools", icon: Boxes },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const conn = useAgent((s) => s.conn);
  const tools = useAgent((s) => s.tools);
  const findings = useAgent((s) => s.findings);
  const model = useAgent((s) => s.model);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background">
          <Radar className="h-4 w-4 text-recon" aria-hidden />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight">IntelliRecon</span>
          <span className="text-[10px] text-muted-foreground mono">AI recon console</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3" aria-label="Primary">
        <ul className="space-y-0.5 px-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={"end" in item ? item.end : undefined}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  <span>{item.label}</span>
                  {item.to === "/tools" && tools.length > 0 && (
                    <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {tools.length}
                    </span>
                  )}
                  {item.to === "/findings" && findings.length > 0 && (
                    <span className="ml-auto rounded bg-recon-dim/50 px-1.5 py-0.5 text-[10px] text-recon tabular-nums">
                      {findings.length}
                    </span>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border px-4 py-3 text-[10px] text-muted-foreground mono">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              conn === "open" ? "bg-recon pulse-dot" : "bg-destructive",
            )}
          />
          <span>{conn === "open" ? "agent connected" : "agent offline"}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 opacity-70">
          <Activity className="h-3 w-3" aria-hidden />
          <span className="truncate">{model || "no model"}</span>
        </div>
      </div>
    </aside>
  );
}

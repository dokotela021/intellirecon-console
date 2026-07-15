import { Settings as SettingsIcon, Server, KeyRound, Radar } from "lucide-react";
import { useAgent } from "@/store/agent";
import { cn } from "@/lib/utils";

function StatRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-xs", ok === false ? "text-destructive" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

export function SettingsPage() {
  const { model, hasKey, tools, conn } = useAgent();
  const servers = Array.from(new Set(tools.map((t) => t.server)));

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <SettingsIcon className="h-5 w-5 text-recon" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      <div className="space-y-4">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Radar className="h-4 w-4 text-recon" /> Agent
          </div>
          <StatRow label="Backend socket" value={conn} ok={conn === "open"} />
          <StatRow label="Model" value={model || "—"} />
          <StatRow label="API key" value={hasKey ? "configured" : "missing"} ok={hasKey} />
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Server className="h-4 w-4 text-cyan" /> Connected MCP servers
          </div>
          {servers.length === 0 ? (
            <p className="text-sm text-muted-foreground">None connected.</p>
          ) : (
            servers.map((s) => (
              <StatRow
                key={s}
                label={s}
                value={`${tools.filter((t) => t.server === s).length} tools`}
              />
            ))
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
            <KeyRound className="h-4 w-4 text-warning" /> Configuration
          </div>
          <p className="leading-relaxed">
            The agent model and MCP servers are configured on the backend. Set
            <code className="mx-1 rounded bg-background px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code>
            in the environment and edit
            <code className="mx-1 rounded bg-background px-1 py-0.5 text-xs">mcp.config.json</code>
            to add or remove tool servers, then restart
            <code className="mx-1 rounded bg-background px-1 py-0.5 text-xs">npm start</code>.
          </p>
        </section>
      </div>
    </div>
  );
}

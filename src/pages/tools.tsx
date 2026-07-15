import { useMemo, useState } from "react";
import { Boxes, Search } from "lucide-react";
import { useAgent } from "@/store/agent";

export function ToolsPage() {
  const tools = useAgent((s) => s.tools);
  const [q, setQ] = useState("");

  const grouped = useMemo(() => {
    const filtered = tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q.toLowerCase()) ||
        t.description.toLowerCase().includes(q.toLowerCase()),
    );
    const by: Record<string, typeof tools> = {};
    for (const t of filtered) (by[t.server] ??= []).push(t);
    return by;
  }, [tools, q]);

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <Boxes className="h-5 w-5 text-recon" />
        <h1 className="text-lg font-semibold">MCP Tools</h1>
        <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
          {tools.length}
        </span>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter tools…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      {tools.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
          No MCP tools connected. Configure servers in <code className="mx-1">mcp.config.json</code> and restart the backend.
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([server, list]) => (
            <div key={server}>
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-wide">{server}</span>
                <span className="h-px flex-1 bg-border" />
                <span className="tabular-nums">{list.length}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map((t) => (
                  <div key={`${t.server}:${t.name}`} className="card-hover rounded-md border border-border bg-card p-2.5">
                    <div className="font-mono text-xs text-recon">{t.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {t.description || "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

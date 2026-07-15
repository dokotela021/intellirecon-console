import { useEffect, useState } from "react";
import { History as HistoryIcon, Clock, Copy, Check, Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface RunRow {
  id: string;
  target: string | null;
  request: string;
  startedAt: number;
  endedAt: number | null;
  dir: string | null;
  findingsCount: number;
}

interface SubdomainRow {
  hostname: string;
  firstSeen: number;
  lastSeen: number;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDuration(startedAt: number, endedAt: number | null): string {
  if (!endedAt) return "—";
  const s = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Runs and subdomains are the durable, queryable record the backend keeps in
// SQLite (server/db.mjs) — this view is what makes that queryable, not just
// stored: every past recon turn, and every hostname ever seen per target,
// independent of whatever's in the current browser session.
export function HistoryPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [target, setTarget] = useState<string | null>(null);
  const [subdomains, setSubdomains] = useState<SubdomainRow[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then((data) => {
        const list: RunRow[] = data.runs ?? [];
        setRuns(list);
        setTarget((t) => t ?? list.find((r) => r.target)?.target ?? null);
      })
      .catch(() => {
        /* backend unreachable — page just shows empty state */
      })
      .finally(() => setLoadingRuns(false));
  }, []);

  useEffect(() => {
    if (!target) {
      setSubdomains([]);
      return;
    }
    setLoadingSubs(true);
    fetch(`/api/subdomains?target=${encodeURIComponent(target)}`)
      .then((r) => r.json())
      .then((data) => setSubdomains(data.subdomains ?? []))
      .catch(() => setSubdomains([]))
      .finally(() => setLoadingSubs(false));
  }, [target]);

  const targets = [...new Set(runs.map((r) => r.target).filter((t): t is string => Boolean(t)))];

  const copyDir = (r: RunRow) => {
    if (!r.dir) return;
    navigator.clipboard.writeText(`cd ${r.dir} && claude`).then(() => {
      setCopiedId(r.id);
      setTimeout(() => setCopiedId((c) => (c === r.id ? null : c)), 1500);
    });
  };

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <HistoryIcon className="h-5 w-5 text-recon" />
        <h1 className="text-lg font-semibold">History</h1>
        <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
          {runs.length} runs
        </span>
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Runs</h2>
        {loadingRuns ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
            <Clock className="mb-2 h-6 w-6 opacity-40" />
            No runs yet. Give the agent a target in the Console.
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "card-hover rounded-lg border p-3 text-sm",
                  target && r.target === target ? "border-recon/40" : "border-border",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => r.target && setTarget(r.target)}
                    disabled={!r.target}
                    className="font-mono text-xs text-cyan hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
                  >
                    {r.target || "(no target detected)"}
                  </button>
                  {r.findingsCount > 0 && (
                    <span className="rounded bg-recon-dim/50 px-1.5 py-0.5 text-[10px] text-recon tabular-nums">
                      {r.findingsCount} finding{r.findingsCount === 1 ? "" : "s"}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground mono">{fmtDate(r.startedAt)}</span>
                  <span className="text-[10px] text-muted-foreground mono">
                    {fmtDuration(r.startedAt, r.endedAt)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{r.request}</p>
                {r.dir && (
                  <button
                    onClick={() => copyDir(r)}
                    className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                    title="Copy 'cd <dir> && claude'"
                  >
                    {copiedId === r.id ? (
                      <Check className="h-3 w-3 text-recon" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    <span className="mono">{r.dir}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subdomains</h2>
          {targets.length > 0 && (
            <select
              value={target ?? ""}
              onChange={(e) => setTarget(e.target.value || null)}
              className="ml-auto rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
            >
              {targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
        {!target ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
            <Globe2 className="mb-2 h-6 w-6 opacity-40" />
            Pick a target above (or run a recon) to see its subdomains.
          </div>
        ) : loadingSubs ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : subdomains.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
            <Globe2 className="mb-2 h-6 w-6 opacity-40" />
            No subdomains recorded yet for {target}.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-card text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    Hostname
                    <span className="ml-1.5 font-normal tabular-nums">({subdomains.length})</span>
                  </th>
                  <th className="px-3 py-2 text-left font-medium">First seen</th>
                  <th className="px-3 py-2 text-left font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {subdomains.map((s) => (
                  <tr key={s.hostname} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-cyan">{s.hostname}</td>
                    <td className="px-3 py-2 text-muted-foreground mono">{fmtDate(s.firstSeen)}</td>
                    <td className="px-3 py-2 text-muted-foreground mono">{fmtDate(s.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

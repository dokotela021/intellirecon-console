import { ShieldAlert, Download, Trash2 } from "lucide-react";
import { useAgent } from "@/store/agent";
import { cn, shortTime } from "@/lib/utils";
import type { Finding } from "@/types";

const SEV_STYLE: Record<Finding["severity"], string> = {
  critical: "border-severity-critical/40 text-severity-critical",
  high: "border-severity-high/40 text-severity-high",
  medium: "border-severity-medium/40 text-severity-medium",
  low: "border-severity-low/40 text-severity-low",
  info: "border-severity-info/40 text-muted-foreground",
};

export function FindingsPage() {
  const findings = useAgent((s) => s.findings);
  const clearFindings = useAgent((s) => s.clearFindings);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(findings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `intellirecon-findings-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <ShieldAlert className="h-5 w-5 text-recon" />
        <h1 className="text-lg font-semibold">Findings</h1>
        <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
          {findings.length}
        </span>
        {findings.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={exportJson}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" /> Export JSON
            </button>
            <button
              onClick={() => {
                if (confirm(`Clear all ${findings.length} findings? This cannot be undone.`)) {
                  clearFindings();
                }
              }}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          </div>
        )}
      </div>

      {findings.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
          <ShieldAlert className="mb-2 h-6 w-6 opacity-40" />
          No findings yet. The agent records verified issues here as it works.
        </div>
      ) : (
        <div className="space-y-2">
          {findings.map((f) => (
            <div key={f.id} className="card-hover rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    SEV_STYLE[f.severity],
                  )}
                >
                  {f.severity}
                </span>
                <span className="text-sm font-medium">{f.title}</span>
                <span className="ml-auto text-[10px] text-muted-foreground mono">{shortTime(f.at)}</span>
              </div>
              {f.target && (
                <div className="mt-1 font-mono text-xs text-cyan">{f.target}</div>
              )}
              {f.detail && (
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {f.detail}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

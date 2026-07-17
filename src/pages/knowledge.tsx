import { useEffect, useState } from "react";
import { BrainCircuit, FileCode2, Network, Users, KeyRound, Workflow, Link2, Eye, StickyNote } from "lucide-react";
import type { KnowledgeBase } from "@/types";
import { shortTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown";

const EMPTY_KB: KnowledgeBase = {
  target: "",
  jsAssets: [],
  endpoints: [],
  roles: [],
  roleAccess: [],
  authTokens: [],
  businessFlows: [],
  thirdParties: [],
  clientObservations: [],
  notes: [],
};

type TabId =
  | "endpoints"
  | "js"
  | "auth"
  | "roles"
  | "flows"
  | "third-parties"
  | "client"
  | "notes";

const TABS: { id: TabId; label: string; icon: typeof FileCode2 }[] = [
  { id: "endpoints", label: "Endpoints", icon: Network },
  { id: "js", label: "JS Assets", icon: FileCode2 },
  { id: "auth", label: "Tokens", icon: KeyRound },
  { id: "roles", label: "Roles & Access", icon: Users },
  { id: "flows", label: "Business Flows", icon: Workflow },
  { id: "third-parties", label: "Third Parties", icon: Link2 },
  { id: "client", label: "Client Observations", icon: Eye },
  { id: "notes", label: "Notes", icon: StickyNote },
];

function countFor(kb: KnowledgeBase, id: TabId): number {
  switch (id) {
    case "endpoints": return kb.endpoints.length;
    case "js": return kb.jsAssets.length;
    case "auth": return kb.authTokens.length;
    case "roles": return kb.roles.length + kb.roleAccess.length;
    case "flows": return kb.businessFlows.length;
    case "third-parties": return kb.thirdParties.length;
    case "client": return kb.clientObservations.length;
    case "notes": return kb.notes.length;
  }
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
      No {label} recorded yet for this target.
    </div>
  );
}

function jsonPreview(s?: string): string | null {
  if (!s) return null;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

// Every recon agent mode (server/agents.mjs) reads/writes this same per-target
// store (server/db.mjs), so switching modes mid-investigation carries context
// forward — this page is the human view onto that shared memory.
export function KnowledgePage() {
  const [targets, setTargets] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [kb, setKb] = useState<KnowledgeBase>(EMPTY_KB);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("endpoints");

  useEffect(() => {
    fetch("/api/kb/targets")
      .then((r) => r.json())
      .then((data) => {
        const list: string[] = data.targets ?? [];
        setTargets(list);
        setTarget((t) => t ?? list[0] ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!target) {
      setKb(EMPTY_KB);
      return;
    }
    fetch(`/api/kb?target=${encodeURIComponent(target)}`)
      .then((r) => r.json())
      .then((data) => setKb(data))
      .catch(() => setKb(EMPTY_KB));
  }, [target]);

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <BrainCircuit className="h-5 w-5 text-recon" />
        <h1 className="text-lg font-semibold">Knowledge Base</h1>
        {targets.length > 0 && (
          <select
            value={target ?? ""}
            onChange={(e) => setTarget(e.target.value || null)}
            className="ml-auto rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
          >
            {targets.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !target ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
          <BrainCircuit className="mb-2 h-6 w-6 opacity-40" />
          Nothing recorded yet. Switch the agent into a recon mode (JS Recon, API Mapping, …) in the
          Console and give it a target — findings land here automatically.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5 border-b border-border pb-3">
            {TABS.map((t) => {
              const Icon = t.icon;
              const count = countFor(kb, t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                    tab === t.id
                      ? "border-recon/40 bg-recon-dim/20 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  {count > 0 && <span className="tabular-nums opacity-70">{count}</span>}
                </button>
              );
            })}
          </div>

          {tab === "endpoints" && (
            kb.endpoints.length === 0 ? <Empty label="endpoints" /> : (
              <div className="space-y-2">
                {kb.endpoints.map((e) => (
                  <div key={e.id} className="card-hover rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-cyan/40 px-1.5 py-0.5 text-[10px] font-semibold text-cyan mono">
                        {e.method}
                      </span>
                      <span className="font-mono text-xs">{e.path}</span>
                      {e.authRequired && (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          auth: {e.authRequired}
                        </span>
                      )}
                      {e.source && <span className="text-[10px] text-muted-foreground">via {e.source}</span>}
                      <span className="ml-auto text-[10px] text-muted-foreground mono">{shortTime(e.lastSeen)}</span>
                    </div>
                    {(e.paramsJson || e.headersJson || e.responsesJson) && (
                      <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-[10px] text-muted-foreground">
{[
  jsonPreview(e.paramsJson) && `params:\n${jsonPreview(e.paramsJson)}`,
  jsonPreview(e.headersJson) && `headers:\n${jsonPreview(e.headersJson)}`,
  jsonPreview(e.responsesJson) && `responses:\n${jsonPreview(e.responsesJson)}`,
].filter(Boolean).join("\n\n")}
                      </pre>
                    )}
                    {e.notes && <p className="mt-1.5 text-xs text-muted-foreground">{e.notes}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "js" && (
            kb.jsAssets.length === 0 ? <Empty label="JS assets" /> : (
              <div className="space-y-2">
                {kb.jsAssets.map((a) => (
                  <div key={a.id} className="card-hover rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.kind && (
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{a.kind}</span>
                      )}
                      <span className="truncate font-mono text-xs text-cyan">{a.url}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground mono">{shortTime(a.lastSeen)}</span>
                    </div>
                    {a.notes && <p className="mt-1.5 text-xs text-muted-foreground">{a.notes}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "auth" && (
            kb.authTokens.length === 0 ? <Empty label="tokens" /> : (
              <div className="space-y-2">
                {kb.authTokens.map((t) => (
                  <div key={t.id} className="card-hover rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-recon/40 px-1.5 py-0.5 text-[10px] font-semibold text-recon">
                        {t.kind}
                      </span>
                      {t.algorithm && <span className="text-[10px] text-muted-foreground">alg: {t.algorithm}</span>}
                      {t.lifetime && <span className="text-[10px] text-muted-foreground">lifetime: {t.lifetime}</span>}
                      {t.rotation && <span className="text-[10px] text-muted-foreground">rotation: {t.rotation}</span>}
                      <span className="ml-auto text-[10px] text-muted-foreground mono">{shortTime(t.updatedAt)}</span>
                    </div>
                    {(t.claimsJson || t.cookieFlagsJson) && (
                      <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-[10px] text-muted-foreground">
{[
  jsonPreview(t.claimsJson) && `claims:\n${jsonPreview(t.claimsJson)}`,
  jsonPreview(t.cookieFlagsJson) && `cookie flags:\n${jsonPreview(t.cookieFlagsJson)}`,
].filter(Boolean).join("\n\n")}
                      </pre>
                    )}
                    {t.notes && <p className="mt-1.5 text-xs text-muted-foreground">{t.notes}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "roles" && (
            kb.roles.length === 0 && kb.roleAccess.length === 0 ? <Empty label="roles" /> : (
              <div className="space-y-4">
                {kb.roles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {[...kb.roles].sort((a, b) => (a.level ?? 0) - (b.level ?? 0)).map((r) => (
                      <span key={r.id} title={r.description} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs">
                        {r.name}{r.level != null && <span className="ml-1 text-muted-foreground">Lv{r.level}</span>}
                      </span>
                    ))}
                  </div>
                )}
                {kb.roleAccess.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-card text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Role</th>
                          <th className="px-3 py-2 text-left font-medium">Endpoint</th>
                          <th className="px-3 py-2 text-left font-medium">Accessible</th>
                          <th className="px-3 py-2 text-left font-medium">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kb.roleAccess.map((ra) => (
                          <tr key={ra.id} className="border-t border-border">
                            <td className="px-3 py-2">{ra.role}</td>
                            <td className="px-3 py-2 font-mono text-cyan">{ra.endpoint}</td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                                  ra.accessible === "inconsistent"
                                    ? "border border-severity-high/40 text-severity-high"
                                    : ra.accessible === "yes"
                                    ? "text-recon"
                                    : "text-muted-foreground",
                                )}
                              >
                                {ra.accessible}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{ra.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          )}

          {tab === "flows" && (
            kb.businessFlows.length === 0 ? <Empty label="business flows" /> : (
              <div className="space-y-2">
                {kb.businessFlows.map((f) => {
                  let steps: string[] = [];
                  try { steps = f.stepsJson ? JSON.parse(f.stepsJson) : []; } catch { /* ignore */ }
                  return (
                    <div key={f.id} className="card-hover rounded-lg border border-border bg-card p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{f.name}</span>
                        {f.verifiedServerSide && (
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                              f.verifiedServerSide === "no"
                                ? "border border-severity-high/40 text-severity-high"
                                : f.verifiedServerSide === "yes"
                                ? "text-recon"
                                : "text-muted-foreground",
                            )}
                          >
                            server-side: {f.verifiedServerSide}
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-muted-foreground mono">{shortTime(f.updatedAt)}</span>
                      </div>
                      {steps.length > 0 && (
                        <ol className="mt-2 list-inside list-decimal space-y-0.5 text-xs text-muted-foreground">
                          {steps.map((s, i) => <li key={i}>{s}</li>)}
                        </ol>
                      )}
                      {f.notes && <p className="mt-1.5 text-xs text-muted-foreground">{f.notes}</p>}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {tab === "third-parties" && (
            kb.thirdParties.length === 0 ? <Empty label="third parties" /> : (
              <div className="space-y-2">
                {kb.thirdParties.map((tp) => (
                  <div key={tp.id} className="card-hover rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{tp.name}</span>
                      {tp.category && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{tp.category}</span>}
                      {tp.url && <span className="truncate font-mono text-xs text-cyan">{tp.url}</span>}
                    </div>
                    {tp.notes && <p className="mt-1.5 text-xs text-muted-foreground">{tp.notes}</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "client" && (
            kb.clientObservations.length === 0 ? <Empty label="client observations" /> : (
              <div className="space-y-2">
                {kb.clientObservations.map((c) => (
                  <div key={c.id} className="card-hover rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.category && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{c.category}</span>}
                      {c.url && <span className="truncate font-mono text-[10px] text-cyan">{c.url}</span>}
                      <span className="ml-auto text-[10px] text-muted-foreground mono">{shortTime(c.at)}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-foreground/90">{c.detail}</p>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "notes" && (
            kb.notes.length === 0 ? <Empty label="notes" /> : (
              <div className="space-y-2">
                {kb.notes.map((n) => (
                  <div key={n.id} className="card-hover rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      {n.agent && <span className="text-[10px] text-muted-foreground mono">{n.agent}</span>}
                      <span className="ml-auto text-[10px] text-muted-foreground mono">{shortTime(n.at)}</span>
                    </div>
                    <Markdown text={n.body} className="mt-1 text-xs" />
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

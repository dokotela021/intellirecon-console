import { AgentChat } from "@/components/agent-chat";
import { TerminalTabs } from "@/components/terminal";
import { ToolActivity } from "@/components/tool-activity";

// The console is the whole product: a Claude agent panel on the left, and a
// live in-browser terminal stacked over the streaming MCP tool feed on the
// right. Agent and human share one shell session on the thin backend.
export function ConsolePage() {
  return (
    <div className="grid-backdrop h-full p-3">
      <div className="grid h-full grid-cols-1 gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,9fr)]">
        <div className="min-h-0">
          <AgentChat />
        </div>
        <div className="grid min-h-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
          <TerminalTabs />
          <ToolActivity />
        </div>
      </div>
    </div>
  );
}

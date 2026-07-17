import { Group, Panel, useDefaultLayout } from "react-resizable-panels";
import { AgentChat } from "@/components/agent-chat";
import { TerminalTabs } from "@/components/terminal";
import { ToolActivity } from "@/components/tool-activity";
import { ResizeSeparator } from "@/components/resize-separator";
import { useMediaQuery } from "@/hooks/use-media-query";

// The console is the whole product: a Claude agent panel on the left, and a
// live in-browser terminal stacked over the streaming MCP tool feed on the
// right. Agent and human share one shell session on the thin backend.
//
// Below the `lg` breakpoint the outer split stacks vertically (chat above
// terminal+tools) rather than side by side — same rationale as the old
// grid-cols-1/lg:grid-cols layout it replaced, just driven by Group's
// orientation instead of a Tailwind responsive variant.
export function ConsolePage() {
  const isWide = useMediaQuery("(min-width: 1024px)");
  const outer = useDefaultLayout({ id: "intellirecon:console-outer-split", storage: localStorage });
  const inner = useDefaultLayout({ id: "intellirecon:console-right-split", storage: localStorage });

  return (
    <div className="grid-backdrop h-full p-3">
      <Group
        orientation={isWide ? "horizontal" : "vertical"}
        className="h-full"
        defaultLayout={outer.defaultLayout}
        onLayoutChanged={outer.onLayoutChanged}
      >
        <Panel id="chat" defaultSize="44" minSize="20" className="min-h-0">
          <AgentChat />
        </Panel>
        <ResizeSeparator orientation={isWide ? "horizontal" : "vertical"} />
        <Panel id="right" defaultSize="56" minSize="25" className="min-h-0">
          <Group
            orientation="vertical"
            className="h-full"
            defaultLayout={inner.defaultLayout}
            onLayoutChanged={inner.onLayoutChanged}
          >
            <Panel id="terminal" defaultSize="60" minSize="15" className="min-h-0">
              <TerminalTabs />
            </Panel>
            <ResizeSeparator orientation="vertical" />
            <Panel id="tools" defaultSize="40" minSize="10" className="min-h-0">
              <ToolActivity />
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}

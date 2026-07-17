import { Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";

// Thin drag handle between two Panels. `data-separator` is set by the library
// itself to "inactive" | "hover" | "active" | "focus" | "disabled" — driven
// off its own pointer/keyboard state machine, so it survives the cursor
// straying off this (deliberately narrow) hit area mid-drag, unlike a plain
// CSS :active/:hover would.
export function ResizeSeparator({ orientation }: { orientation: "horizontal" | "vertical" }) {
  return (
    <Separator
      className={cn(
        "group relative shrink-0 outline-none",
        orientation === "horizontal" ? "w-3 cursor-col-resize" : "h-3 cursor-row-resize",
      )}
    >
      <div
        className={cn(
          "absolute rounded-full bg-border transition-colors",
          "group-data-[separator=hover]:bg-recon/70",
          "group-data-[separator=active]:bg-recon",
          "group-data-[separator=focus]:bg-recon",
          orientation === "horizontal"
            ? "inset-y-2 left-1/2 w-[3px] -translate-x-1/2"
            : "inset-x-2 top-1/2 h-[3px] -translate-y-1/2",
        )}
      />
    </Separator>
  );
}

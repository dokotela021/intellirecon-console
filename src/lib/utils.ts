import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortTime(ts = Date.now()): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Build a same-origin ws:// or wss:// URL for a backend path. */
export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
}

const NEXT_INPUT_MARKER = "NEXT_INPUT:";

// Pulls the trailing `NEXT_INPUT: ...` line (see SYSTEM_PROMPT in server.mjs)
// off an assistant message, if present, so it can be shown in chat separately
// from the recommended next input it's suggesting for the operator.
export function splitSuggestion(text: string): { display: string; suggestion: string | null } {
  const idx = text.lastIndexOf(NEXT_INPUT_MARKER);
  if (idx === -1) return { display: text, suggestion: null };
  const before = text.slice(0, idx);
  // Only honor it as the trailing marker line, not an incidental substring mid-paragraph.
  if (before.length > 0 && !before.endsWith("\n")) return { display: text, suggestion: null };
  const suggestion = text.slice(idx + NEXT_INPUT_MARKER.length).trim();
  if (!suggestion) return { display: text, suggestion: null };
  return { display: before.replace(/\n+$/, ""), suggestion };
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// In dev, Vite serves the SPA on 5173 and proxies the live WebSockets + API
// to the thin Node backend (server/server.mjs) on 8899. In prod the backend
// serves the built assets directly, so this proxy is dev-only.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/pty": { target: "ws://localhost:8899", ws: true },
      "/agent": { target: "ws://localhost:8899", ws: true },
      "/api": { target: "http://localhost:8899" },
    },
    // server/server.mjs isn't run with --watch (npm run dev just `node`s it once),
    // so editing the backend doesn't actually restart it — but Vite's default
    // watcher covers the whole repo root and force-reloads the browser anyway,
    // tearing down the proxied /agent and /pty sockets for no real change.
    // intellirecon-runs/ churns constantly during a session (every agent turn
    // writes files there) and should never trigger a frontend reload either.
    watch: {
      ignored: ["**/server/**", "**/intellirecon-runs/**", "**/*.md"],
    },
  },
});

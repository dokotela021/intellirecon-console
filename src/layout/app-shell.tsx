import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useAgent } from "@/store/agent";

export function AppShell() {
  const connect = useAgent((s) => s.connect);
  const disconnect = useAgent((s) => s.disconnect);
  const loadFindings = useAgent((s) => s.loadFindings);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    connect();
    loadFindings();
    return () => disconnect();
  }, [connect, disconnect, loadFindings]);

  useEffect(() => setSidebarOpen(false), [location.pathname]);

  const toggle = useCallback(() => setSidebarOpen((o) => !o), []);
  const close = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} aria-hidden />
          <div className="absolute inset-y-0 left-0 z-50 w-60">
            <Sidebar onNavigate={close} />
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar onMenuToggle={toggle} />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

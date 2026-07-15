import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./layout/app-shell";
import { ConsolePage } from "./pages/console";
import { FindingsPage } from "./pages/findings";
import { HistoryPage } from "./pages/history";
import { KnowledgePage } from "./pages/knowledge";
import { ToolsPage } from "./pages/tools";
import { SettingsPage } from "./pages/settings";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ConsolePage />} />
        <Route path="/findings" element={<FindingsPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

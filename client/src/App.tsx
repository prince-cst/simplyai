import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { DatabasePage } from "@/pages/DatabasePage";
import { ExplorerPage } from "@/pages/ExplorerPage";
import { ChatPage } from "@/pages/ChatPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TestCenterPage } from "@/pages/TestCenterPage";
import { TriggersPage } from "@/pages/TriggersPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/connections" element={<DatabasePage />} />
        <Route path="/database" element={<Navigate to="/connections" replace />} />
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="/collections" element={<Navigate to="/explorer" replace />} />
        <Route path="/collections/:name" element={<Navigate to="/explorer" replace />} />
        <Route path="/schema" element={<Navigate to="/explorer" replace />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/triggers" element={<TriggersPage />} />
        <Route path="/history" element={<Navigate to="/chat" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tests" element={<TestCenterPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

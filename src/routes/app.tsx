import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { ClipboardList, Snail, HatGlasses, Settings as SettingsIcon, Scale, LogOut } from "lucide-react";
import LogEntryTab from "@/components/app/LogEntryTab";
import ChatTab from "@/components/app/ChatTab";
import AgentTab from "@/components/app/AgentTab";
import SettingsTab from "@/components/app/SettingsTab";

export const Route = createFileRoute("/app")({
  component: AppShell,
  head: () => ({
    meta: [
      { title: "Paralegal Dashboard" },
      { name: "description", content: "Your Paralegal AI workspace: log cases, chat with the AI agent, run reports and manage settings." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

type Tab = "log" | "chat" | "agent" | "settings";

function AppShell() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("log");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  if (loading || !user) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;

  return (
    <div className="min-h-screen bg-secondary pb-20">
      <header className="bg-primary text-primary-foreground px-5 py-3.5 flex items-center justify-between sticky top-0 z-10 shadow">
        <div className="flex items-center gap-2 font-bold"><Scale className="h-5 w-5" /> Paralegal AI</div>
        <button onClick={signOut} className="text-sm opacity-80 hover:opacity-100 flex items-center gap-1.5"><LogOut className="h-4 w-4" /> Sign out</button>
      </header>

      <main className="max-w-3xl mx-auto">
        {tab === "log" && <LogEntryTab />}
        {tab === "chat" && <ChatTab />}
        {tab === "agent" && <AgentTab />}
        {tab === "settings" && <SettingsTab />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-card border-t shadow-lg">
        <div className="max-w-3xl mx-auto grid grid-cols-4">
          <TabBtn active={tab === "log"} onClick={() => setTab("log")} icon={<ClipboardList className="h-5 w-5" />} label="Log Entry" />
          <TabBtn active={tab === "chat"} onClick={() => setTab("chat")} icon={<HatGlasses className="h-5 w-5" />} label="Agent" />
          <TabBtn active={tab === "agent"} onClick={() => setTab("agent")} icon={<Snail className="h-5 w-5" />} label="Automation" />
          <TabBtn active={tab === "settings"} onClick={() => setTab("settings")} icon={<SettingsIcon className="h-5 w-5" />} label="Settings" />
        </div>
      </nav>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
        active ? "text-accent" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

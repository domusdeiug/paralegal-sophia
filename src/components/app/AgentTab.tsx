import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Briefcase, Download } from "lucide-react";

type AgentKey = "excel" | "monthly" | "activity";

interface DownloadReady {
  url: string;
  filename: string;
}

export default function AgentTab() {
  const [active, setActive] = useState<AgentKey | null>(null);

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-xl font-bold text-primary mb-1">Agent Automations</h2>
      <p className="text-sm text-muted-foreground mb-4">Run automated workflows over your case data.</p>

      <AgentCard
        icon={<FileSpreadsheet />}
        title="Excel Export"
        desc="Download your case log for a date range as a spreadsheet."
        open={active === "excel"}
        onOpen={() => setActive(active === "excel" ? null : "excel")}
      >
        <ExcelRunner />
      </AgentCard>

      <AgentCard
        icon={<FileText />}
        title="Monthly Report"
        desc="Generate a narrative monthly or quarterly report as a Word document."
        open={active === "monthly"}
        onOpen={() => setActive(active === "monthly" ? null : "monthly")}
      >
        <DateRangeRunner
          endpoint="monthly-report"
          label="Generate Monthly Report"
          filename="monthly_report.docx"
          mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        />
      </AgentCard>

      <AgentCard
        icon={<Briefcase />}
        title="Activity Report"
        desc="Generate a field activity report for any period as a Word document."
        open={active === "activity"}
        onOpen={() => setActive(active === "activity" ? null : "activity")}
      >
        <DateRangeRunner
          endpoint="activity-report"
          label="Generate Activity Report"
          filename="activity_report.docx"
          mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        />
      </AgentCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentCard shell
// ---------------------------------------------------------------------------

function AgentCard({
  icon, title, desc, open, onOpen, children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  open: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
      <button
        onClick={onOpen}
        className="w-full text-left p-4 flex items-center gap-3 hover:bg-secondary"
      >
        <div className="h-10 w-10 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
          {icon}
        </div>
        <div className="flex-1">
          <div className="font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
        <span className="text-muted-foreground">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="border-t p-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared fetch helper — returns blob URL + filename, does NOT auto-download
// ---------------------------------------------------------------------------

async function invokeFetch(
  endpoint: string,
  body: Record<string, unknown>,
  fallbackFilename: string
): Promise<DownloadReady> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(await res.text());

  // Try to read filename from Content-Disposition
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^";\n]+)"?/);
  const filename = match ? match[1] : fallbackFilename;

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  return { url: blobUrl, filename };
}

// ---------------------------------------------------------------------------
// Download link component shown after a successful generation
// ---------------------------------------------------------------------------

function DownloadLink({ ready, onClear }: { ready: DownloadReady; onClear: () => void }) {
  const isCsv = ready.filename.endsWith(".csv");

  return (
    <div className="mt-3 space-y-2">
      <a
        href={ready.url}
        download={ready.filename}
        className="flex items-center gap-2 w-full rounded-md border border-primary text-primary px-3 py-2.5 text-sm font-semibold hover:bg-primary hover:text-primary-foreground transition-colors"
      >
        <Download className="h-4 w-4 shrink-0" />
        <span className="truncate">Tap to download — {ready.filename}</span>
      </a>

      {isCsv && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold">How to open:</span> Save the file, then open as Excel or open Microsoft
          Excel or Google Sheets and use <span className="font-medium">File → Open</span> to load
          it. On a phone, open it with the Sheets app or WPS Office.
        </p>
      )}

      <button
        onClick={onClear}
        className="text-xs text-muted-foreground hover:text-foreground underline"
      >
        Clear
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Excel Export — dedicated runner (date range picker)
// ---------------------------------------------------------------------------

function ExcelRunner() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<DownloadReady | null>(null);

  async function run() {
    if (ready) { URL.revokeObjectURL(ready.url); setReady(null); }
    setBusy(true);
    try {
      const result = await invokeFetch("excel-export", { from, to }, "case_log.csv");
      setReady(result);
      toast.success("File ready — tap the link below to download.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <label className="flex-1 text-xs font-semibold text-muted-foreground">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex-1 text-xs font-semibold text-muted-foreground">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <button
        onClick={run}
        disabled={busy}
        className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
      >
        {busy ? "Exporting…" : "Export to CSV"}
      </button>

      {ready && (
        <DownloadLink
          ready={ready}
          onClear={() => { URL.revokeObjectURL(ready.url); setReady(null); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic date-range runner (monthly report, activity report)
// ---------------------------------------------------------------------------

function DateRangeRunner({
  endpoint,
  label,
  filename,
  mime: _mime,
}: {
  endpoint: string;
  label: string;
  filename: string;
  mime: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<DownloadReady | null>(null);

  async function run() {
    if (ready) { URL.revokeObjectURL(ready.url); setReady(null); }
    setBusy(true);
    try {
      const result = await invokeFetch(endpoint, { from, to }, filename);
      setReady(result);
      toast.success("File ready — tap the link below to download.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <label className="flex-1 text-xs font-semibold text-muted-foreground">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex-1 text-xs font-semibold text-muted-foreground">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <button
        onClick={run}
        disabled={busy}
        className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
      >
        {busy ? "Generating…" : label}
      </button>

      {ready && (
        <DownloadLink
          ready={ready}
          onClear={() => { URL.revokeObjectURL(ready.url); setReady(null); }}
        />
      )}
    </div>
  );
}
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Send, Download, HatGlasses, MessageSquare, Loader2, History, X } from "lucide-react";
import { toast } from "sonner";
import MarkdownRenderer from "@/lib/MarkdownRenderer";

interface Msg {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  downloadUrl?: string;
  downloadLabel?: string;
}

interface HistoryEntry {
  run_id: string;
  prompt: string | null;
  output: Record<string, unknown>;
  created_at: string;
}

type Mode = "chat" | "agent";

const TOOL_LABELS: Record<string, string> = {
  search_laws_africa: "Laws.Africa",
  search_legal_corpus: "Legal Corpus",
  read_cases_db: "Case Database",
  web_search: "Web Search",
};

const CHAT_PROGRESS: Array<{ afterMs: number; msg: string }> = [
  { afterMs: 0,     msg: "Received your question, thinking…" },
  { afterMs: 5000,  msg: "Searching legal sources…" },
  { afterMs: 15000, msg: "Reviewing case law and precedents…" },
  { afterMs: 30000, msg: "Almost there, composing your answer…" },
];

const AGENT_PROGRESS: Array<{ afterMs: number; msg: string }> = [
  { afterMs: 0,      msg: "Analysing your request and extracting search keywords…" },
  { afterMs: 5000,   msg: "Searching Ugandan case law…" },
  { afterMs: 12000,  msg: "Querying your legal corpus for relevant precedents…" },
  { afterMs: 20000,  msg: "Retrieving sample court submissions for format reference…" },
  { afterMs: 30000,  msg: "All context gathered. Drafting your court submission…" },
  { afterMs: 75000,  msg: "Still drafting — complex submissions take a moment…" },
  { afterMs: 130000, msg: "Almost there, finalising and formatting the document…" },
];

function getProgressMsg(mode: Mode, elapsedMs: number): string {
  const steps = mode === "chat" ? CHAT_PROGRESS : AGENT_PROGRESS;
  let current = steps[0].msg;
  for (const step of steps) {
    if (elapsedMs >= step.afterMs) current = step.msg;
  }
  return current;
}

function groupByDay(entries: HistoryEntry[]): Record<string, HistoryEntry[]> {
  const groups: Record<string, HistoryEntry[]> = {};
  for (const e of entries) {
    const day = new Date(e.created_at).toLocaleDateString("en-UG", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    if (!groups[day]) groups[day] = [];
    groups[day].push(e);
  }
  return groups;
}

export default function ChatTab() {
  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi, I'm Sophia, your paralegal assistant. How can I assist you today? Please switch to Agent mode to draft court submissions.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");

  // History panel
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, progressMsg]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setExpandedEntry(null);
    try {
      const { data, error } = await supabase
        .from("task_results")
        .select("run_id, prompt, output, created_at")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      setHistoryEntries((data as HistoryEntry[]) ?? []);
    } catch (e) {
      toast.error("Could not load history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistory() {
    setHistoryOpen(false);
    setExpandedEntry(null);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const userMsg: Msg = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setProgressMsg(getProgressMsg(mode, 0));

    const apiMessages = nextMessages.map((m) => ({ role: m.role, content: m.content }));

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Not signed in");
      setBusy(false);
      setProgressMsg("");
      return;
    }

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
    const abort = new AbortController();
    abortRef.current = abort;

    let runId: string | null = null;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: apiMessages, mode }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(await res.text());

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const eventLine = part.match(/^event: (.+)$/m)?.[1];
          const dataLine = part.match(/^data: (.+)$/m)?.[1];
          if (!eventLine || !dataLine) continue;

          let parsed: Record<string, unknown>;
          try { parsed = JSON.parse(dataLine); } catch { continue; }

          if (eventLine === "started") {
            runId = parsed.runId as string;
          } else if (eventLine === "error") {
            throw new Error((parsed.message as string) ?? "Failed to start task");
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") return;
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setProgressMsg("");
      return;
    }

    if (!runId) {
      toast.error("Failed to start task — no run ID received");
      setBusy(false);
      setProgressMsg("");
      return;
    }

    const startedAt = Date.now();

    pollRef.current = setInterval(async () => {
      setProgressMsg(getProgressMsg(mode, Date.now() - startedAt));

      try {
        const { data, error } = await supabase
          .from("task_results")
          .select("status, output")
          .eq("run_id", runId)
          .maybeSingle();

        if (error) { console.error("Poll error:", error); return; }
        if (!data) return;

        if (data.status === "completed") {
          stopPolling();
          setBusy(false);
          setProgressMsg("");

          const output = data.output as Record<string, unknown>;

          if (mode === "chat") {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: (output.reply as string) ?? "(no reply)",
                toolsUsed: (output.toolsUsed as string[]) ?? [],
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: output.summary as string,
                downloadUrl: output.downloadUrl as string,
                downloadLabel: "Download Court Submission (.docx)",
              },
            ]);
          }
        } else if (data.status === "failed") {
          stopPolling();
          setBusy(false);
          setProgressMsg("");
          const output = data.output as Record<string, unknown>;
          toast.error((output?.error as string) ?? "Task failed");
        }
      } catch (err) {
        console.error("Poll exception:", err);
      }
    }, 3000);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const chatPlaceholder = "Ask me anything about cases or law…";
  const agentPlaceholder =
    "Describe the case or legal scenario — e.g. 'prepare defense for aggravated robbery' or 'draft bail application for LAC/2024/001 John Doe'";

  const grouped = groupByDay(historyEntries);

  return (
    <div className="relative flex flex-col h-[calc(100vh-120px)] overflow-hidden">

      {/* Mode Toggle + History button */}
      <div className="flex items-center gap-1 p-3 border-b bg-card">
        <button
          onClick={() => setMode("chat")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            mode === "chat"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Chat
        </button>
        <button
          onClick={() => setMode("agent")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            mode === "agent"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
        >
          <HatGlasses className="h-3.5 w-3.5" />
          Agent
        </button>
        {mode === "agent" && (
          <span className="ml-2 text-xs text-muted-foreground italic">
            Drafts court submissions
          </span>
        )}

        {/* History toggle */}
        <button
          onClick={historyOpen ? closeHistory : openHistory}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title="View history"
        >
          <History className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">History</span>
        </button>
      </div>

      {/* Main area: chat + sliding history panel */}
      <div className="relative flex-1 overflow-hidden">

        {/* Chat messages */}
        <div className="h-full overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                    : "bg-card border shadow-sm"
                }`}
              >
                {m.role === "assistant" ? (
                  <MarkdownRenderer content={m.content} />
                ) : (
                  m.content
                )}

                {m.toolsUsed && m.toolsUsed.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.toolsUsed.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border"
                      >
                        {TOOL_LABELS[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}

                {m.downloadUrl && (
                  <a
                    href={m.downloadUrl}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs font-semibold hover:bg-accent transition-colors w-fit"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {m.downloadLabel ?? "Download"}
                  </a>
                )}
              </div>
            </div>
          ))}

          {busy && progressMsg && (
            <div className="flex justify-start">
              <div className="max-w-[82%] rounded-2xl px-4 py-2.5 text-sm bg-card border shadow-sm flex items-center gap-2 text-muted-foreground italic">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                {progressMsg}
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* Backdrop — tap outside panel to close */}
        {historyOpen && (
          <div
            className="absolute inset-0 z-10"
            onClick={closeHistory}
          />
        )}

        {/* History slide-in panel */}
        <div
          className={`absolute top-0 right-0 h-full z-20 bg-card border-l shadow-xl flex flex-col
            transition-transform duration-300 ease-in-out
            w-[85vw] sm:w-72
            ${historyOpen ? "translate-x-0" : "translate-x-full"}`}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <span className="font-semibold text-sm text-foreground">History</span>
            <button onClick={closeHistory} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {historyLoading && (
              <div className="flex justify-center pt-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!historyLoading && historyEntries.length === 0 && (
              <p className="text-xs text-muted-foreground text-center pt-8">No history yet.</p>
            )}

            {!historyLoading && Object.entries(grouped).map(([day, entries]) => (
              <div key={day}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {day}
                </p>
                <div className="space-y-1">
                  {entries.map((entry) => {
                    const isExpanded = expandedEntry === entry.run_id;
                    const reply = (entry.output?.reply as string) ?? (entry.output?.summary as string);
                    const downloadUrl = entry.output?.downloadUrl as string | undefined;

                    return (
                      <div key={entry.run_id} className="rounded-md border overflow-hidden">
                        <button
                          onClick={() => setExpandedEntry(isExpanded ? null : entry.run_id)}
                          className="w-full text-left px-3 py-2 hover:bg-secondary transition-colors"
                        >
                          <p className="text-xs font-medium text-foreground truncate">
                            {entry.prompt ?? "(no prompt saved)"}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(entry.created_at).toLocaleTimeString("en-UG", {
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </p>
                        </button>

                        {isExpanded && (
                          <div className="border-t px-3 py-3 bg-background text-xs space-y-2">
                            {reply ? (
                              <MarkdownRenderer content={reply} />
                            ) : (
                              <p className="text-muted-foreground italic">No text output.</p>
                            )}
                            {downloadUrl && (
                              <a
                                href={downloadUrl}
                                download
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:bg-accent transition-colors"
                              >
                                <Download className="h-3 w-3" />
                                Download document
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="p-3 bg-card border-t flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === "chat" ? chatPlaceholder : agentPlaceholder}
          rows={mode === "agent" ? 2 : 1}
          className="flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none"
          disabled={busy}
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 hover:bg-accent disabled:opacity-50 transition-colors self-end"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

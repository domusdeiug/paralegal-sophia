import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Upload, Trash2, FileText, Loader2 } from "lucide-react";

type Kind = "monthly_report" | "activity_report" | "court_submission" | "legal_corpus";

interface Profile {
  username: string | null;
  subscription_tier: "Basic" | "Pro" | "Premium";
  token_count: number;
}

interface DocRow {
  id: string;
  kind: Kind;
  file_name: string;
  storage_path: string;
  created_at: string;
}

const SLOTS: { kind: Kind; label: string; hint?: string }[] = [
  { kind: "monthly_report", label: "Monthly report sample", hint: "1-2 word docs of not more than 4 pages of your monthly reports" },
  { kind: "activity_report", label: "Activity report sample" , hint: "1-2 docs of not more than 4 pages of your activity reports; make them diverse."},
  { kind: "court_submission", label: "Court submission sample", hint: "1-2 docs of your court submissions." },
  { kind: "legal_corpus", label: "My legal corpus", hint: "Attach all the case files you want your agent to know. Avoid files with pictures." },
];

export default function SettingsTab() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [username, setUsername] = useState("");
  const [savingName, setSavingName] = useState(false);

  async function load() {
    if (!user) return;
    const [{ data: p }, { data: d }] = await Promise.all([
      supabase.from("profiles").select("username, subscription_tier, token_count").eq("id", user.id).maybeSingle(),
      supabase.from("user_documents").select("id, kind, file_name, storage_path, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    if (p) { setProfile(p as Profile); setUsername(p.username ?? ""); }
    setDocs((d ?? []) as DocRow[]);
  }

  useEffect(() => { load(); }, [user]);

  async function saveUsername() {
    if (!user) return;
    setSavingName(true);
    const { error } = await supabase.from("profiles").update({ username }).eq("id", user.id);
    setSavingName(false);
    if (error) toast.error(error.message); else { toast.success("Username updated"); load(); }
  }

  if (!profile) return <div className="p-6 text-muted-foreground">Loading…</div>;

  // Group docs by kind (most recent first for each)
  const docsByKind = new Map<Kind, DocRow[]>();
  for (const d of docs) {
    if (!docsByKind.has(d.kind)) docsByKind.set(d.kind, []);
    docsByKind.get(d.kind)!.push(d);
  }

  return (
    <div className="p-4 space-y-5">
      <h2 className="text-xl font-bold text-primary">Settings</h2>

      <section className="bg-card border rounded-lg p-5 space-y-4">
        <h3 className="font-semibold">Account</h3>
        <div>
          <label className="block text-xs font-bold text-accent uppercase tracking-wide mb-1.5">Username</label>
          <div className="flex gap-2">
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              className="flex-1 rounded-md border px-3 py-2 text-sm" placeholder="Your name" />
            <button onClick={saveUsername} disabled={savingName}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-accent disabled:opacity-50">
              Save
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Subscription" value={profile.subscription_tier} />
          <Stat label="Tokens used" value={profile.token_count.toLocaleString()} />
        </div>
        <button onClick={signOut} className="text-sm text-destructive hover:underline">Sign out</button>
      </section>

      <section className="bg-card border rounded-lg p-5 space-y-4">
        <div>
          <h3 className="font-semibold">Context documents</h3>
          <p className="text-xs text-muted-foreground mt-1">Upload documents per slot for style reference. Follow the instructions in the slot</p>
        </div>
        {SLOTS.map((slot) => (
          <Slot key={slot.kind} slot={slot} docs={docsByKind.get(slot.kind) ?? []} onChange={load} />
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function Slot({ slot, docs, onChange }: { slot: { kind: Kind; label: string; hint?: string }; docs: DocRow[]; onChange: () => void }) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setBusy(true);
    try {
      const path = `${user.id}/${slot.kind}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("user-documents").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from("user_documents").insert({
        user_id: user.id, kind: slot.kind, file_name: file.name,
        storage_path: path, mime_type: file.type, size_bytes: file.size,
      });
      if (dbErr) throw dbErr;
      toast.success("Uploaded");
      onChange();
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(doc: DocRow) {
    if (!confirm(`Delete ${doc.file_name}?`)) return;
    await supabase.storage.from("user-documents").remove([doc.storage_path]);
    await supabase.from("user_documents").delete().eq("id", doc.id);
    toast.success("Deleted");
    onChange();
  }

  return (
    <div className="border rounded-md p-3 bg-secondary/40">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-foreground">{slot.label}</div>
          {slot.hint && <div className="text-[11px] text-muted-foreground">{slot.hint}</div>}
        </div>
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent text-accent-foreground px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
        </button>
        <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.txt,.md" onChange={upload} />
      </div>
      {docs.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No files yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 bg-card border rounded px-2.5 py-1.5">
              <span className="flex items-center gap-2 text-xs truncate"><FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />{d.file_name}</span>
              <button onClick={() => remove(d)} className="text-destructive hover:bg-destructive/10 rounded p-1">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

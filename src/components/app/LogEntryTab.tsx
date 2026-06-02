import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

interface FormState {
  date: string; oldNew: string; lacFileNo: string; courtCaseNo: string;
  clientName: string; sex: string; age: string; residence: string;
  natureOfCase: string; natureOfCaseOther: string; vulnerability: string;
  actionTaken: string; actionTakenOther: string; status: string;
  statusOther: string; notes: string;
}

type LookupState = "idle" | "loading" | "found" | "notfound";

const today = () => new Date().toISOString().split("T")[0];

const NATURE_OPTIONS = ["Criminal","Criminal / Theft","Criminal / Assault","Criminal / Housebreaking","Civil","Civil / Land","Civil / Breach of Contract","Civil / Administration of Estates","Family","Family / Divorce","Family / Maintenance","__other__"];
const ACTION_OPTIONS = ["Legal Representation","Interview","Legal Advice","Drafted Pleadings","Legal Advice + Drafted Pleadings","Plea Bargain","__other__"];
const STATUS_OPTIONS = ["Ongoing","Closed","Dismissed — Want of Prosecution","Plea Bargained — Time on Remand","Plea Bargained — Community Service","Prosecution Hearing","Defence Hearing","On Judgement","Bail Granted","Closed — Reconciliation","Mediation","Pending","__other__"];
const VULNERABILITY_OPTIONS = ["Incarceration","Indigent","Financial","Unsound Mind","Incarceration + Indigent"];

function SelectOrOther({ id, options, value, otherValue, onChange, onOtherChange, placeholder = "Specify…" }: {
  id: string; options: string[]; value: string; otherValue: string;
  onChange: (v: string) => void; onOtherChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="lac-select">
        <option value="">— Select —</option>
        {options.map((o) =>
          o === "__other__" ? <option key="other" value="__other__">Other (specify)</option> : <option key={o} value={o}>{o}</option>
        )}
      </select>
      {value === "__other__" && (
        <input type="text" value={otherValue} onChange={(e) => onOtherChange(e.target.value)} placeholder={placeholder} className="lac-input lac-other-input" />
      )}
    </>
  );
}

export default function LogEntryTab() {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>({
    date: today(), oldNew: "", lacFileNo: "", courtCaseNo: "", clientName: "",
    sex: "", age: "", residence: "", natureOfCase: "", natureOfCaseOther: "",
    vulnerability: "", actionTaken: "", actionTakenOther: "", status: "",
    statusOther: "", notes: "",
  });
  const [lookup, setLookup] = useState<{ state: LookupState; message: string }>({ state: "idle", message: "" });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setE = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k)(e.target.value);
  const resolved = (a: keyof FormState, b: keyof FormState) => form[a] === "__other__" ? form[b] : form[a];

  async function lookupClient() {
    const fileNo = form.lacFileNo.trim();
    if (!fileNo) return;
    setLookup({ state: "loading", message: "Looking up…" });
    const { data } = await supabase.from("cases")
      .select("client_name, sex, age, residence, vulnerability")
      .eq("lac_file_no", fileNo).order("date", { ascending: false }).limit(1).maybeSingle();
    if (!data) {
      setLookup({ state: "notfound", message: "No client found. Fill in details as a new client." });
      setForm((f) => ({ ...f, oldNew: "New" }));
      return;
    }
    setForm((f) => ({ ...f,
      clientName: data.client_name ?? "", sex: data.sex ?? "",
      age: data.age?.toString() ?? "", residence: data.residence ?? "",
      vulnerability: data.vulnerability ?? "", oldNew: "Old",
    }));
    setLookup({ state: "found", message: "Returning client found — details filled in." });
  }

  function validate() {
    const req: Partial<Record<keyof FormState, string>> = {
      date: "Date", lacFileNo: "LAC File No", clientName: "Full Name",
      sex: "Sex", oldNew: "Client Type", vulnerability: "Vulnerability",
    };
    const errs: Partial<Record<keyof FormState, string>> = {};
    (Object.entries(req) as [keyof FormState, string][]).forEach(([k, label]) => {
      if (!form[k]?.toString().trim()) errs[k] = `${label} is required`;
    });
    return errs;
  }

  async function saveEntry() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({}); setSaving(true);
    const { error } = await supabase.from("cases").insert({
      user_id: user!.id,
      date: form.date,
      old_new: form.oldNew,
      lac_file_no: form.lacFileNo.trim(),
      court_case_no: form.courtCaseNo.trim() || null,
      client_name: form.clientName.trim(),
      sex: form.sex,
      age: form.age ? parseInt(form.age, 10) : null,
      residence: form.residence.trim() || null,
      nature_of_case: resolved("natureOfCase", "natureOfCaseOther") || null,
      vulnerability: form.vulnerability,
      action_taken: resolved("actionTaken", "actionTakenOther") || null,
      status: resolved("status", "statusOther") || null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error("Save failed: " + error.message); return; }
    toast.success("Case entry saved");
    setForm({
      date: today(), oldNew: "", lacFileNo: "", courtCaseNo: "", clientName: "",
      sex: "", age: "", residence: "", natureOfCase: "", natureOfCaseOther: "",
      vulnerability: "", actionTaken: "", actionTakenOther: "", status: "",
      statusOther: "", notes: "",
    });
    setLookup({ state: "idle", message: "" });
  }

  return (
    <>
      <style>{`
        :root {
          --lac-navy: #1a3a5c; --lac-blue: #2d6a9f; --lac-blue-light: rgba(45,106,159,0.10);
          --lac-surface: #f5f7fa; --lac-card: #fff; --lac-border: #dce3ed;
          --lac-text: #1a1a2e; --lac-muted: #6b7280; --lac-danger: #e53935;
          --lac-success-bg: #e8f5e9; --lac-success-border: #a5d6a7; --lac-success-text: #2e7d32;
          --lac-warn-bg: #fff3e0; --lac-warn-border: #ffcc80; --lac-warn-text: #e65100;
        }
        .lac-page { padding: 24px 16px 80px; font-family: 'Segoe UI', system-ui, sans-serif; color: var(--lac-text); font-size: 14px; }
        .lac-card { max-width: 720px; margin: 0 auto; background: var(--lac-card); border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,0.06); overflow: hidden; }
        .lac-header { background: var(--lac-navy); color: #fff; padding: 20px 28px; }
        .lac-header h1 { font-size: 17px; font-weight: 700; }
        .lac-header-sub { font-size: 12px; opacity: 0.65; margin-top: 2px; }
        .lac-body { padding: 24px 28px; }
        .lac-section { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--lac-muted); border-bottom: 1px solid var(--lac-border); padding-bottom: 6px; margin: 20px 0 14px; }
        .lac-section:first-child { margin-top: 0; }
        .lac-row { display: flex; gap: 12px; margin-bottom: 12px; }
        .lac-field { display: flex; flex-direction: column; flex: 1; min-width: 0; }
        .lac-label { font-size: 11px; font-weight: 700; color: var(--lac-blue); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 5px; }
        .lac-label.required::after { content: ' *'; color: var(--lac-danger); }
        .lac-input, .lac-select, .lac-textarea { border: 1.5px solid var(--lac-border); border-radius: 8px; padding: 8px 11px; font-size: 13.5px; font-family: inherit; background: #fff; color: var(--lac-text); width: 100%; transition: border-color .18s, box-shadow .18s; appearance: none; -webkit-appearance: none; }
        .lac-select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px; }
        .lac-input:focus, .lac-select:focus, .lac-textarea:focus { outline: none; border-color: var(--lac-blue); box-shadow: 0 0 0 3px var(--lac-blue-light); }
        .lac-input.error, .lac-select.error { border-color: var(--lac-danger); }
        .lac-textarea { resize: vertical; min-height: 70px; }
        .lac-other-input { margin-top: 6px; }
        .lac-lookup-row { display: flex; gap: 8px; align-items: flex-end; }
        .lac-lookup-row .lac-input { flex: 1; }
        .lac-banner { border-radius: 8px; padding: 10px 14px; font-size: 12.5px; margin-bottom: 14px; line-height: 1.4; }
        .lac-banner.found { background: var(--lac-success-bg); border: 1px solid var(--lac-success-border); color: var(--lac-success-text); }
        .lac-banner.notfound { background: var(--lac-warn-bg); border: 1px solid var(--lac-warn-border); color: var(--lac-warn-text); }
        .lac-banner.loading { background: #f0f4f8; border: 1px solid var(--lac-border); color: var(--lac-muted); }
        .lac-error-text { font-size: 11px; color: var(--lac-danger); margin-top: 3px; }
        .lac-footer { padding: 16px 28px; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--lac-border); background: #fafbfc; }
        .lac-btn { border-radius: 8px; padding: 9px 22px; font-size: 13.5px; font-weight: 600; font-family: inherit; cursor: pointer; transition: background .18s, opacity .18s; border: none; }
        .lac-btn-primary { background: var(--lac-navy); color: #fff; }
        .lac-btn-primary:hover:not(:disabled) { background: var(--lac-blue); }
        .lac-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
        .lac-btn-lookup { background: var(--lac-blue); color: #fff; border-radius: 8px; padding: 8px 14px; font-size: 12.5px; font-weight: 600; border: none; cursor: pointer; white-space: nowrap; }
        .lac-btn-lookup:hover { background: var(--lac-navy); }
        .lac-field-sm { max-width: 90px; } .lac-field-md { max-width: 130px; }
        @media (max-width: 560px) {
          .lac-row { flex-direction: column; }
          .lac-field-sm, .lac-field-md { max-width: 100%; }
          .lac-body { padding: 18px 16px; } .lac-footer { padding: 14px 16px; } .lac-header { padding: 16px 18px; }
        }
      `}</style>

      <div className="lac-page">
        <div className="lac-card">
          <div className="lac-header">
            <h1>New Case Entry</h1>
            <div className="lac-header-sub">Case Management</div>
          </div>

          <div className="lac-body">
            <div className="lac-section">Date & Classification</div>
            <div className="lac-row">
              <div className="lac-field">
                <label className="lac-label required" htmlFor="date">Date of Interaction</label>
                <input type="date" id="date" className={`lac-input${errors.date ? " error" : ""}`} value={form.date} onChange={setE("date")} />
                {errors.date && <span className="lac-error-text">{errors.date}</span>}
              </div>
              <div className="lac-field lac-field-md">
                <label className="lac-label required" htmlFor="oldNew">Client Type</label>
                <select id="oldNew" className={`lac-select${errors.oldNew ? " error" : ""}`} value={form.oldNew} onChange={setE("oldNew")}>
                  <option value="">— Select —</option>
                  <option value="New">New</option>
                  <option value="Old">Old / Returning</option>
                </select>
                {errors.oldNew && <span className="lac-error-text">{errors.oldNew}</span>}
              </div>
            </div>

            <div className="lac-section">File Numbers</div>
            <div className="lac-row">
              <div className="lac-field">
                <label className="lac-label required" htmlFor="lacFileNo">LAC File No</label>
                <div className="lac-lookup-row">
                  <input type="text" id="lacFileNo" className={`lac-input${errors.lacFileNo ? " error" : ""}`} placeholder="e.g. CRIM/150/2026" value={form.lacFileNo} onChange={setE("lacFileNo")} onKeyDown={(e) => e.key === "Enter" && lookupClient()} />
                  <button className="lac-btn-lookup" onClick={lookupClient}>Look Up</button>
                </div>
                {errors.lacFileNo && <span className="lac-error-text">{errors.lacFileNo}</span>}
              </div>
              <div className="lac-field">
                <label className="lac-label" htmlFor="courtCaseNo">CRB / Court Case No</label>
                <input type="text" id="courtCaseNo" className="lac-input" placeholder="e.g. 204/2026 or NA" value={form.courtCaseNo} onChange={setE("courtCaseNo")} />
              </div>
            </div>

            {lookup.state !== "idle" && (
              <div className={`lac-banner ${lookup.state}`}>
                {lookup.state === "found" && "✓ "}{lookup.state === "notfound" && "✗ "}{lookup.message}
              </div>
            )}

            <div className="lac-section">Client Details</div>
            <div className="lac-row">
              <div className="lac-field">
                <label className="lac-label required" htmlFor="clientName">Full Name</label>
                <input type="text" id="clientName" className={`lac-input${errors.clientName ? " error" : ""}`} placeholder="e.g. Nabakooza Regina" value={form.clientName} onChange={setE("clientName")} />
                {errors.clientName && <span className="lac-error-text">{errors.clientName}</span>}
              </div>
              <div className="lac-field lac-field-sm">
                <label className="lac-label required" htmlFor="sex">Sex</label>
                <select id="sex" className={`lac-select${errors.sex ? " error" : ""}`} value={form.sex} onChange={setE("sex")}>
                  <option value="">—</option><option value="Male">Male</option><option value="Female">Female</option>
                </select>
                {errors.sex && <span className="lac-error-text">{errors.sex}</span>}
              </div>
              <div className="lac-field lac-field-sm">
                <label className="lac-label" htmlFor="age">Age</label>
                <input type="number" id="age" className="lac-input" min="1" max="120" placeholder="—" value={form.age} onChange={setE("age")} />
              </div>
            </div>
            <div className="lac-row">
              <div className="lac-field">
                <label className="lac-label" htmlFor="residence">Residence</label>
                <input type="text" id="residence" className="lac-input" placeholder="e.g. Mbarara" value={form.residence} onChange={setE("residence")} />
              </div>
            </div>

            <div className="lac-section">Case Details</div>
            <div className="lac-row">
              <div className="lac-field">
                <label className="lac-label" htmlFor="natureOfCase">Nature of Case</label>
                <SelectOrOther id="natureOfCase" options={NATURE_OPTIONS} value={form.natureOfCase} otherValue={form.natureOfCaseOther} onChange={set("natureOfCase")} onOtherChange={set("natureOfCaseOther")} placeholder="Describe nature of case" />
              </div>
              <div className="lac-field">
                <label className="lac-label required" htmlFor="vulnerability">Client Vulnerability</label>
                <select id="vulnerability" className={`lac-select${errors.vulnerability ? " error" : ""}`} value={form.vulnerability} onChange={setE("vulnerability")}>
                  <option value="">— Select —</option>
                  {VULNERABILITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {errors.vulnerability && <span className="lac-error-text">{errors.vulnerability}</span>}
              </div>
            </div>

            <div className="lac-row">
              <div className="lac-field">
                <label className="lac-label" htmlFor="actionTaken">Action Taken</label>
                <SelectOrOther id="actionTaken" options={ACTION_OPTIONS} value={form.actionTaken} otherValue={form.actionTakenOther} onChange={set("actionTaken")} onOtherChange={set("actionTakenOther")} placeholder="Describe action taken" />
              </div>
              <div className="lac-field">
                <label className="lac-label" htmlFor="status">Status</label>
                <SelectOrOther id="status" options={STATUS_OPTIONS} value={form.status} otherValue={form.statusOther} onChange={set("status")} onOtherChange={set("statusOther")} placeholder="Describe status" />
              </div>
            </div>

            <div className="lac-row">
              <div className="lac-field">
                <label className="lac-label" htmlFor="notes">Notes</label>
                <textarea id="notes" className="lac-textarea" placeholder="Any additional notes…" value={form.notes} onChange={setE("notes")} />
              </div>
            </div>
          </div>

          <div className="lac-footer">
            <button className="lac-btn lac-btn-primary" onClick={saveEntry} disabled={saving}>
              {saving ? "Saving…" : "Save Entry"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// ---------------------------------------------------------------------------
// Column definitions — DB field → display header, in required order
// ---------------------------------------------------------------------------
const COLUMNS: { field: string; header: string }[] = [
  { field: "date",          header: "DATE" },
  { field: "client_name",   header: "NAME" },
  { field: "sex",           header: "SEX" },
  { field: "age",           header: "AGE" },
  { field: "residence",     header: "RESIDENCE" },
  { field: "lac_file_no",   header: "LAC FILE.NO" },
  { field: "court_case_no", header: "CRB/COURT CASE NO." },
  { field: "old_new",       header: "OLD/NEW" },
  { field: "nature_of_case",header: "NATURE OF CASE" },
  { field: "vulnerability", header: "CLIENT'S VULNERABILITY" },
  { field: "action_taken",  header: "ACTION TAKEN" },
  { field: "status",        header: "STATUS" },
];

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function escCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowToCsv(row: Record<string, unknown>): string {
  return COLUMNS.map((c) => escCsv(row[c.field])).join(",");
}

// Format a date string (YYYY-MM-DD) as a readable day label
function dayLabel(dateStr: string): string {
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// Build CSV with day-group headers inserted between days
function buildCsv(rows: Record<string, unknown>[]): string {
  const headerRow = COLUMNS.map((c) => escCsv(c.header)).join(",");
  if (rows.length === 0) return headerRow;

  const lines: string[] = [headerRow];
  let currentDay = "";

  for (const row of rows) {
    const rowDay = String(row["date"] ?? "").slice(0, 10);
    if (rowDay !== currentDay) {
      currentDay = rowDay;
      // Day separator row: label in first cell, rest empty
      const emptyCells = ",".repeat(COLUMNS.length - 1);
      lines.push(`${escCsv(dayLabel(currentDay))}${emptyCells}`);
    }
    lines.push(rowToCsv(row));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { supabase, user } = await requireUser(req);
    const { from, to } = await req.json();

    if (!from || !to) {
      return new Response(
        JSON.stringify({ error: "from and to dates required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data, error } = await supabase
      .from("cases")
      .select(
        "date, client_name, sex, age, residence, lac_file_no, court_case_no, old_new, nature_of_case, vulnerability, action_taken, status"
      )
      .eq("user_id", user.id)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });

    if (error) throw error;

    const csv = buildCsv((data ?? []) as Record<string, unknown>[]);
    const filename = `case_log_${from}_to_${to}.csv`;

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    if (e instanceof Response)
      return new Response(e.body, { status: e.status, headers: corsHeaders });
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
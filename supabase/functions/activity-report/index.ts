import { generateReport } from "../_shared/report.ts";
Deno.serve((req) => generateReport(req, "activity_report", "Activity Report"));

import { generateReport } from "../_shared/report.ts";
Deno.serve((req) => generateReport(req, "monthly_report", "Monthly Report"));

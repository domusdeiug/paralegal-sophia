import { generateReport } from "../_shared/report.ts";
Deno.serve((req) => generateReport(req, "court_submission", "Court Submission"));

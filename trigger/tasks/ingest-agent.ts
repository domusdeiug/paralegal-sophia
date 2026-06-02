// trigger/tasks/ingest-agent.ts

import { task, logger } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { callLLM } from "../lib/llm";
import {
  searchLawsAfrica,
  searchLegalCorpus,
  readCasesFromDB,
  fetchSampleSubmissions,
} from "../lib/tools";
import { markdownToDocxBuffer } from "../lib/docx";

export interface AgentInput {
  query: string;
  userId: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface AgentOutput {
  downloadUrl: string;
  summary: string;
  keywords: string[];
}

// ---------------------------------------------------------------------------
// Supabase client (shared across steps)
// ---------------------------------------------------------------------------

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { realtime: { transport: ws } }
  );
}

// ---------------------------------------------------------------------------
// Step 1: Extract keywords and classify the query
// ---------------------------------------------------------------------------

interface QueryAnalysis {
  keywords: string[];
  legalTopic: string;
  isRealCase: boolean;
  caseIdentifier: string;
  submissionType: string;
}

async function analyseQuery(query: string): Promise<QueryAnalysis> {
  const prompt = `You are a legal assistant. Analyse this request and return ONLY valid JSON, no markdown, no explanation.

Request: "${query}"

Return this exact JSON shape:
{
  "keywords": [eg. "aggravated robbery defense"],
  "legalTopic": "short topic label",
  "isRealCase": true or false,
  "caseIdentifier": "client name or file number, or empty string",
  "submissionType": "type of submission being requested"
}

Rules:
- keywords: 3-6 specific legal terms relevant for case law search (crime type, legal doctrine, etc.)
- isRealCase: true if user mentions a client name or file/case number
- caseIdentifier: extract the client name or file number if present, else ""
- submissionType: identify what document is being drafted (defense submission, bail application, plea in mitigation, etc.)`;

  const response = await callLLM(
    [
      { role: "system", content: "You extract structured data from legal requests. Return only valid JSON." },
      { role: "user", content: prompt },
    ],
    undefined,
    { max_tokens: 512 }
  );

  try {
    const text = (response.content ?? "").replace(/```json|```/g, "").trim();
    return JSON.parse(text) as QueryAnalysis;
  } catch {
    return {
      keywords: query.split(" ").slice(0, 5),
      legalTopic: query.slice(0, 60),
      isRealCase: false,
      caseIdentifier: "",
      submissionType: "court submission",
    };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Parallel context build
// ---------------------------------------------------------------------------

interface Context {
  judgments: string;
  corpusExcerpts: string;
  sampleSubmission: string;
  caseRecord: string;
}

async function buildContext(analysis: QueryAnalysis, userId: string): Promise<Context> {
  const keywordString = analysis.keywords.join(" ");
  logger.info("Building context in parallel", { keywords: analysis.keywords });

  const [judgments, corpusExcerpts, sampleSubmission, caseRecord] =
    await Promise.allSettled([
      searchLawsAfrica(keywordString),
      searchLegalCorpus(keywordString, userId),
      fetchSampleSubmissions(userId),
      analysis.isRealCase && analysis.caseIdentifier
        ? readCasesFromDB(analysis.caseIdentifier, userId)
        : Promise.resolve(""),
    ]);

  const ctx = {
    judgments: settled(judgments, "No judgment results available.", "searchLawsAfrica"),
    corpusExcerpts: settled(corpusExcerpts, "No corpus excerpts available.", "searchLegalCorpus"),
    sampleSubmission: settled(sampleSubmission, "", "fetchSampleSubmissions"),
    caseRecord: settled(caseRecord, "", "readCasesFromDB"),
  };

  logger.info("Context build complete", {
    judgments_chars: ctx.judgments.length,
    judgments_empty: ctx.judgments === "No judgment results available.",
    judgments_preview: ctx.judgments.slice(0, 200),
    corpusExcerpts_chars: ctx.corpusExcerpts.length,
    corpusExcerpts_empty: ctx.corpusExcerpts === "No corpus excerpts available.",
    corpusExcerpts_preview: ctx.corpusExcerpts.slice(0, 200),
    sampleSubmission_chars: ctx.sampleSubmission.length,
    caseRecord_chars: ctx.caseRecord.length,
    caseRecord_preview: ctx.caseRecord.slice(0, 200),
  });

  return ctx;
}

function settled<T extends string>(result: PromiseSettledResult<T>, fallback: string, toolName: string): string {
  if (result.status === "fulfilled") {
    if (!result.value) {
      logger.warn("Tool returned empty result", { tool: toolName });
      return fallback;
    }
    return result.value;
  }
  logger.warn("Tool threw an error", { tool: toolName, reason: String(result.reason) });
  return fallback;
}

// ---------------------------------------------------------------------------
// Step 3: Draft the submission
// ---------------------------------------------------------------------------

const DRAFTING_SYSTEM = `You are an expert Ugandan legal drafter with deep knowledge of Ugandan courts, procedure, and case law.
You produce formal, professional court submissions formatted for filing in Ugandan courts.
Write in clear legal English. Use proper legal headings and structure.
Your output is Markdown that will be converted to a Word document for filing.`;

async function draftSubmission(
  query: string,
  analysis: QueryAnalysis,
  ctx: Context
): Promise<string> {
  const formatGuide = ctx.sampleSubmission
    ? `\n\n=== FORMAT REFERENCE (follow this structure and style) ===\n${ctx.sampleSubmission.slice(0, 3000)}`
    : "";

  const caseSection = ctx.caseRecord
    ? `\n\n=== CLIENT CASE RECORD ===\n${ctx.caseRecord}`
    : "";

  const prompt = `## Task
Draft a complete ${analysis.submissionType} for the following request:

**Request:** ${query}
**Legal Topic:** ${analysis.legalTopic}
${analysis.isRealCase ? `**Client/Case:** ${analysis.caseIdentifier}` : "**Type:** General legal scenario — draft as a template with [PLACEHOLDER] for case-specific details"}

## Available Legal Authorities

=== RELEVANT UGANDAN JUDGMENTS (Laws.Africa) ===
${ctx.judgments}

=== LEGAL CORPUS EXCERPTS ===
${ctx.corpusExcerpts}
${caseSection}${formatGuide}

## Instructions
1. Reason over all the legal authorities above to identify the strongest arguments
2. Structure the submission with proper Ugandan court formatting as shown in the sample as appropriate
3. Cite the relevant judgments you found by name and citation
4. Write complete, filing-ready content — not an outline
5. For hypothetical scenarios, use [CLIENT NAME], [CASE NUMBER], [DATE] placeholders
6. End with a proper prayers/relief section`;

  logger.info("Drafting submission — context sizes", {
    judgments_chars: ctx.judgments.length,
    judgments_empty: ctx.judgments === "No judgment results available.",
    corpusExcerpts_chars: ctx.corpusExcerpts.length,
    corpusExcerpts_empty: ctx.corpusExcerpts === "No corpus excerpts available.",
    sampleSubmission_chars: ctx.sampleSubmission.length,
    caseRecord_chars: ctx.caseRecord.length,
    prompt_chars: prompt.length,
  });

  const response = await callLLM(
    [
      { role: "system", content: DRAFTING_SYSTEM },
      { role: "user", content: prompt },
    ],
    undefined,
    { max_tokens: 8192 }
  );

  const draft = response.content ?? "# Error\nUnable to generate submission.";
  logger.info("Draft complete", { draft_chars: draft.length, draft_preview: draft.slice(0, 300) });
  return draft;
}

// ---------------------------------------------------------------------------
// Step 4: Convert to DOCX and upload
// ---------------------------------------------------------------------------

async function uploadDocx(
  markdown: string,
  userId: string,
  analysis: QueryAnalysis
): Promise<{ downloadUrl: string; documentId: string }> {
  const supabase = getSupabase();

  const buffer = await markdownToDocxBuffer(markdown);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = analysis.legalTopic.toLowerCase().replace(/\s+/g, "_").slice(0, 40);
  const fileName = `submission_${slug}_${timestamp}.docx`;
  const storagePath = `${userId}/court_submissions/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("user-documents")
    .upload(storagePath, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: false,
    });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: docRecord, error: insertError } = await supabase
    .from("user_documents")
    .insert({
      user_id: userId,
      kind: "legal_corpus",
      file_name: fileName,
      storage_path: storagePath,
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size_bytes: buffer.byteLength,
    })
    .select("id")
    .single();

  if (insertError) throw new Error(`DB insert failed: ${insertError.message}`);

  const { data: signedUrl, error: signError } = await supabase.storage
    .from("user-documents")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (signError) throw new Error(`Signed URL failed: ${signError.message}`);

  return {
    downloadUrl: signedUrl.signedUrl,
    documentId: docRecord.id,
  };
}

// ---------------------------------------------------------------------------
// Write final result to task_results
// ---------------------------------------------------------------------------

async function writeResult(
  runId: string,
  userId: string,
  prompt: string,
  status: "completed" | "failed",
  output: unknown
) {
  const supabase = getSupabase();
  await supabase.from("task_results").upsert({
    run_id: runId,
    user_id: userId,
    prompt,
    status,
    output,
  });
}

// ---------------------------------------------------------------------------
// Main task
// ---------------------------------------------------------------------------

export const ingestAgent = task({
  id: "ingest-agent",
  maxDuration: 600,

  run: async (payload: AgentInput, { ctx }): Promise<AgentOutput> => {
    const { query, userId } = payload;
    const runId = ctx.run.id;

    logger.info("ingest-agent started", { userId, query: query.slice(0, 100) });

    try {
      logger.info("Analysing query and extracting keywords");
      const analysis = await analyseQuery(query);
      logger.info("Query analysis complete", analysis);

      logger.info("Building context in parallel");
      const context = await buildContext(analysis, userId);

      logger.info("Drafting submission");
      const markdown = await draftSubmission(query, analysis, context);

      logger.info("Converting to DOCX and uploading");
      const { downloadUrl } = await uploadDocx(markdown, userId, analysis);

      const summary = `Your ${analysis.submissionType} on "${analysis.legalTopic}" is ready. ${
        analysis.isRealCase
          ? `Prepared for: ${analysis.caseIdentifier}.`
          : "Drafted as a general template — update the placeholders before filing."
      }`;

      const output: AgentOutput = { downloadUrl, summary, keywords: analysis.keywords };

      await writeResult(runId, userId, query, "completed", output);
      logger.info("ingest-agent complete", { downloadUrl });

      return output;
    } catch (err) {
      await writeResult(runId, userId, query, "failed", { error: String(err) });
      throw err;
    }
  },
});

// trigger/lib/tools.ts
// Four tools: Laws.Africa judgments, legal corpus RAG, DB case read, Tavily web search.
// Each returns a plain string that goes back into the LLM context.
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { embedText } from "./llm";

// ---------------------------------------------------------------------------
// Supabase admin client (service role — used only server-side in Trigger.dev)
// ---------------------------------------------------------------------------
function adminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { realtime: { transport: ws } }
  );
}

// ---------------------------------------------------------------------------
// Tool 1: Laws.Africa judgment search
// ---------------------------------------------------------------------------
export async function searchLawsAfrica(query: string): Promise<string> {
  const res = await fetch(
    "https://api.laws.africa/ai/v1/knowledge-bases/judgments-ug/retrieve",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.LAWS_AFRICA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: query, top_k: 5 }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Laws.Africa error ${res.status}: ${err}`);
  }

  const json = await res.json();

  const results: Array<{
    content?: { text?: string };
    metadata?: {
      title?: string;
      public_url?: string;
      expression_date?: string;
      flynote?: string;
      blurb?: string;
    };
    score?: number;
  }> = json.results ?? [];

  if (results.length === 0) return "No relevant judgments found.";

  return results
    .map((r, i) => {
      const meta = r.metadata ?? {};
      const text = r.content?.text ?? "";
      const parts = [
        `[${i + 1}] ${meta.title ?? "Untitled"}`,
        meta.expression_date ? `Date: ${meta.expression_date}` : null,
        meta.public_url ? `URL: ${meta.public_url}` : null,
        meta.blurb ? `Blurb: ${meta.blurb}` : null,
        meta.flynote ? `Flynote: ${meta.flynote}` : null,
        text ? `\nSummary:\n${text}` : null,
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Tool 2: Legal corpus RAG (pgvector similarity search)
// ---------------------------------------------------------------------------
export async function searchLegalCorpus(
  query: string,
  userId: string,
  topK = 5
): Promise<string> {
  const supabase = adminClient();
  const embedding = await embedText(query);

  const { data, error } = await supabase.rpc("match_legal_corpus", {
    query_embedding: embedding,
    match_user_id: userId,
    match_count: topK,
  });

  if (error) throw new Error(`Corpus search error: ${error.message}`);
  if (!data || data.length === 0) return "No relevant excerpts found in your legal corpus.";

  return (data as Array<{ content: string; similarity: number; chunk_index: number }>)
    .map((chunk, i) => `[Excerpt ${i + 1} — similarity ${(chunk.similarity * 100).toFixed(1)}%]\n${chunk.content}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Tool 3: Database read — case records
// ---------------------------------------------------------------------------
export async function readCasesFromDB(
  query: string,
  userId: string
): Promise<string> {
  const supabase = adminClient();
  const q = query.toLowerCase();

  let dbQuery = supabase
    .from("cases")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(20);

  const nameMatch = query.match(/client[:\s]+([A-Za-z\s]+)/i) ??
    query.match(/case[:\s]+(?:of\s+)?([A-Za-z\s]+)/i);
  if (nameMatch) {
    dbQuery = dbQuery.ilike("client_name", `%${nameMatch[1].trim()}%`);
  }

  const fileMatch = query.match(/(?:file|lac)[:\s#]+([A-Za-z0-9/-]+)/i);
  if (fileMatch) {
    dbQuery = dbQuery.ilike("lac_file_no", `%${fileMatch[1].trim()}%`);
  }

  if (q.includes("open") || q.includes("pending")) {
    dbQuery = dbQuery.ilike("status", "%open%");
  } else if (q.includes("closed") || q.includes("completed")) {
    dbQuery = dbQuery.ilike("status", "%closed%");
  }

  const natureKeywords = ["robbery", "assault", "theft", "land", "family", "murder", "fraud"];
  for (const kw of natureKeywords) {
    if (q.includes(kw)) {
      dbQuery = dbQuery.ilike("nature_of_case", `%${kw}%`);
      break;
    }
  }

  const { data, error } = await dbQuery;
  if (error) throw new Error(`Database error: ${error.message}`);
  if (!data || data.length === 0) return "No matching cases found in the database.";

  return data
    .map((c) => {
      return [
        `Case: ${c.client_name} | File: ${c.lac_file_no} | Court: ${c.court_case_no ?? "N/A"}`,
        `Date: ${c.date} | Nature: ${c.nature_of_case ?? "N/A"} | Status: ${c.status ?? "N/A"}`,
        `Action taken: ${c.action_taken ?? "N/A"}`,
        c.notes ? `Notes: ${c.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Tool 4: Tavily web search (current news / recent developments)
// ---------------------------------------------------------------------------
export async function tavilySearch(query: string): Promise<string> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tavily error ${res.status}: ${err}`);
  }

  const json = await res.json();

  const parts: string[] = [];
  if (json.answer) parts.push(`Summary: ${json.answer}`);

  const results: Array<{ title: string; url: string; content: string }> =
    json.results ?? [];
  results.forEach((r, i) => {
    parts.push(`[${i + 1}] ${r.title}\n${r.url}\n${r.content}`);
  });

  return parts.length > 0 ? parts.join("\n\n") : "No web results found.";
}

// ---------------------------------------------------------------------------
// Fetch sample court submissions (for agent mode format reference)
// ---------------------------------------------------------------------------
export async function fetchSampleSubmissions(userId: string): Promise<string> {
  const supabase = adminClient();

  const { data: doc } = await supabase
    .from("user_documents")
    .select("storage_path, file_name, mime_type")
    .eq("user_id", userId)
    .eq("kind", "court_submission")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!doc) return "";

  const { data: file } = await supabase.storage
    .from("user-documents")
    .download(doc.storage_path);

  if (!file) return "";

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = doc.mime_type ?? "";
  const fileName = doc.file_name ?? "";

  if (mime.includes("wordprocessingml") || fileName.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mime.includes("pdf") || fileName.endsWith(".pdf")) {
    const result = await pdfParse(buffer);
    return result.text;
  }

  return buffer.toString("utf-8");
}

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function-calling schema) for ingest-chat
// ---------------------------------------------------------------------------
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_laws_africa",
      description:
        "Search Ugandan court judgments and case law from Laws.Africa. Use for legal questions, precedents, and case law research.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keywords or legal question to search for",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_legal_corpus",
      description:
        "Search the user's private legal corpus documents using semantic similarity. Use for precedents, arguments, or references from uploaded legal documents.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The legal question or topic to search for",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_cases_db",
      description:
        "Read case records from the user's case database. Use when the user asks about their specific cases, clients, or file numbers.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural language description of what cases to look for (client name, file number, nature of case, status, etc.)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current news, recent legal developments, or any information not covered by the other tools.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------
export async function dispatchTool(
  toolName: string,
  args: Record<string, string>,
  userId: string
): Promise<string> {
  switch (toolName) {
    case "search_laws_africa":
      return searchLawsAfrica(args.query);
    case "search_legal_corpus":
      return searchLegalCorpus(args.query, userId);
    case "read_cases_db":
      return readCasesFromDB(args.query, userId);
    case "web_search":
      return tavilySearch(args.query);
    default:
      return `Unknown tool: ${toolName}`;
  }
}
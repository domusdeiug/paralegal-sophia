// trigger/tasks/embed-corpus.ts
// Cron task: picks up unembedded legal_corpus documents from user_documents,
// chunks + embeds them via BGE-M3, and stores chunks in legal_corpus_chunks.

import { task, schedules, logger } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { embedText } from "../lib/llm";

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { realtime: { transport: ws } }
  );
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

async function extractText(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  if (mimeType.includes("wordprocessingml") || fileName.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (mimeType.includes("pdf") || fileName.endsWith(".pdf")) {
    const result = await pdfParse(buffer);
    return result.text;
  }
  // Plain text fallback
  return buffer.toString("utf-8");
}

// ---------------------------------------------------------------------------
// Chunking — 500-token target with 50-token overlap (approximated by chars)
// ~4 chars per token → 2000 chars per chunk, 200 chars overlap
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end === text.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Process a single document
// ---------------------------------------------------------------------------

interface UserDocument {
  id: string;
  user_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
}

async function processDocument(doc: UserDocument): Promise<void> {
  const supabase = getSupabase();

  logger.info("Processing document", {
    documentId: doc.id,
    fileName: doc.file_name,
  });

  // 1. Download from storage
  const { data: file, error: downloadError } = await supabase.storage
    .from("user-documents")
    .download(doc.storage_path);

  if (downloadError || !file) {
    throw new Error(`Storage download failed: ${downloadError?.message}`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // 2. Extract text
  const text = await extractText(buffer, doc.mime_type ?? "", doc.file_name ?? "");

  if (!text || text.trim().length === 0) {
    logger.warn("Document yielded no text — skipping", { documentId: doc.id });
    // Mark as embedded so the cron doesn't retry an empty doc forever
    await supabase
      .from("user_documents")
      .update({ embedded_at: new Date().toISOString() })
      .eq("id", doc.id);
    return;
  }

  logger.info("Text extracted", {
    documentId: doc.id,
    chars: text.length,
  });

  // 3. Chunk
  const chunks = chunkText(text);
  logger.info("Chunked document", { documentId: doc.id, chunkCount: chunks.length });

  // 4. Embed each chunk and build insert rows
  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(chunks[i]);
    rows.push({
      user_id: doc.user_id,
      document_id: doc.id,
      chunk_index: i,
      content: chunks[i],
      embedding: JSON.stringify(embedding), // Supabase JS client expects stringified vector
    });
  }

  // 5. Insert chunks
  const { error: insertError } = await supabase
    .from("legal_corpus_chunks")
    .insert(rows);

  if (insertError) {
    throw new Error(`Chunk insert failed: ${insertError.message}`);
  }

  logger.info("Chunks inserted", { documentId: doc.id, chunkCount: rows.length });

  // 6. Mark document as embedded
  const { error: updateError } = await supabase
    .from("user_documents")
    .update({ embedded_at: new Date().toISOString() })
    .eq("id", doc.id);

  if (updateError) {
    throw new Error(`Failed to mark document as embedded: ${updateError.message}`);
  }

  logger.info("Document marked as embedded", { documentId: doc.id });
}

// ---------------------------------------------------------------------------
// Cron task
// ---------------------------------------------------------------------------

export const embedCorpus = schedules.task({
  id: "embed-corpus",
  // Runs once at midnight
  cron: "0 0 * * *",
  maxDuration: 600,

  run: async () => {
    const supabase = getSupabase();

    // Fetch all unembedded legal_corpus documents
    const { data: docs, error } = await supabase
      .from("user_documents")
      .select("id, user_id, file_name, storage_path, mime_type")
      .eq("kind", "legal_corpus")
      .is("embedded_at", null);

    if (error) {
      throw new Error(`Failed to fetch unembedded documents: ${error.message}`);
    }

    if (!docs || docs.length === 0) {
      logger.info("No unembedded documents found — nothing to do");
      return;
    }

    logger.info("Found unembedded documents", { count: docs.length });

    const results = { success: 0, failed: 0 };

    for (const doc of docs as UserDocument[]) {
      try {
        await processDocument(doc);
        results.success++;
      } catch (err) {
        // Log and continue — don't let one bad doc kill the whole batch
        logger.error("Failed to process document", {
          documentId: doc.id,
          fileName: doc.file_name,
          error: String(err),
        });
        results.failed++;
      }
    }

    logger.info("embed-corpus run complete", results);
  },
});

import asyncio
import io
import os
import traceback
from datetime import datetime, timezone

from docx import Document as DocxDocument
import pypdf

from ..lib.supabase_client import get_supabase
from ..lib.embeddings import embed_text


async def _run_embed_pipeline():
    supabase = get_supabase()
    print("[embed] Starting embedding pipeline")

    # Fetch all unembedded legal_corpus documents
    result = (
        supabase.table("user_documents")
        .select("id, user_id, file_name, storage_path, mime_type")
        .eq("kind", "legal_corpus")
        .is_("embedded_at", "null")
        .execute()
    )

    docs = result.data or []
    if not docs:
        print("[embed] No unembedded documents found")
        return

    print(f"[embed] Found {len(docs)} document(s) to embed")
    success, failed = 0, 0

    for doc in docs:
        try:
            await _process_document(doc, supabase)
            success += 1
        except Exception:
            print(f"[embed] Failed on doc {doc['id']}: {traceback.format_exc()}")
            failed += 1

    print(f"[embed] Done — success={success} failed={failed}")


async def _process_document(doc: dict, supabase):
    doc_id = doc["id"]
    user_id = doc["user_id"]
    file_name = doc.get("file_name", "")
    storage_path = doc["storage_path"]
    mime_type = doc.get("mime_type", "")

    print(f"[embed] Processing {file_name} ({doc_id})")

    # 1. Download from Supabase Storage
    response = supabase.storage.from_("user-documents").download(storage_path)
    raw_bytes = response  # returns bytes

    # 2. Extract text
    text = _extract_text(raw_bytes, mime_type, file_name)
    if not text or not text.strip():
        print(f"[embed] No text extracted from {file_name} — marking as embedded")
        supabase.table("user_documents").update(
            {"embedded_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", doc_id).execute()
        return

    print(f"[embed] Extracted {len(text)} chars from {file_name}")

    # 3. Chunk
    chunks = _chunk_text(text)
    print(f"[embed] {len(chunks)} chunks")

    # 4. Embed each chunk and collect rows
    rows = []
    for i, chunk in enumerate(chunks):
        # embed_text is synchronous — run in thread to avoid blocking event loop
        embedding = await asyncio.get_event_loop().run_in_executor(
            None, embed_text, chunk
        )
        rows.append({
            "user_id": user_id,
            "document_id": doc_id,
            "chunk_index": i,
            "content": chunk,
            "embedding_vertex": embedding,   # 768-dim column
        })

    # 5. Insert chunks
    supabase.table("legal_corpus_chunks").insert(rows).execute()
    print(f"[embed] Inserted {len(rows)} chunks for {file_name}")

    # 6. Mark document as embedded
    supabase.table("user_documents").update(
        {"embedded_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", doc_id).execute()


def _extract_text(data: bytes, mime_type: str, file_name: str) -> str:
    """Extract plain text from docx, pdf, or raw bytes."""
    is_docx = "wordprocessingml" in mime_type or file_name.endswith(".docx")
    is_pdf = "pdf" in mime_type or file_name.endswith(".pdf")

    if is_docx:
        doc = DocxDocument(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs)

    if is_pdf:
        reader = pypdf.PdfReader(io.BytesIO(data))
        return "\n".join(
            page.extract_text() or "" for page in reader.pages
        )

    # Plain text fallback
    return data.decode("utf-8", errors="ignore")


def _chunk_text(text: str, size: int = 2000, overlap: int = 200) -> list[str]:
    """Split text into overlapping chunks (~500 tokens each)."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end == len(text):
            break
        start += size - overlap
    return chunks

if __name__ == "__main__":
    # Load environment variables from .env file
    from dotenv import load_dotenv
    load_dotenv()
    asyncio.run(_run_embed_pipeline())
import asyncio
import io
import os
import traceback
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from agent import orchestrator_agent
from lib.supabase_client import get_supabase
from lib.embeddings import embed_text

# Optional text extraction deps — imported lazily so missing libs don't break /run
try:
    from docx import Document as DocxDocument
    _HAS_DOCX = True
except ImportError:
    _HAS_DOCX = False

try:
    import pypdf
    _HAS_PYPDF = True
except ImportError:
    _HAS_PYPDF = False

app = FastAPI(title="Sophia Legal Agent")

APP_NAME = "sophia-legal-agent"


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class RunRequest(BaseModel):
    mode: str           # "chat" or "agent"
    messages: list[dict]
    userId: str
    runId: str


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------

@app.post("/run")
async def run(request: Request, body: RunRequest):
    # Validate API key
    api_key = request.headers.get("x-api-key", "")
    expected = os.environ.get("CLOUD_RUN_API_KEY", "")
    if not expected or api_key != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Fire non-blocking task
    asyncio.create_task(execute_and_store(body))

    return {"runId": body.runId, "status": "started"}


# ---------------------------------------------------------------------------
# Embed endpoint (called by Cloud Scheduler cron)
# ---------------------------------------------------------------------------

@app.post("/embed")
async def embed(request: Request):
    api_key = request.headers.get("x-api-key", "")
    expected = os.environ.get("CLOUD_RUN_API_KEY", "")
    if not expected or api_key != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

    asyncio.create_task(_run_embed_pipeline())
    return {"status": "started"}


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

    if is_docx and _HAS_DOCX:
        doc = DocxDocument(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs)

    if is_pdf and _HAS_PYPDF:
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


# ---------------------------------------------------------------------------
# Background execution
# ---------------------------------------------------------------------------

async def execute_and_store(req: RunRequest):
    supabase = get_supabase()
    run_id = req.runId
    user_id = req.userId

    # Extract last user message as the prompt
    prompt = ""
    for msg in reversed(req.messages):
        if msg.get("role") == "user":
            prompt = msg.get("content", "")
            break

    try:
        # Set up session with user_id in state
        session_service = InMemorySessionService()
        session = await session_service.create_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=run_id,
            state={"user_id": user_id},
        )

        runner = Runner(
            agent=orchestrator_agent,
            app_name=APP_NAME,
            session_service=session_service,
        )

        # Build message content
        content = types.Content(
            role="user",
            parts=[types.Part(text=prompt)],
        )

        # Run the agent and collect the final response
        final_response = ""
        async for event in runner.run_async(
            user_id=user_id,
            session_id=run_id,
            new_message=content,
        ):
            if event.is_final_response():
                if event.content and event.content.parts:
                    final_response = event.content.parts[0].text or ""

        # Write completed result to Supabase
        supabase.table("task_results").upsert({
            "run_id": run_id,
            "user_id": user_id,
            "prompt": prompt,
            "status": "completed",
            "output": {"reply": final_response, "toolsUsed": []},
        }).execute()

    except Exception:
        error_detail = traceback.format_exc()
        supabase.table("task_results").upsert({
            "run_id": run_id,
            "user_id": user_id,
            "prompt": prompt,
            "status": "failed",
            "output": {"error": error_detail},
        }).execute()

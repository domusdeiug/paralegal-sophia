# Paralegal Sophia

An AI-powered paralegal assistant built for Ugandan legal practitioners. Sophia helps lawyers and paralegals research case law, manage client files, and draft formal court submissions — all through a conversational interface backed by a multi-agent architecture.

---

## What it does

Sophia is a multi-agent system that understands the Ugandan legal context. You can ask it questions in plain English and it will:

- **Research Ugandan case law** by querying the [Laws.Africa](https://laws.africa) judgments database and surfacing relevant precedents with citations
- **Search your private legal corpus** using semantic (vector) search over documents you've uploaded — previous submissions, precedents, reference materials
- **Look up client cases** from your case management database by client name, file number, case type, or status
- **Find current legal developments** via web search for recent news relevant to a matter
- **Draft court submissions** in proper Ugandan court format and export them as a Word document (.docx)

---

## Architecture

```
Frontend (React + TanStack Router)
        │
        ▼
Supabase Edge Functions
        │
        ▼
Vertex AI Agent Engine  (Python, Google ADK)
        │
        ├── OrchestratorAgent  ← root agent / Sophia
        │       │
        │       ├── ResearchAgent
        │       │       ├── search_laws_africa      (Laws.Africa API)
        │       │       └── search_legal_corpus     (Supabase vector search)
        │       │
        │       ├── CaseAgent
        │       │       ├── read_cases_db           (Supabase cases table)
        │       │       └── web_search              (Tavily)
        │       │
        │       ├── DraftingAgent
        │       │       └── generate_docx           (python-docx)
        │       │
        │       └── write_result                    (saves output to Supabase)
        │
Supabase (PostgreSQL + pgvector)
        ├── profiles          user accounts & subscription tier
        ├── cases             client case management records
        ├── user_documents    uploaded files (stored in Supabase Storage)
        └── legal_corpus_chunks  vectorised document chunks (768-dim embeddings)
```

The orchestrator decides which sub-agents to call based on the query. Most responses use at most two sub-agent calls before synthesising a final answer. Every result is persisted back to Supabase via `write_result`.

Document embeddings are generated nightly by a Cloud Scheduler job that calls the `/embed` endpoint, using Vertex AI `text-embedding-004` (768 dimensions).

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TanStack Router, Tailwind CSS, shadcn/ui |
| Auth & DB | Supabase (PostgreSQL + pgvector + Row Level Security) |
| Edge functions | Supabase Edge Functions (Deno/TypeScript) |
| Agent framework | Google ADK (Agent Development Kit) |
| Agent runtime | Vertex AI Agent Engine (us-east1) |
| LLM | Gemini 2.0 Flash |
| Embeddings | Vertex AI text-embedding-004 |
| Web search | Tavily |
| Case law | Laws.Africa Judgments API |
| Document generation | python-docx |
| Package management | uv |
| Deployment | agents-cli v0.3.0 |

---

## Project structure

```
paralegal-sophia/
├── app/                        Python agent (deployed to Vertex AI Agent Engine)
│   ├── agent.py                Sub-agents and orchestrator definition
│   ├── agent_runtime_app.py    Agent Engine entrypoint (AgentRuntime class)
│   ├── main.py                 Local console runner (dev only)
│   ├── requirements.txt        Python dependencies
│   ├── Dockerfile              Container definition
│   ├── cron.yaml               Nightly embedding job spec
│   ├── lib/
│   │   ├── embeddings.py       Vertex AI embedding helper
│   │   └── supabase_client.py  Supabase client singleton
│   └── tools/
│       ├── laws_africa.py      Laws.Africa case law search
│       ├── corpus_search.py    Private corpus vector search
│       ├── case_db.py          Client case database lookup
│       ├── web_search.py       Tavily web search
│       ├── docx_gen.py         Word document generation
│       └── supabase_writer.py  Result persistence
├── src/                        React frontend
│   ├── routes/                 TanStack Router pages
│   ├── components/app/         Chat, Agent, Cases, Settings tabs
│   └── integrations/supabase/ Supabase client & auth
├── supabase/
│   ├── functions/              Edge functions (chat, drafting, reports, exports)
│   └── migrations/             Database schema
├── scripts/
│   └── embed_documents.py      Document embedding pipeline
├── agents-cli-manifest.yaml    agents-cli deployment config
├── pyproject.toml              Python project metadata
└── .env.example                Required environment variables
```

---

## Getting started

### Prerequisites

- Node.js 18+ and [Bun](https://bun.sh)
- Python 3.11+
- [uv](https://docs.astral.sh/uv/)
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
- A Supabase project
- A Google Cloud project with Vertex AI enabled

### 1. Clone and install

```bash
git clone https://github.com/your-org/paralegal-sophia.git
cd paralegal-sophia

# Frontend dependencies
bun install

# Python dependencies
uv sync
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (backend only) |
| `LAWS_AFRICA_API_KEY` | Laws.Africa API key |
| `TAVILY_API_KEY` | Tavily search API key |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | GCP region (e.g. `us-east1`) |
| `GEMINI_MODEL` | Gemini model name (e.g. `gemini-2.0-flash`) |
| `EMBEDDING_MODEL` | Vertex AI embedding model (e.g. `text-embedding-004`) |
| `CLOUD_RUN_API_KEY` | API key for the nightly embedding cron job |

### 3. Set up the database

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### 4. Run locally

```bash
# Frontend
bun run dev

# Agent (console mode)
cd app
python main.py
```

---

## Deploying the agent

The agent is deployed to Vertex AI Agent Engine using `agents-cli`.

```bash
# Authenticate
gcloud auth application-default login

# Deploy (takes 5–10 minutes)
agents-cli deploy
```

Make sure `agents-cli-manifest.yaml` points to your project and the `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` env vars are set before deploying.

To check deployment status after an interruption:

```bash
agents-cli deploy --status
```

### Nightly document embedding

Upload documents as `legal_corpus` kind via the app. They are embedded automatically by the nightly Cloud Scheduler job. To run the embedding pipeline manually:

```bash
curl -X POST "${CLOUD_RUN_URL}/embed" \
  -H "x-api-key: ${CLOUD_RUN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Data privacy

All case records and uploaded documents are scoped to the authenticated user via Supabase Row Level Security. No user data is shared across accounts. Documents are stored in a private Supabase Storage bucket and are not accessible without authentication.

---

## License

See [LICENSE](LICENSE).

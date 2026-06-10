```mermaid
flowchart LR
    User[User] --> Frontend[Frontend]
    Frontend --> Supabase[Supabase]

    Supabase --> VertexAI["Vertex AI Agent Runtime"]

    VertexAI --> Orchestrator["Orchestrator Agent (Sophia)"]

    Orchestrator --> ResearchAgent["Research Agent"]
    Orchestrator --> CaseAgent["Case Agent"]
    Orchestrator --> DraftingAgent["Drafting Agent"]

    ResearchAgent --> LawsAfrica["Laws Africa API"]
    ResearchAgent --> Corpus["Legal Corpus (Supabase pgvector)"]

    CaseAgent --> CaseDB["Case Database (Supabase)"]
    CaseAgent --> Tavily["Tavily Web Search"]

    DraftingAgent --> DocX["Word Document (.docx)"]

    ResearchAgent --> Orchestrator
    CaseAgent --> Orchestrator
    DraftingAgent --> Orchestrator

    Orchestrator --> VertexAI
    VertexAI --> Supabase
    Supabase --> Frontend
    Frontend --> User
```

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
    LawsAfrica["Laws Africa API"] --> ResearchAgent
    ResearchAgent --> Corpus["Legal Corpus (Supabase pgvector)"]
    Corpus["Legal Corpus (Supabase pgvector)"] --> ResearchAgent

    CaseAgent --> CaseDB["Case Database (Supabase)"]
    CaseDB["Case Database (Supabase)"] --> CaseAgent
    CaseAgent --> Tavily["Tavily Web Search"]
    Tavily["Tavily Web Search"] --> CaseAgent

    DraftingAgent --> DocX["Word Document (.docx)"]
    DocX["Word Document (.docx)"] --> Supabase

    ResearchAgent --> Orchestrator
    CaseAgent --> Orchestrator
    DraftingAgent --> Orchestrator

    Orchestrator --> VertexAI
    VertexAI --> Supabase
    Supabase --> Frontend
    Frontend --> User
```

from google.adk.tools import ToolContext
from ..lib.supabase_client import get_supabase
from ..lib.embeddings import embed_text


def search_legal_corpus(query: str, tool_context: ToolContext) -> str:
    """Search the user's private legal corpus documents using semantic similarity.
    Use for precedents, arguments, or references from uploaded legal documents.
    """
    user_id: str = tool_context.state["user_id"]
    supabase = get_supabase()

    embedding = embed_text(query)

    result = supabase.rpc(
        "match_legal_corpus_vertex",
        {
            "query_embedding": embedding,
            "match_user_id": user_id,
            "match_count": 5,
        },
    ).execute()

    if result.data is None or len(result.data) == 0:
        return "No relevant excerpts found in your legal corpus."

    parts = []
    for i, chunk in enumerate(result.data, 1):
        similarity = chunk.get("similarity", 0)
        content = chunk.get("content", "")
        parts.append(
            f"[Excerpt {i} — similarity {similarity * 100:.1f}%]\n{content}"
        )

    return "\n\n".join(parts)

import os
import httpx
from google.adk.tools import ToolContext


def search_laws_africa(query: str, tool_context: ToolContext) -> str:
    """Search Ugandan court judgments and case law from Laws.Africa.
    Use for legal questions, precedents, and case law research.
    """
    api_key = os.environ["LAWS_AFRICA_API_KEY"]

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            "https://api.laws.africa/ai/v1/knowledge-bases/judgments-ug/retrieve",
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": "application/json",
            },
            json={"text": query, "top_k": 5},
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Laws.Africa error {resp.status_code}: {resp.text}")

    data = resp.json()
    results = data.get("results", [])

    if not results:
        return "No relevant judgments found."

    parts = []
    for i, r in enumerate(results, 1):
        meta = r.get("metadata", {})
        text = r.get("content", {}).get("text", "")
        lines = [f"[{i}] {meta.get('title', 'Untitled')}"]
        if meta.get("expression_date"):
            lines.append(f"Date: {meta['expression_date']}")
        if meta.get("public_url"):
            lines.append(f"URL: {meta['public_url']}")
        if meta.get("blurb"):
            lines.append(f"Blurb: {meta['blurb']}")
        if meta.get("flynote"):
            lines.append(f"Flynote: {meta['flynote']}")
        if text:
            lines.append(f"\nSummary:\n{text}")
        parts.append("\n".join(lines))

    return "\n\n---\n\n".join(parts)

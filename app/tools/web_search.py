import os
import httpx
from google.adk.tools import ToolContext


def web_search(query: str, tool_context: ToolContext) -> str:
    """Search the web for current news, recent legal developments,
    or any information not covered by the other tools.
    """
    api_key = os.environ["TAVILY_API_KEY"]

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "search_depth": "basic",
                "max_results": 5,
                "include_answer": True,
            },
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Tavily error {resp.status_code}: {resp.text}")

    data = resp.json()
    parts = []

    if data.get("answer"):
        parts.append(f"Summary: {data['answer']}")

    for i, r in enumerate(data.get("results", []), 1):
        parts.append(f"[{i}] {r.get('title', '')}\n{r.get('url', '')}\n{r.get('content', '')}")

    return "\n\n".join(parts) if parts else "No web results found."

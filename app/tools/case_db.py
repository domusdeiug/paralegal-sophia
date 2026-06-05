import re
from google.adk.tools import ToolContext
from ..lib.supabase_client import get_supabase


def read_cases_db(query: str, tool_context: ToolContext) -> str:
    """Read case records from the user's case database.
    Use when the user asks about their specific cases, clients, or file numbers.
    """
    user_id: str = tool_context.state["user_id"]
    supabase = get_supabase()
    q = query.lower()

    db_query = (
        supabase.table("cases")
        .select("*")
        .eq("user_id", user_id)
        .order("date", desc=True)
        .limit(20)
    )

    # Client / case name filter
    name_match = re.search(r"client[:\s]+([A-Za-z\s]+)", query, re.IGNORECASE) or \
                 re.search(r"case[:\s]+(?:of\s+)?([A-Za-z\s]+)", query, re.IGNORECASE)
    if name_match:
        db_query = db_query.ilike("client_name", f"%{name_match.group(1).strip()}%")

    # File number filter
    file_match = re.search(r"(?:file|lac)[:\s#]+([A-Za-z0-9/-]+)", query, re.IGNORECASE)
    if file_match:
        db_query = db_query.ilike("lac_file_no", f"%{file_match.group(1).strip()}%")

    # Status filter
    if "open" in q or "pending" in q:
        db_query = db_query.ilike("status", "%open%")
    elif "closed" in q or "completed" in q:
        db_query = db_query.ilike("status", "%closed%")

    # Nature of case filter
    nature_keywords = ["robbery", "assault", "theft", "land", "family", "murder", "fraud"]
    for kw in nature_keywords:
        if kw in q:
            db_query = db_query.ilike("nature_of_case", f"%{kw}%")
            break

    result = db_query.execute()

    if not result.data:
        return "No matching cases found."

    rows = []
    for c in result.data:
        lines = [
            f"Case: {c.get('client_name')} | File: {c.get('lac_file_no')} | Court: {c.get('court_case_no') or 'N/A'}",
            f"Date: {c.get('date')} | Nature: {c.get('nature_of_case') or 'N/A'} | Status: {c.get('status') or 'N/A'}",
            f"Action taken: {c.get('action_taken') or 'N/A'}",
        ]
        if c.get("notes"):
            lines.append(f"Notes: {c['notes']}")
        rows.append("\n".join(lines))

    return "\n\n".join(rows)

import traceback
from ..lib.supabase_client import get_supabase


def write_result(run_id: str, user_id: str, prompt: str, reply: str, tools_used: list[str] = []) -> str:
    """Write the final results of a completed task to Supabase.
    Call this at the end of every response to persist the output.
    """
    supabase = get_supabase()
    try:
        supabase.table("task_results").upsert({
            "run_id": run_id,
            "user_id": user_id,
            "prompt": prompt,
            "status": "completed",
            "output": {"reply": reply, "toolsUsed": tools_used},
        }).execute()
        return "Successfully wrote results to Supabase."
    except Exception:
        error_detail = traceback.format_exc()
        supabase.table("task_results").upsert({
            "run_id": run_id,
            "user_id": user_id,
            "prompt": prompt,
            "status": "failed",
            "output": {"error": error_detail},
        }).execute()
        return f"Failed to write results to Supabase: {error_detail}"

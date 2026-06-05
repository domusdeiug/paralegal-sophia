import traceback
from google.adk.tools import Tool
from ..lib.supabase_client import get_supabase


class SupabaseWriterTool(Tool):
    def __init__(self):
        super().__init__(
            name="supabase_writer",
            description="Writes the results of a task to Supabase.",
        )

    def _run(self, run_id: str, user_id: str, prompt: str, reply: str, tools_used: list[str] = []):
        try:
            supabase = get_supabase()
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

write_result = SupabaseWriterTool()
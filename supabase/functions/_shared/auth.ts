// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function getUserClient(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  return supabase;
}

export async function requireUser(req: Request) {
  const supabase = getUserClient(req);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Response("Unauthorized", { status: 401 });
  return { supabase, user: data.user };
}

export async function callOpenRouter(messages: any[], model = "openai/gpt-4o-mini") {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

export async function fetchSampleText(supabase: any, userId: string, kind: string): Promise<string> {
  const { data: doc } = await supabase
    .from("user_documents")
    .select("storage_path, file_name")
    .eq("user_id", userId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!doc) return "";
  const { data: file } = await supabase.storage.from("user-documents").download(doc.storage_path);
  if (!file) return "";
  try {
    return await file.text();
  } catch {
    return `[Binary sample: ${doc.file_name}]`;
  }
}

// trigger/lib/llm.ts
// Wrapper around OpenRouter. Handles plain completions and tool-calling.

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
}

const MODEL = process.env.AGENT_MODEL!; // e.g. "anthropic/claude-3.5-sonnet"

export async function callLLM(
  messages: Message[],
  tools?: object[],
  opts: { max_tokens?: number } = {}
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: opts.max_tokens ?? 4096,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://paralegal-ai.app",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const choice = json.choices?.[0]?.message;
  return {
    content: choice?.content ?? null,
    tool_calls: choice?.tool_calls ?? undefined,
  };
}

export async function embedText(text: string): Promise<number[]> {
  // BGE-M3 via OpenRouter embeddings endpoint
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.EMBEDDING_MODEL ?? "BAAI/bge-m3",
      input: text,
    }),
  });
  if (!res.ok) {
    const text2 = await res.text();
    throw new Error(`Embedding error ${res.status}: ${text2}`);
  }
  const json = await res.json();
  return json.data?.[0]?.embedding ?? [];
}
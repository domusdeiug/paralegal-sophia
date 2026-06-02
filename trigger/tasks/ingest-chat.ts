// trigger/tasks/ingest-chat.ts

import { task, logger } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { type Message, type ToolCall } from "../lib/llm";
import { TOOL_DEFINITIONS, dispatchTool } from "../lib/tools";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatInput {
  messages: Message[];
  userId: string;
}

export interface ChatOutput {
  reply: string;
  toolsUsed: string[];
}

type RawUserMessage = { role: "user"; content: string };
type RawSystemMessage = { role: "system"; content: string };
type RawAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
};
type RawToolMessage = {
  role: "tool";
  tool_call_id: string;
  name: string;
  content: string;
};
type RawMessage =
  | RawSystemMessage
  | RawUserMessage
  | RawAssistantMessage
  | RawToolMessage;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TOOL_CALLS = 2;
const MODEL = process.env.AGENT_MODEL!;

const SYSTEM_PROMPT = `You are Sophia, an expert Ugandan paralegal assistant. You answer the user as soon as possible.
To help you answer expertly and correctly in one shot;
You have access to tools: 
1. The primary tool called for expert opinion on the case: case law search (Laws.Africa) - outtput from it is usually enough.
2. Secondary tools for added information if neccessary or the user requires it: legal corpus search, case database lookup, and web search.
Use AT MOST ${MAX_TOOL_CALLS} tools per response. Only call a tool if you genuinely need external information to answer well.
For general legal questions you can answer from knowledge, do so directly without calling any tool.
After getting tool results, synthesize them into a clear, direct answer for the user.`;

const NUDGE_MESSAGE =
  "Based on everything above, please provide your final answer to the user now.";

const FALLBACK_REPLY =
  "I'm sorry, I wasn't able to produce a response. Please try rephrasing your question.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeResult(
  runId: string,
  userId: string,
  prompt: string,
  status: "completed" | "failed",
  output: unknown
) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { realtime: { transport: ws } }
  );

  await supabase.from("task_results").upsert({
    run_id: runId,
    user_id: userId,
    prompt,
    status,
    output,
  });
}

// ---------------------------------------------------------------------------
// Trigger task
// ---------------------------------------------------------------------------

export const ingestChat = task({
  id: "ingest-chat",
  maxDuration: 300,

  run: async (payload: ChatInput, { ctx }): Promise<ChatOutput> => {
    const { messages, userId } = payload;
    const runId = ctx.run.id;
    const toolsUsed: string[] = [];

    const prompt = messages.filter(m => m.role === "user").at(-1)?.content ?? "";

    const history: RawMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map(toRawMessage),
    ];

    let toolCallCount = 0;

    logger.info("ingest-chat started", {
      userId,
      messageCount: messages.length,
      lastUserMessage: prompt.slice(0, 150),
    });

    try {
      while (true) {
        logger.info("Calling LLM", { toolCallCount, historyLength: history.length });
        const response = await callOpenRouter(history, TOOL_DEFINITIONS);

        const assistantContent = response.content ?? null;
        const toolCalls: ToolCall[] = response.tool_calls ?? [];

        logger.info("LLM response received", {
          hasContent: !!assistantContent,
          contentPreview: assistantContent?.slice(0, 200),
          toolCallCount: toolCalls.length,
          toolNames: toolCalls.map(tc => tc.function.name),
        });

        if (toolCalls.length === 0) {
          const reply = validateContent(assistantContent);
          if (reply) {
            logger.info("Final reply ready", { reply_chars: reply.length, toolsUsed });
            const output: ChatOutput = { reply, toolsUsed };
            await writeResult(runId, userId, prompt, "completed", output);
            return output;
          }

          logger.warn("LLM returned no content and no tool calls — sending nudge");
          history.push({ role: "assistant", content: null });
          history.push({ role: "user", content: NUDGE_MESSAGE });
          const nudgeResponse = await callOpenRouter(history, []);
          const nudgeReply = validateContent(nudgeResponse.content ?? null);
          logger.info("Nudge response", { nudgeReply: nudgeReply?.slice(0, 200) ?? "null — using fallback" });
          const output: ChatOutput = {
            reply: nudgeReply ?? FALLBACK_REPLY,
            toolsUsed,
          };
          await writeResult(runId, userId, prompt, "completed", output);
          return output;
        }

        history.push({
          role: "assistant",
          content: assistantContent,
          tool_calls: toolCalls,
        });

        for (const toolCall of toolCalls) {
          toolCallCount++;
          const toolName = toolCall.function.name;
          toolsUsed.push(toolName);

          let toolResult: string;
          let isError = false;

          logger.info("Dispatching tool", {
            tool: toolName,
            callNumber: toolCallCount,
            args: toolCall.function.arguments.slice(0, 300),
          });

          try {
            const args = parseToolArgs(toolCall.function.arguments);
            toolResult = await dispatchTool(toolName, args, userId);
            logger.info("Tool result received", {
              tool: toolName,
              result_chars: toolResult.length,
              result_empty: toolResult.trim().length === 0,
              result_preview: toolResult.slice(0, 300),
            });
          } catch (err) {
            toolResult = String(err);
            isError = true;
            logger.warn("Tool threw an error", { tool: toolName, error: toolResult });
          }

          history.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: isError
              ? `The tool "${toolName}" failed with error: ${toolResult}. Please answer the user's question from your own knowledge instead.`
              : toolResult,
          });
        }

        if (toolCallCount >= MAX_TOOL_CALLS) {
          logger.info("Max tool calls reached — forcing final answer", { toolCallCount, toolsUsed });
          history.push({
            role: "user",
            content:
              `You have used ${toolCallCount} tool call(s), which is the maximum allowed. ` +
              `Do not call any more tools. Synthesize what you have gathered above into a final answer for the user now.`,
          });

          const finalResponse = await callOpenRouter(history, []);
          const reply = validateContent(finalResponse.content ?? null);
          logger.info("Final forced reply", { reply_chars: reply?.length ?? 0, toolsUsed });
          const output: ChatOutput = {
            reply: reply ?? FALLBACK_REPLY,
            toolsUsed,
          };
          await writeResult(runId, userId, prompt, "completed", output);
          return output;
        }
      }
    } catch (err) {
      await writeResult(runId, userId, prompt, "failed", { error: String(err) });
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// OpenRouter API call
// ---------------------------------------------------------------------------

interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
}

async function callOpenRouter(
  messages: RawMessage[],
  tools: typeof TOOL_DEFINITIONS
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: 4096,
  };

  if (tools.length > 0) {
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
  const message = json.choices?.[0]?.message;

  if (!message) {
    throw new Error("OpenRouter returned no message in choices[0]");
  }

  return {
    content: message.content ?? null,
    tool_calls: message.tool_calls ?? [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRawMessage(msg: Message): RawMessage {
  if (msg.role === "tool") {
    return {
      role: "tool",
      tool_call_id: msg.tool_call_id ?? "",
      name: msg.name ?? "",
      content: msg.content ?? "",
    };
  }
  return {
    role: msg.role as "system" | "user" | "assistant",
    content: msg.content ?? null,
  } as RawMessage;
}

function parseToolArgs(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw);
  } catch {
    return { query: raw };
  }
}

function validateContent(content: string | null): string | null {
  if (!content || content.trim().length === 0) return null;
  return content.trim();
}
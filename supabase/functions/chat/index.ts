// supabase/functions/chat/index.ts
import { corsHeaders } from "./_shared/cors.ts";
import { requireUser } from "./_shared/auth.ts";

const TRIGGER_API_KEY = Deno.env.get("TRIGGER_SECRET_KEY")!;

async function triggerTask(taskId: string, payload: unknown): Promise<string> {
  const res = await fetch(
    `https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TRIGGER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payload }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to trigger task ${taskId} (${res.status}): ${err.slice(0, 400)}`);
  }

  const run = await res.json() as { id: string };
  return run.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user } = await requireUser(req);
    const body = await req.json();
    const { messages, mode } = body as {
      messages: Array<{ role: string; content: string }>;
      mode: "chat" | "agent";
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const enc = new TextEncoder();

    function sseEvent(event: string, data: unknown): Uint8Array {
      return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    if (mode === "chat" || !mode) {
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const runId = await triggerTask("ingest-chat", {
              messages,
              userId: user.id,
            });
            controller.enqueue(sseEvent("started", { runId }));
          } catch (err) {
            controller.enqueue(sseEvent("error", { message: String(err) }));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Agent mode
    const userQuery = messages[messages.length - 1]?.content ?? "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const runId = await triggerTask("ingest-agent", {
            query: userQuery,
            userId: user.id,
            conversationHistory: messages.slice(0, -1),
          });
          controller.enqueue(sseEvent("started", { runId }));
        } catch (err) {
          controller.enqueue(sseEvent("error", { message: String(err) }));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });

  } catch (e) {
    if (e instanceof Response) {
      return new Response(e.body, { status: e.status, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

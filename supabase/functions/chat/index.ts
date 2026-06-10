// supabase/functions/chat-vertex/index.ts
import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ---------------------------------------------------------------------------
// Config — set these in Supabase secrets:
//   VERTEX_PROJECT        e.g. ""
//   VERTEX_LOCATION       e.g. ""
//   VERTEX_ENGINE_ID      e.g. ""
//   VERTEX_SA_KEY         full service account JSON (stringified)
// ---------------------------------------------------------------------------

const PROJECT    = Deno.env.get("VERTEX_PROJECT")!;
const LOCATION   = Deno.env.get("VERTEX_LOCATION")!;
const ENGINE_ID  = Deno.env.get("VERTEX_ENGINE_ID")!;
const SA_KEY_RAW = Deno.env.get("VERTEX_SA_KEY")!;

const BASE_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/reasoningEngines/${ENGINE_ID}`;

// ---------------------------------------------------------------------------
// Google service account JWT + access token
// ---------------------------------------------------------------------------

async function getAccessToken(): Promise<string> {
  const sa = JSON.parse(SA_KEY_RAW);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const signingInput = `${encode(header)}.${encode(payload)}`;

  // Import the private key
  const pemBody = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${signingInput}.${signature}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    throw new Error(`SA token exchange failed: ${await tokenRes.text()}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

// ---------------------------------------------------------------------------
// Vertex session management
// ---------------------------------------------------------------------------

async function getOrCreateSession(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  token: string
): Promise<string> {
  // Check for existing session
  const { data } = await supabase
    .from("vertex_sessions")
    .select("session_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.session_id) return data.session_id;

  // Create a new one
  const res = await fetch(`${BASE_URL}:query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      class_method: "create_session",
      input: { user_id: userId },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create Vertex session: ${await res.text()}`);
  }

  const json = await res.json();
  const sessionId = json.output?.id as string;

  // Persist it
  await supabase.from("vertex_sessions").upsert({
    user_id: userId,
    session_id: sessionId,
    updated_at: new Date().toISOString(),
  });

  return sessionId;
}

// ---------------------------------------------------------------------------
// Query the agent
// ---------------------------------------------------------------------------

async function queryAgent(
  token: string,
  sessionId: string,
  userId: string,
  message: string,
  runId: string
): Promise<{ reply: string; toolsUsed: string[] }> {
  const res = await fetch(`${BASE_URL}:query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      class_method: "stream_query",
      input: {
        user_id: userId,
        session_id: sessionId,
        message: message,
        // Pass run_id and user_id into agent state so write_result tool can use them
        state: { run_id: runId, user_id: userId },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Vertex query failed: ${await res.text()}`);
  }

  const json = await res.json();

  // Extract the final text reply and any tool calls from the event list
  const events: unknown[] = Array.isArray(json.output) ? json.output : [];

  let reply = "";
  const toolsUsed: string[] = [];

  const KNOWN_TOOLS = [
    "search_laws_africa",
    "search_legal_corpus",
    "read_cases_db",
    "web_search",
  ];

  for (const event of events) {
    const e = event as Record<string, unknown>;
    const content = e.content as Record<string, unknown> | undefined;
    const parts = (content?.parts as unknown[]) ?? [];

    for (const part of parts) {
      const p = part as Record<string, unknown>;

      // Capture tool calls
      if (p.function_call) {
        const fc = p.function_call as Record<string, unknown>;
        const name = fc.name as string;
        if (KNOWN_TOOLS.includes(name) && !toolsUsed.includes(name)) {
          toolsUsed.push(name);
        }
      }

      // Capture final text — last author with text and no function_call wins
      if (p.text && !p.thought_signature) {
        const author = e.author as string | undefined;
        // Only take text from the orchestrator, not sub-agents mid-chain
        if (author === "OrchestratorAgent") {
          reply = p.text as string;
        }
      }
    }
  }

  if (!reply) {
    // Fallback: grab the last text part from any event
    for (const event of [...events].reverse()) {
      const e = event as Record<string, unknown>;
      const content = e.content as Record<string, unknown> | undefined;
      const parts = (content?.parts as unknown[]) ?? [];
      for (const part of parts) {
        const p = part as Record<string, unknown>;
        if (p.text && !p.thought_signature && !p.function_call) {
          reply = p.text as string;
          break;
        }
      }
      if (reply) break;
    }
  }

  return { reply: reply || "(no reply)", toolsUsed };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user, supabase } = await requireUser(req);
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

    // Use service-role client for DB writes (task_results, vertex_sessions)
    // so we're not blocked by RLS when writing on behalf of the user
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const userQuery = messages[messages.length - 1]?.content ?? "";
    const runId = crypto.randomUUID();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 1. Insert pending row immediately so frontend poll doesn't 404
          await serviceClient.from("task_results").insert({
            run_id: runId,
            user_id: user.id,
            prompt: userQuery,
            status: "pending",
            output: {},
          });

          // 2. Tell frontend we've started — it begins polling now
          controller.enqueue(sseEvent("started", { runId }));

          // 3. Auth + session
          const token = await getAccessToken();
          const sessionId = await getOrCreateSession(supabase, user.id, token);

          // 4. Call the agent — this waits for the full response
          const { reply, toolsUsed } = await queryAgent(
            token,
            sessionId,
            user.id,
            userQuery,
            runId
          );

          // 5. Write completed result — shape matches what ChatTab expects
          //    chat mode:  { reply, toolsUsed }
          //    agent mode: { summary, downloadUrl } — agent writes this itself
          //                via the write_result tool, so we only write for chat
          if (mode === "agent") {
            // For agent mode the write_result tool inside Vertex handles the DB write.
            // We just need to make sure it wrote something; if not, write a fallback.
            const { data: existing } = await serviceClient
              .from("task_results")
              .select("status")
              .eq("run_id", runId)
              .maybeSingle();

            if (!existing || existing.status !== "completed") {
              await serviceClient.from("task_results").update({
                status: "completed",
                output: { summary: reply, toolsUsed },
              }).eq("run_id", runId);
            }
          } else {
            // chat mode — we write the result directly
            await serviceClient.from("task_results").update({
              status: "completed",
              output: { reply, toolsUsed },
            }).eq("run_id", runId);
          }

        } catch (err) {
          // Mark as failed in DB so frontend stops polling
          await serviceClient.from("task_results").update({
            status: "failed",
            output: { error: String(err) },
          }).eq("run_id", runId);

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

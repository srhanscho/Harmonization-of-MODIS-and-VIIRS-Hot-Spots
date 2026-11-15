import Anthropic from "@anthropic-ai/sdk";
import { EXPERIMENTAL, TOOLS, UNIT, runTool, type ViewPatch } from "@/lib/server/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5-2", "claude-sonnet-5-5"]);
const MAX_TURNS = 6;
const MAX_HISTORY = 12;
const MAX_CHARS = 1500;

const SYSTEM = `You are the data assistant of K-Fire, a web app that shows a harmonized MODIS + VIIRS burning-activity calendar (month x year) for regions of Colombia and Argentina.

Rules:
- Answer ONLY with numbers returned by your tools in this conversation. Never compute new statistics yourself beyond restating tool outputs, and never use remembered figures.
- Every number you give must include its unit (${UNIT}), period, region, and whether it is "harmonized" (estimated, VIIRS S-NPP equivalent) or "raw" (observed). HFAI z is unitless (standard deviations); FRP is in MW.
- If a tool returns no_data or nothing relevant, say you have no data for that. Never fill gaps. A missing month means no active sensor, not zero fires.
- Never make forecasts yourself. Forward-looking numbers may only come from get_forecast, and whenever you mention them say they are "${EXPERIMENTAL}".
- The Fire Severity Index is a relative composite score (0-100), not burned area. Never convert detections, FSI or FRP to burned area or hectares.
- ENSO/ONI results from get_climate_link are correlations; describe them as association, not cause.
- Resolve place names with list_regions before using a region_id you have not seen.
- When the answer concerns a specific region and month, also call set_view so the user's calendar shows it.
- Reply in the same language as the user's last message. Be concise: 2-5 sentences, plain text, no markdown tables.`;

// ---- simple in-memory rate limit (per IP, per serverless instance) ----
const WINDOW_MS = 60_000;
const LIMIT = 8;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

export async function GET() {
  return Response.json({ available: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL });
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return Response.json({ error: "rate_limited" }, { status: 429 });

  let body: { messages?: ChatTurn[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = history;
  const toolLog: { name: string; input: unknown }[] = [];
  let patch: ViewPatch | undefined;
  const useFallback = FALLBACK_MODELS.has(MODEL);

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        tool_choice: { type: "auto" },
        output_config: { effort: "low" },
        messages,
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });

      if (response.stop_reason === "refusal") {
        return Response.json({ reply: "", refused: true, tools: toolLog, patch });
      }
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        const reply = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return Response.json({ reply, tools: toolLog, patch });
      }

      messages.push({ role: "assistant", content: response.content });
      const results = await Promise.all(
        toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const input = (tu.input ?? {}) as Record<string, unknown>;
          toolLog.push({ name: tu.name, input });
          try {
            const out = await runTool(tu.name, input);
            if (out.patch) patch = out.patch;
            return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out.result) };
          } catch (err) {
            return {
              type: "tool_result",
              tool_use_id: tu.id,
              is_error: true,
              content: err instanceof Error ? err.message : "tool failed",
            };
          }
        }),
      );
      messages.push({ role: "user", content: results });
    }
    return Response.json({ reply: "", tools: toolLog, patch, truncated: true });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return Response.json({ error: "rate_limited" }, { status: 429 });
    if (err instanceof Anthropic.AuthenticationError) return Response.json({ error: "unavailable" }, { status: 503 });
    if (err instanceof Anthropic.APIError) {
      console.error("assistant api error", err.status, err.message);
      return Response.json({ error: "upstream" }, { status: 502 });
    }
    console.error("assistant error", err);
    return Response.json({ error: "internal" }, { status: 500 });
  }
}

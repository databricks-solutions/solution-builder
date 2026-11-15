/**
 * Orbitline+ Metadata Copilot chat agent (the floating dock).
 *
 * Tools:
 *   ask_data              — the Genie agent (Agent mode): content-strategy analytics over the Delta gold tables AND the
 *                           Orbitline+ Metadata & Content Standards Guide documents (cited)
 *   find_titles           — the live Lakebase work queue (hidden gems / safety risks / Harborlight) for "what should I fix next?"
 *   more_like_this        — Vector Search over title profiles ("titles similar to X")
 *   find_clips            — Vector Search over scene descriptions (repurposing: clips for a promo / collection)
 *
 * The per-title AI re-tag itself is NOT a chat tool — it runs from the title
 * workbench (services/retag.ts) so its diff + checks render as UI, and only an
 * editor can publish it.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { findTitlesForAgent, getTitle, titlesByIds, type Scope } from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
import { vectorQuery } from '../lib/vs.js';
import { resolvedBackends } from '../services/resources.js';
export type { ToolProgressEvent } from './tools/types.js';

export type ModelErrorDetail = { status: number; url: string; bodyText: string; code?: string; message?: string };

export type AgentContext = {
  db: AppDb;
  userEmail: string;
  req: Request;
  /** Genie Agent space id (tables + documents volume) the `ask_data` tool queries. */
  genieSpaceId: string;
  databricksHost: string;
  model: string;
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  modelError?: { current: ModelErrorDetail | null };
};

/** Genie agent id and Vector Search indexes, set at boot from config/app.json (server.ts); the Genie id
 *  falls back to <catalog>.<schema>.demo_resources (written by the setup job) — see ensureCopilotBackends. */
const backends = { genieSpaceId: '', profilesIndex: '', scenesIndex: '' };
export function configureCopilotAgent(b: { genieSpaceId?: string; catalog?: string; schema?: string }) {
  backends.genieSpaceId = b.genieSpaceId ?? '';
  if (b.catalog && b.schema) {
    backends.profilesIndex = `${b.catalog}.${b.schema}.title_profiles_index`;
    backends.scenesIndex = `${b.catalog}.${b.schema}.scenes_index`;
  }
}

/** Fill a missing Genie agent id from demo_resources (retried per turn until resolved). */
export async function ensureCopilotBackends() {
  if (backends.genieSpaceId) return;
  const b = await resolvedBackends();
  backends.genieSpaceId ||= b.genieSpaceId;
}

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext) {
  const tools = [];
  if (backends.genieSpaceId) tools.push(askDataTool(ctx, backends.genieSpaceId));
  tools.push(tool({
    name: 'find_titles',
    description: 'List titles from the live metadata work queue (Lakebase) with live completeness, AI-proposed completeness, last-4-week impressions vs well-tagged peers, completion rate, missing content warnings and brand-safety tier. scope: gems = hidden gems (viewers finish them, rarely shown), safety = missing warnings on Family-Safe/kids-row titles, harborlight = the acquired library, reviewed = already decided, all.',
    parameters: z.object({
      scope: z.enum(['gems', 'safety', 'harborlight', 'reviewed', 'all']).describe('Which queue'),
      q: z.string().nullable().describe('Optional title search text, or null'),
      limit: z.number().int().describe('Max rows, 1-25'),
    }),
    execute: async ({ scope, q, limit }) => {
      const rows = await findTitlesForAgent(ctx.db, { scope: scope as Scope, q, limit: Math.max(1, Math.min(25, limit)) });
      return { count: rows.length, titles: rows };
    },
  }));
  if (backends.profilesIndex) {
    tools.push(tool({
      name: 'more_like_this',
      description: 'Vector Search over title profiles: titles most similar to a given title (by title name or id) or to a free-text description. Returns similar titles with their source, primary genre, impressions and completeness.',
      parameters: z.object({
        title_or_description: z.string().describe('A title name/id from the library (e.g. "The Salt Road") or a description ("coastal crime thriller about brothers")'),
        limit: z.number().int().describe('Max rows, 1-10'),
      }),
      execute: async ({ title_or_description, limit }) => {
        const id = /^TTL-/.test(title_or_description) ? title_or_description : (await findTitlesForAgent(ctx.db, { scope: 'all', q: title_or_description, limit: 1 }))[0]?.title_id as string | undefined;
        const t = id ? await getTitle(ctx.db, id) : null;
        const text = t
          ? `${t.ai?.synopsis ?? t.meta.synopsis} Genres: ${(t.ai?.genres ?? t.meta.genres).join(', ')}. Moods: ${(t.ai?.moods ?? t.meta.moods).join(', ')}. Themes: ${(t.ai?.themes ?? t.meta.themes).join(', ')}.`
          : title_or_description;
        const hits = await vectorQuery(ctx.req, backends.profilesIndex, text, ['title_id', 'title', 'source', 'primary_genre'], Math.min(10, limit) + 1);
        const ids = hits.map((h) => String(h.title_id)).filter((x) => x !== t?.id);
        const peers = await titlesByIds(ctx.db, ids);
        return { query_title: t?.title ?? null, similar: ids.map((i) => peers.find((p) => p.id === i)).filter(Boolean).slice(0, limit) };
      },
    }));
  }
  if (backends.scenesIndex) {
    tools.push(tool({
      name: 'find_clips',
      description: 'Vector Search over every scene description in the library: find repurposable clips (with title, timecodes and the scene text) for a promo, trailer or themed collection, e.g. "storm at sea / boats at night".',
      parameters: z.object({
        description: z.string().describe('What the clip should show'),
        limit: z.number().int().describe('Max clips, 1-10'),
      }),
      execute: async ({ description, limit }) => {
        const hits = await vectorQuery(ctx.req, backends.scenesIndex, description, ['scene_id', 'title_id', 'start_tc', 'end_tc', 'description'], Math.min(10, limit));
        const peers = await titlesByIds(ctx.db, [...new Set(hits.map((h) => String(h.title_id)))]);
        return { clips: hits.map((h) => ({ ...h, title: peers.find((p) => p.id === String(h.title_id))?.title, source: peers.find((p) => p.id === String(h.title_id))?.source })) };
      },
    }));
  }
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  // Build a fresh auth header each configure; OpenAI SDK holds the key at
  // client construction time, so we reconfigure per request to pick up a
  // fresh bearer. (setDefaultOpenAIClient is idempotent.)
  const headers = await authHeaders(ctx.req);
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  // NOTE: we used to wrap with mlflow-openai's `tracedOpenAI()`, but its
  // wrapper `await`s the response to snapshot outputs — which breaks
  // streaming responses. Skip it; we still get agent-level spans via the
  // root `metadata_copilot.turn` and per-tool `withSpan` wrappers.
  //
  // Use a custom fetch that forces a fresh TCP connection per call and
  // disables keep-alive. Without this, after a long-running tool call
  // (ask_data can take ~60-90s), the second Responses API call reuses a
  // stale socket that the Databricks gateway has half-closed, which
  // surfaces as a bare 502 (no headers/body) ~3s into the call. Also bump
  // maxRetries since 502s are transient gateway failures.
  // ──────────────────────────────────────────────────────────────────
  // 64-char input[*].id workaround for Databricks' Responses API
  // ──────────────────────────────────────────────────────────────────
  //
  // Problem:
  //   On the synthesis turn (after a tool output is fed back), the agent
  //   run fails with `502 status code (no body)` after ~3s. The failure
  //   is deterministic, not transient — retries don't help.
  //
  // Root cause:
  //   The @openai/agents SDK assigns long IDs (e.g. `fc_013bda62…` ~190
  //   chars) to `reasoning` and `function_call` items in the conversation
  //   history. On round 2, the SDK echoes those items back in `input[]`.
  //   Databricks' Responses API enforces a 64-char max on `input[*].id`
  //   and returns `400 Invalid 'input[N].id': string too long`. The
  //   streaming gateway then masks that 400 as a bare 502. (Reproduced
  //   by flipping `stream: true` → `stream: false` in `scripts/repro-502.ts`:
  //   the 502 becomes a clean 400 with the real message.)
  //
  // Fix:
  //   Intercept outgoing request bodies and delete any `input[i].id`
  //   longer than 64 chars. Databricks treats missing ids as freshly
  //   generated, so this is safe — the conversation continuity is
  //   carried by `call_id` (short) for function calls, not `id`.
  //
  // Remove this wrapper once Databricks lifts the 64-char limit.
  // ──────────────────────────────────────────────────────────────────
  const client = new OpenAI({
    apiKey: bearer,
    baseURL: `${ctx.databricksHost}/serving-endpoints`,
    maxRetries: 4,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Connection', 'close');
      let body = init?.body;
      if (typeof body === 'string' && body.startsWith('{')) {
        try {
          const parsed = JSON.parse(body) as {
            input?: Array<Record<string, unknown>>;
            messages?: Array<Record<string, unknown>>;
          };
          // Responses-API: strip long opaque ids the SDK echoes back.
          if (Array.isArray(parsed.input)) {
            for (const item of parsed.input) {
              const id = item.id;
              if (typeof id === 'string' && id.length > 64) {
                delete item.id;
              }
            }
          }
          // Chat-completions: Anthropic-via-Bedrock rejects unknown keys
          // on assistant message content parts. The SDK adds
          // `annotations: []` to text parts when replaying assistant
          // history (turn 2+ of an agent loop). Strip them.
          //   400: "messages.N.content.0.text.annotations: Extra inputs are not permitted"
          if (Array.isArray(parsed.messages)) {
            for (const m of parsed.messages) {
              const content = (m as { content?: unknown }).content;
              if (Array.isArray(content)) {
                for (const part of content as Array<Record<string, unknown>>) {
                  if (part && typeof part === 'object') {
                    delete part.annotations;
                  }
                }
              }
            }
          }
          body = JSON.stringify(parsed);
        } catch {
          /* not JSON — pass through */
        }
      }
      // Always log the URL + status so failures show up in server logs.
      // The OpenAI SDK rethrows non-2xx as `APIError(... no body)` because
      // it consumes the body for retry decisions before we see it. Tee a
      // clone of the body on error so we can log Databricks' actual reason.
      const url =
        typeof input === 'string'
          ? input
          : (input as URL | Request).toString?.() ?? String(input);
      // Log every outgoing request — URL + payload preview. Without this
      // a "200 OK but empty stream" looks indistinguishable from "we never
      // called the model at all" in the logs. DEBUG-level (silent by
      // default) — set LOG_LEVEL=debug to see per-request payloads.
      console.debug(
        `[openai-shim] → ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 2000) : '(non-string)'}`,
      );
      const tShim = Date.now();
      let resp: Response;
      try {
        const send = () =>
          fetch(input as Parameters<typeof fetch>[0], { ...init, headers, body, keepalive: false });
        if (usesSpFallback(ctx.req)) headers.set('Authorization', (await spAuthHeaders()).get('Authorization') ?? '');
        resp = await send();
        // The viewer's OBO token can be rejected by the serving gateway
        // (403 "Invalid Token"). Retry ONCE as the app service principal and
        // keep using it for the rest of this request.
        if ((resp.status === 401 || resp.status === 403) && ctx.req.headers['x-forwarded-access-token'] && !usesSpFallback(ctx.req)) {
          console.warn(`[openai-shim] OBO token rejected (${resp.status}) — retrying as app service principal`);
          markSpFallback(ctx.req);
          headers.set('Authorization', (await spAuthHeaders()).get('Authorization') ?? '');
          resp = await send();
        }
      } catch (e) {
        console.error('[openai-shim] fetch threw', { url, error: e });
        throw e;
      }
      console.debug(
        `[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get('content-type') ?? '?'})`,
      );
      if (!resp.ok) {
        try {
          const text = await resp.clone().text();
          let code: string | undefined;
          let message: string | undefined;
          try {
            const parsed = JSON.parse(text) as { error_code?: string; message?: string };
            code = parsed.error_code;
            message = parsed.message;
          } catch {
            /* body wasn't JSON — keep raw text */
          }
          if (ctx.modelError) {
            ctx.modelError.current = {
              status: resp.status,
              url,
              bodyText: text,
              code,
              message,
            };
          }
          console.error(
            `[openai-shim] ${resp.status} from ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 4000) : '(non-string)'}\n  response_body: ${text.slice(0, 4000)}`,
          );
        } catch (e) {
          console.error('[openai-shim] failed to clone error response', e);
        }
      }
      return resp;
    },
  });
  setDefaultOpenAIClient(client);
  // Use the Responses API (the SDK's default — we leave setOpenAIAPI alone).
  // This template ships with `databricks-gpt-5-4` as the baseline agent model
  // because it supports both the Responses API passthrough AND the SDK-native
  // `response.reasoning_summary_text.*` event stream (which the UI subscribes to
  // for the live "thinking" panel). A newer GPT endpoint with `/responses`
  // enabled works too — the requirement is the Responses API, not this version.
  //
  // Why not Claude (Sonnet 4.6 etc)? Databricks gates the Responses API
  // route per-model: Anthropic models on FMAPI return 400 BAD_REQUEST on
  // `/serving-endpoints/responses`. They DO work on `chat-completions`, but
  // the OpenAI Agents SDK doesn't surface Anthropic's thinking blocks as
  // typed events on that route, so the live reasoning UI goes silent.
  // Wiring it up (fetch-shim injection of extra_body.thinking + parse the
  // chunk stream → emit synthetic reasoning_summary_text events) is doable
  // but ~60-100 lines we haven't written. For now: GPT-5-4 only.
  setTracingDisabled(true); // disable OpenAI's tracing backend; we use MLflow
}

export function buildAgent(ctx: AgentContext): Agent {
  return new Agent({
    name: 'MetadataCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Metadata Copilot for Orbitline+, a streaming service, used by the content-operations (metadata)
team — Nadia Brooks, Metadata Lead — and by Daniel Okafor, VP Content Strategy. The library has 1,400 titles:
Orbitline Originals, Studio Licensed titles and the 420-title Harborlight Library acquired in April 2026 from a
legacy vendor feed with almost no metadata. Home rows, search and recommendations are TAG-DRIVEN, so poorly
tagged titles are barely shown. In a July pilot editors hand re-tagged 40 Harborlight titles.

TOOLS
- ask_data: the Genie agent. (a) Any question about impressions, play starts, completion, share of impressions vs share of
  catalogue, the July re-tag pilot, hidden gems or brand-safety counts — SQL over the governed gold tables. (b) Any rule
  question (warnings, ratings, kids rows, brand-safety tiers, completeness), from the Standards Guide — quote the section.
- find_titles: what is in the live work queue right now (e.g. "which kids-row titles are missing warnings?").
- more_like_this / find_clips: Vector Search — similar titles, and clips to repurpose for promos or collections.

RULES
- Default window: the last 4 complete weeks. Compare Harborlight with the rest of the library per title or as
  share of impressions vs share of catalogue — never raw totals across groups of different sizes.
- Lead with the answer and the number in **bold** on line one. Be concise (≤ 8 lines unless asked).
- Numbers come from tools, never from memory. Name the source (Genie / Standards Guide / live queue / Vector Search).
- You never publish metadata yourself — the editor reviews and approves every change in the title workbench.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

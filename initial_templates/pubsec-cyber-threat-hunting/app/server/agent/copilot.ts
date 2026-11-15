/**
 * Threat Hunting Copilot chat agent (the floating dock).
 *
 * Tools:
 *   ask_data         — the Genie agent (Agent mode): SOC / CISO analytics over the governed telemetry (MTTD/MTTR,
 *                      alert volume vs true positives, rule efficacy, ATT&CK coverage, spray scoping) AND the
 *                      CSOC incident-response playbook documents (cited)
 *   find_leads       — the live Lakebase UEBA lead queue for "what should I work next?"
 *
 * The per-lead investigation itself is NOT a chat tool — it runs from the lead
 * workbench (services/investigate.ts) so its timeline + ATT&CK map render as UI.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { findLeadsForAgent } from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
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

/** Genie agent id, set at boot from config/app.json (server.ts); both fall back to
 *  <catalog>.<schema>.demo_resources (written by the setup job) — see ensureCopilotBackends. */
const backends = { genieSpaceId: '' };
export function configureCopilotAgent(b: { genieSpaceId?: string }) {
  backends.genieSpaceId = b.genieSpaceId ?? '';
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
    name: 'find_leads',
    description: 'List the live UEBA investigation queue (Lakebase): lead id, entity, risk score, priority, top factors, status, AI verdict and incident case if already investigated.',
    parameters: z.object({
      include_closed: z.boolean().describe('true = include escalated / closed-as-benign leads'),
      limit: z.number().int().describe('Max rows, 1-25'),
    }),
    execute: async ({ include_closed, limit }) => {
      const rows = await findLeadsForAgent(ctx.db, { include_closed, limit: Math.max(1, Math.min(25, limit)) });
      return { count: rows.length, leads: rows };
    },
  }));
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
  // root `threat_hunting_copilot.turn` and per-tool `withSpan` wrappers.
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
    name: 'ThreatHuntingCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Threat Hunting Copilot of the Cascadia Security Operations Center (CSOC), which defends the Cascadia
Department of Revenue (CDOR: 1,180 staff, taxpayer data incl. Federal Tax Information). Users: Maya Okafor (tier-2
threat hunter) and Gloria Tran (CISO). All data is synthetic (documentation IP ranges, .example domains).

TOOLS
- ask_data: the Genie agent. (a) Any question about incidents (MTTD / MTTR), alert volume and true-positive rates by
  detection rule, ATT&CK detection coverage, failed sign-ins / password-spray scoping, UEBA risk, DNS, VPN or endpoint
  telemetry — SQL over the governed tables. (b) Severity, escalation, notification deadlines, response steps, containment
  actions from the IR playbook — quote its citation.
- find_leads: what is in the live UEBA queue right now and what has been investigated / escalated.

RULES
- Lead with the answer and the number in **bold** on line one. Be concise (<= 8 lines unless asked).
- Numbers come from tools, never from memory. Name the source (Genie / IR playbook / live queue).
- Log telemetry covers the 90 days ending at the latest event ("this week / last 30 days" is relative to that); the
  incidents history covers 18 months. Pass the user's question to Genie in their words — never add a time window they
  did not ask for (MTTD / MTTR = all incidents unless a period is named). Give hours AND days when above 48 hours.
- To investigate a specific lead end to end, point the analyst to the lead workbench (Leads → the lead → Investigate);
  you do not open or close incident cases yourself.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

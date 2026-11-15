/**
 * GridOps copilot — the control-room agent (OpenAI Agents SDK on a Databricks
 * Foundation Model endpoint via the Responses API).
 *
 * Tools (read tools hit the same Delta gold tables as the UI via grid/queries.ts):
 *   get_grid_overview      → system KPIs + every transformer's forecast peak / health / risk
 *   get_transformer_risk   → one asset: forecast curve summary, DGA trend, critical facilities, past outages
 *   get_relief_options     → the costed options (DR / switching / DER) with post-action peak + hot-spot
 *   ask_data              → open-ended analytics over the Genie space (SAIDI, outages, DR enrollments…)
 *   log_operator_action    → WRITE: logs the approved option to operator_actions (only after explicit approval)
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import type { Tool } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { getExecutionContext } from '@databricks/appkit';
import { authHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { askDataTool } from './tools/genie.js';
import { assetDetail, gridOverview, logAction, reliefOptions, transformerCurve } from '../grid/queries.js';
export type { ToolProgressEvent } from './tools/types.js';

export type ModelErrorDetail = {
  status: number;
  url: string;
  bodyText: string;
  code?: string;
  message?: string;
};

export type AgentContext = {
  db: AppDb;
  userEmail: string;
  req: Request;
  genieSpaceId: string;
  databricksHost: string;
  model: string;
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  modelError?: { current: ModelErrorDetail | null };
};

const span = <T>(name: string, inputs: Record<string, unknown>, fn: () => Promise<T>) =>
  mlflow.withSpan(async () => fn(), { name, spanType: mlflow.SpanType.TOOL, inputs });

function makeTools(ctx: AgentContext): Tool[] {
  const overview = tool({
    name: 'get_grid_overview',
    description:
      'System-wide snapshot: load now vs capacity, tomorrow\'s forecast system peak, forecast high temperature, SAIDI/SAIFI, and EVERY transformer with loading now, forecast peak % of nameplate, forecast hot-spot, health index, overload risk tier, customers served and risk drivers. Call this first for any "what is at risk" question.',
    parameters: z.object({}),
    execute: async () => span('get_grid_overview', {}, async () => {
      const o = await gridOverview();
      return JSON.stringify({
        kpi: o.kpi,
        transformers: o.transformers.map((t) => ({
          transformer_id: t.transformer_id, substation: t.substation_name, nameplate_mva: t.nameplate_mva,
          loading_now_pct: t.loading_now_pct, forecast_peak_pct: t.forecast_peak_pct, forecast_peak_at: t.forecast_peak_at,
          forecast_peak_hot_spot_c: t.forecast_peak_hot_spot_c, health_index: t.health_index, health_tier: t.health_tier,
          overload_risk: t.overload_risk, customers_served: t.customers_served,
        })),
      });
    }),
  });

  const risk = tool({
    name: 'get_transformer_risk',
    description:
      'Deep dive on ONE transformer: health + risk drivers, the 48 h forecast (peak, hours over nameplate, hot-spot, insulation aging factor, P90 band), recent SCADA trend, DGA gas history, critical facilities served, feeders and worst past outages. Use to EXPLAIN why an asset is at risk.',
    parameters: z.object({ transformer_id: z.string().describe('Transformer id, e.g. "T-104"') }),
    execute: async ({ transformer_id }) => span('get_transformer_risk', { transformer_id }, async () => {
      const o = await gridOverview();
      const h = o.transformers.find((t) => t.transformer_id === transformer_id);
      if (!h) return `Unknown transformer ${transformer_id}. Known: ${o.transformers.map((t) => t.transformer_id).join(', ')}`;
      const [c, d] = await Promise.all([transformerCurve(transformer_id), assetDetail(transformer_id)]);
      const fc = c.forecast as Array<Record<string, number | string>>;
      const over = fc.filter((r) => Number(r.forecast_loading_pct) > 100);
      return JSON.stringify({
        health: h,
        forecast_summary: {
          hours_over_nameplate: over.length,
          first_hour_over: over[0]?.ts ?? null, last_hour_over: over[over.length - 1]?.ts ?? null,
          peak: fc.reduce((a, r) => (Number(r.forecast_mva) > Number(a.forecast_mva) ? r : a), fc[0]),
        },
        last_6h_actual: (c.actual as unknown[]).slice(-6),
        dga_last_6_samples: (d.dga as unknown[]).slice(-6),
        critical_facilities: d.facilities, feeders: d.feeders, worst_past_outages: d.outages,
      });
    }),
  });

  const options = tool({
    name: 'get_relief_options',
    description:
      'The costed load-relief options for a transformer forecast above 95%: demand response, feeder switching (tie switch), DER dispatch (battery/solar). Each has relief at peak (MVA), cost ($), customers affected + impact, N-1 redundancy impact, post-action peak % and hot-spot, whether it clears the overload, side effect on the receiving transformer, composite risk score and recommended_rank (1 = best).',
    parameters: z.object({ transformer_id: z.string().describe('Transformer id, e.g. "T-104"') }),
    execute: async ({ transformer_id }) => span('get_relief_options', { transformer_id }, async () => {
      const r = await reliefOptions(transformer_id);
      if (!r.options.length) return `No relief options: ${transformer_id} is not forecast above 95% of nameplate.`;
      return JSON.stringify(r.options);
    }),
  });

  const logIt = tool({
    name: 'log_operator_action',
    description:
      'WRITE ACTION. Dispatches + logs the chosen relief option to the operator_actions table (the control-room action log). ONLY call after the operator has explicitly approved a specific option in this conversation (e.g. "approve option 1", "go with demand response", "yes, dispatch it").',
    parameters: z.object({
      option_id: z.string().describe('The option_id from get_relief_options, e.g. "T-104-OPT1"'),
      rationale: z.string().describe('One or two sentences: why this option was chosen over the others, with the numbers.'),
    }),
    execute: async ({ option_id, rationale }) => span('log_operator_action', { option_id }, async () =>
      JSON.stringify(await logAction({ option_id, rationale, operator: ctx.userEmail, source: 'copilot' }))),
  });

  const tools: Tool[] = [overview, risk, options, logIt];
  if (ctx.genieSpaceId) tools.push(askDataTool(ctx, ctx.genieSpaceId));
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
  // root `refundops.turn` and per-tool `withSpan` wrappers.
  //
  // Use a custom fetch that forces a fresh TCP connection per call and
  // disables keep-alive. Without this, after a long-running tool call
  // (ask_data → Genie can take ~60s), the second Responses API call reuses a
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
        resp = await fetch(input as Parameters<typeof fetch>[0], {
          ...init,
          headers,
          body,
          keepalive: false,
        });
      } catch (e) {
        console.error('[openai-shim] fetch threw', { url, error: e });
        throw e;
      }
      // The viewer's forwarded OBO token can be rejected by the model gateway
      // (403 "Invalid Token" — e.g. a token minted before the app's scopes were
      // granted). Retry ONCE as the app service principal, which holds CAN_QUERY
      // on the endpoint (app resource "agent-model"). The body is a string, so it
      // can be resent as-is.
      if ((resp.status === 401 || resp.status === 403) && ctx.req.headers['x-forwarded-access-token']) {
        try {
          const sp = new Headers();
          await getExecutionContext().client.config.authenticate(sp);
          const spAuth = sp.get('Authorization');
          if (spAuth) {
            console.warn(`[openai-shim] ${resp.status} with user token from ${url} — retrying as app service principal`);
            headers.set('Authorization', spAuth);
            resp = await fetch(input as Parameters<typeof fetch>[0], { ...init, headers, body, keepalive: false });
          }
        } catch (e) {
          console.error('[openai-shim] SP fallback failed', e);
        }
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
    name: 'GridOps',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are GridOps, the control-room copilot of Midwest Regional Electric Cooperative (MREC):
6 substations, 12 power transformers, 40 feeders, ~154k customers. The operator talking to you is on shift in
the distribution control room. "Now" is Tuesday 21 July 2026 14:00 (heat wave, day two); "tomorrow" is
Wednesday 22 July. Timestamps in the data are local wall-clock time (ignore any "Z").

Reference limits: loading > 100% of nameplate = overload; emergency rating = 120% for 2-4 h. Winding hot-spot
design limit 110°C, emergency 120°C. Aging factor = how many times faster than normal the insulation ages.
Health index 0-100 (Poor < 45). DGA: rising ethylene/acetylene = thermal fault; IEEE C57.104 Condition 3 = high gassing.

HOW TO WORK
- "What's at risk / what should I worry about" → get_grid_overview, then get_transformer_risk for the worst asset.
  Explain the risk as a chain: weather (forecast high) → load (forecast peak %, hours over nameplate, when) →
  thermal (hot-spot vs 110/120°C, aging factor) → condition (health index, DGA trend, age) → consequence
  (customers served, critical facilities incl. hospitals / cooling centers, the last outage on this asset).
  Mention the healthy "watch" asset briefly so the operator knows you checked it.
- "What are my options / what should I do" → get_relief_options and RANK them in a markdown table with columns:
  Rank | Option | Relief @ peak | Cost | Customers affected | Post-action peak | Hot-spot | Clears? | N-1.
  Keep the Option cell to the option_type (e.g. "Demand response") so the table fits the chat panel.
  Then give a one-paragraph recommendation that trades off cost, customers affected and residual thermal risk,
  and say explicitly what is wrong with the runner-ups (e.g. switching pushes the neighbour transformer to ~100%
  and removes redundancy; the battery alone does not clear the overload). Then ASK for approval
  ("Reply 'approve option 1' to dispatch"). DO NOT call log_operator_action in the same turn.
- Only when the operator explicitly approves a specific option → call log_operator_action once with that option_id
  and a rationale containing the numbers. Confirm with the action id, what happens next (e.g. DR event notice at
  13:00 for 15:00-20:00), and the expected post-action peak and hot-spot.
- Open-ended analytics (SAIDI/SAIFI, outage history, DR enrollment, weather, other assets) → ask_data.

STYLE
Lead with the answer in one bold line. Numbers from tools only — never invent. Percent with 1 decimal, MVA with
2, dollars rounded. Short sections, bullet points, no preamble. Write temperatures with the degree sign
(e.g. "123°C").`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

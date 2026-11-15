/**
 * PdM Copilot agent — the reliability engineer's assistant for TechRobotics Greenville Plant 2.
 *
 * OpenAI Agents SDK on the Databricks Responses API (databricks-gpt-5-4). Tools:
 *   get_fleet_risk / get_asset_details / find_pm_batch  → Lakebase mirror (ML scores, CMMS history)
 *   ask_data     → the Genie agent (Agent mode): OEE, downtime, MTBF, failure history analytics AND the plant
 *                  manuals volume (standards, CAPA reports, SOW, MPS-004), cited
 *   check_parts / list_windows → MRO inventory + planned maintenance windows (Lakebase)
 *   book_work_order → WRITE: work order + part reservation + window booking (transactional)
 * The SDK plumbing (configureAgentsSdk) is the template's, unchanged.
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
import {
  bookWorkOrder,
  findParts,
  getAsset,
  listFleet,
  listWindows,
  recentPmBatch,
} from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
import { resolvedBackends } from '../services/resources.js';
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
  /** Genie Agent space id (tables + documents volume) the `ask_data` tool queries. */
  genieSpaceId: string;
  databricksHost: string;
  model: string;
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  modelError?: { current: ModelErrorDetail | null };
};

const span = <T>(name: string, inputs: Record<string, unknown>, fn: () => Promise<T>) =>
  mlflow.withSpan(fn, { name, spanType: mlflow.SpanType.TOOL, inputs });

function makeTools(ctx: AgentContext) {
  const getFleetRisk = tool({
    name: 'get_fleet_risk',
    description:
      'Current ML failure-risk ranking of the fleet (failure_risk_model@champion scores, refreshed daily). Returns the top-N assets with risk_score (0-100 = P(failure within 7 days)), risk_tier, predicted_failure_mode, est_days_to_failure, downtime_cost_at_risk_usd, top drivers, last PM vendor + lubricant, and whether a work order is already booked.',
    parameters: z.object({
      line: z.string().nullable().describe('Exact line name to filter (e.g. "Line 2 — Robotic Assembly") or null for the whole plant'),
      top_n: z.number().int().min(1).max(48).describe('How many assets to return, highest risk first (typically 5)'),
    }),
    execute: async ({ line, top_n }) =>
      span('get_fleet_risk', { line, top_n }, async () =>
        (await listFleet(ctx.db, { line: line ?? undefined })).slice(0, top_n)),
  });

  const getAssetDetails = tool({
    name: 'get_asset_details',
    description:
      'Everything about one asset: registry (model, line, downtime cost/hr, bottleneck), ML risk + drivers, condition trend (first vs latest of the last 60 days: vibration, temperature vs baseline), the last 12 CMMS work orders (vendor, technician, LUBRICANT USED, notes), failure history with root causes, and any booked work orders.',
    parameters: z.object({ asset_id: z.string().describe('Asset id, e.g. RA-207, CNC-108') }),
    execute: async ({ asset_id }) =>
      span('get_asset_details', { asset_id }, async () => {
        const a = await getAsset(ctx.db, asset_id.toUpperCase());
        if (!a) return { error: `asset ${asset_id} not found` };
        const t = a.trend;
        const pick = (r: Record<string, unknown> | undefined) =>
          r ? { day: r.day, vibration: r.vibration, vibration_baseline: r.vibration_baseline, temperature: r.temperature, temperature_baseline: r.temperature_baseline, pressure: r.pressure } : null;
        const drift = t.find((r) => Number(r.vibration) > 1.25 * Number(r.vibration_baseline));
        return {
          asset: a.asset,
          trend: { first: pick(t[0]), drift_started: drift ? drift.day : null, day_minus_7: pick(t[t.length - 8]), latest: pick(t[t.length - 1]) },
          maintenance_history: a.history,
          failures: a.failures,
          work_orders: a.work_orders,
        };
      }),
  });

  const findPmBatch = tool({
    name: 'find_pm_batch',
    description:
      'Find every asset that received a PREVENTIVE work order in the last N days matching a lubricant and/or vendor — answers "is this one machine, or one maintenance event?". Returns asset, model, current risk, the PM work order, date, vendor, lubricant and notes.',
    parameters: z.object({
      lubricant_contains: z.string().nullable().describe('Substring of the lubricant used, e.g. "Mobilgrease" — or null'),
      vendor: z.string().nullable().describe('Substring of the vendor, e.g. "Carolina" — or null'),
      days: z.number().int().min(1).max(365).describe('Look-back window in days (e.g. 45)'),
    }),
    execute: async (args) => span('find_pm_batch', args, async () => recentPmBatch(ctx.db, args)),
  });


  const checkParts = tool({
    name: 'check_parts',
    description:
      'Search MRO spare-parts inventory (Lakebase, live — includes reservations made by booked work orders). Returns part_number, description, compatible_models, available_at_plant (on hand minus reserved), regional_dc_qty (Charlotte DC, 1-day transfer), unit_cost_usd, lead_time_days.',
    parameters: z.object({
      model: z.string().nullable().describe('Asset model to filter compatible parts, e.g. "M-20iD" — or null'),
      query: z.string().nullable().describe('Keyword in description/part number, e.g. "reducer", "grease", "filter" — or null'),
    }),
    execute: async (args) => span('check_parts', args, async () => findParts(ctx.db, args)),
  });

  const windowsTool = tool({
    name: 'list_windows',
    description:
      'Upcoming planned maintenance windows (zero production impact). capacity_hours = 2 parallel crews x window length (an 8 h Saturday window = 16 h); each job consumes its own duration once, whatever its crew size. Returns booked_hours and free_hours. Filter by exact line name or null for all.',
    parameters: z.object({ line: z.string().nullable().describe('Exact line name or null') }),
    execute: async ({ line }) => span('list_windows', { line }, async () => listWindows(ctx.db, line)),
  });

  const book = tool({
    name: 'book_work_order',
    description:
      'WRITE. Book ONE planned work order for ONE asset into a maintenance window, reserving the parts (plant crib first, else Charlotte DC transfer) and the window hours, flipping the asset to work_order_booked, and computing risk-weighted unplanned cost avoided (failure_prob_7d x expected unplanned failure cost) and net savings (minus parts + labor). Transactional: fails cleanly if parts or window capacity are insufficient. ONLY call after the user explicitly approved the plan. Call once per asset.',
    parameters: z.object({
      asset_id: z.string().describe('Asset id, e.g. RA-207'),
      priority: z.string().describe('P1 | P2 | P3 per MPS-004'),
      title: z.string().describe('Short work-order title, e.g. "J3 reducer replacement + RE0 grease purge"'),
      root_cause: z.string().describe('One-sentence root cause as diagnosed (cite evidence)'),
      tasks: z.array(z.string()).describe('Ordered task list for the technicians'),
      window_id: z.string().describe('Maintenance window id from list_windows'),
      duration_hours: z.number().describe('Job duration in hours as given by the manuals (8 for a J3 reducer replacement, 3 for an RE0 purge x2 + inspection) — NOT multiplied by the number of technicians'),
      technicians: z.string().describe('Who, e.g. "2 FANUC-certified robotics techs (T-05 Tom Kowalski, weekend)"'),
      technician_count: z.number().int().min(1).max(4).describe('Number of technicians'),
      parts: z.array(z.object({ part_number: z.string(), qty: z.number().int().min(1) })).describe('Parts to reserve'),
    }),
    execute: async (args) =>
      span('book_work_order', { asset_id: args.asset_id, window_id: args.window_id }, async () => {
        try {
          return await bookWorkOrder(ctx.db, { ...args, asset_id: args.asset_id.toUpperCase(), userEmail: ctx.userEmail, source: 'agent' });
        } catch (e) {
          return { error: (e as Error).message };
        }
      }),
  });

  const tools: Tool[] = [getFleetRisk, getAssetDetails, findPmBatch, checkParts, windowsTool, book];
  if (process.env.GENIE_SPACE_ID) tools.push(askDataTool(ctx, process.env.GENIE_SPACE_ID));
  return tools;
}


export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  // Genie agent id: env, else <catalog>.<schema>.demo_resources (fills process.env, which makeTools reads).
  await resolvedBackends();
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
      console.debug(
        `[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get('content-type') ?? '?'})`,
      );
      // SP fallback: if the model call is rejected with the forwarded USER token
      // (401/403 — e.g. the user's OBO token lacks the model-serving scope or the
      // endpoint permission), retry ONCE as the app service principal. The body
      // is a string, so it can be resent as-is.
      if ((resp.status === 401 || resp.status === 403) && ctx.req.headers['x-forwarded-access-token']) {
        try {
          const spAuth = new Headers();
          await getExecutionContext().client.config.authenticate(spAuth);
          const spBearer = spAuth.get('Authorization');
          if (spBearer) {
            console.warn(`[openai-shim] ${resp.status} with user token from ${url} — retrying with app SP`);
            headers.set('Authorization', spBearer);
            resp = await fetch(input as Parameters<typeof fetch>[0], { ...init, headers, body, keepalive: false });
          }
        } catch (e) {
          console.error('[openai-shim] SP fallback failed', e);
        }
      }
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
    name: 'PdMCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are PdM Copilot, the AI assistant of Marcus Chen, Plant Reliability Engineer at TechRobotics
Industries, Greenville SC Plant 2 (precision servo actuators). 48 assets: Line 1 Precision Machining
(CNC), Line 2 Robotic Assembly (FANUC/ABB robots; RA-207 is the line BOTTLENECK, $12,800/h),
Line 3 Press & Test, Utilities (compressors). Be decisive and technical, lead with the asset and the
number, cite evidence (sensor figures, work-order ids, document ids). Markdown, short.

TOOLS
- get_fleet_risk(line, top_n): ML failure-risk ranking (failure_risk_model@champion).
- get_asset_details(asset_id): risk + drivers, condition trend, last 12 work orders (incl. lubricant
  used + notes), failures + root causes, booked work orders.
- find_pm_batch(lubricant_contains, vendor, days): which assets got the same PM (vendor/lubricant).
- ask_data(question): the Genie agent. (a) The plant manuals (standards, CAPA reports, SOW, MPS-004):
  approved lubricants, failure symptoms, corrective procedures, durations, part numbers, policy — cite them.
  (b) Plant analytics (OEE, unplanned downtime, MTBF, failure history) — trend/aggregate KPI questions,
  not single-asset diagnosis. One focused question per call.
- check_parts(model, query), list_windows(line): MRO inventory + planned windows (live).
- book_work_order(...): WRITE — only after explicit approval.

MODE A — DIAGNOSE ("which machine / why / what's going on")
1. get_fleet_risk(null, 5). 2. get_asset_details on the top asset. 3. If the drift started after a PM,
   look at that PM's vendor + lubricant; call ask_data ONCE with a focused manuals question (e.g. "Is
   Mobilgrease XHP 222 approved for FANUC M-20iD reducers, what are the symptoms of wrong grease, and
   what is the corrective procedure?"). Mention prior failures with the same root cause (e.g. RA-203).
Answer shape: **headline** (asset, risk score, est. days to failure, $ exposure) · "Why" (3 bullets:
sensor drift with numbers, maintenance-history evidence with WO id + lubricant, manual/CAPA citation) ·
"What the model sees vs what history adds" in one line · recommended action in one line.

MODE A2 — SCOPE ("is it just this one?", "who else?")
Call find_pm_batch with the suspicious lubricant/vendor (45 days). For each asset: risk tier + whether it
is drifting. Call out explicitly any asset the model scores Healthy that got the same PM — the model
cannot see it yet (no drift) but the maintenance history says it is exposed. Recommend a campaign.

MODE B — PLAN + BOOK (human in the loop)
Phase 1 (read-only): list_windows for the line, check_parts(model, "reducer"/"grease"/"seal"...) and
ask_data if you need procedure durations from the manuals. Build ONE plan table: asset | work | window | crew-hours |
technicians | parts (part number x qty, source crib/DC) — window capacity = 2 parallel crews x window length, and each job consumes its duration ONCE (do not multiply by
technicians). Job durations per ES-ROB-014 — ONE duration per asset, never summed within an asset:
vibration > 2x baseline → J3 reducer replacement = 8 h TOTAL (the new reducer is filled with RE0 as part of
that 8 h job — do NOT add purge hours on top), 2 FANUC-certified techs; otherwise RE0 purge x2 + J3 inspection
= 3 h, 1 tech. So the Line 2 campaign is RA-207 8 h + RA-211 3 h + RA-214 3 h = 14 h, which FITS the next 16 h
Saturday Line 2 window: plan and book all three in that SAME window (only split if list_windows shows less
free time). Parts: prefer plant crib; RE0 grease is out at the crib →
Charlotte DC 1-day transfer (arrives before Saturday). Estimate cost avoided = failure_prob_7d x
unplanned_failure_cost_usd per asset. Then STOP and ask: "Reply **book it** to create the work orders."
Phase 2 (after approval: book / go / yes / approve): call book_work_order once per asset with the exact
plan. Then summarize from the TOOL RESULTS only: work order ids, window, parts reserved (+ DC transfers),
risk-weighted unplanned cost avoided, net savings, total. If a tool returns an error, say so plainly.
Never claim a booking that the tool did not return.

Never invent part numbers, windows or work orders — use tool outputs. No preamble.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

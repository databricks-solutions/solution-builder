/**
 * Trial Site Copilot chat agent (the floating dock).
 *
 * Tools:
 *   ask_data               — the Genie agent (Agent mode): portfolio analytics over the Delta gold tables AND the
 *                            CASCADE-CKD protocol / SAP / feasibility / amendment SOP documents (cited)
 *   screen_fail_breakdown  — screen failures by REAL criterion (AI Functions read of coordinator notes) vs what sites coded
 *   simulate_amendment     — eligible pool + projected last-patient-in with and without the E4 amendment / rescue sites
 *   rank_rescue_sites      — candidate sites scored by site_enrollment_model@champion
 *   site_performance       — active sites: zero enrollers, competing-trial overlap, top enrollers
 *   rescue_plan_status     — the study manager's latest decision + site actions (Lakebase)
 *
 * The full rescue analysis with its memo is NOT a chat tool — it runs from the
 * trial workbench (services/rescue.ts) so its projection + site list render as UI.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { planStatusForAgent } from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
import * as td from '../services/trial-data.js';
import { resolvedBackends, type Backends } from '../services/resources.js';
import { gatherFacts, DEFAULT_RESCUE_SITES } from '../services/rescue.js';
import { project } from '../../shared/projection.js';
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

/** Focus trial, set once at boot from config/app.json (server.ts). The Genie agent id is resolved
 *  per agent build by services/resources.ts (env first, else <catalog>.<schema>.demo_resources). */
const settings = { trialId: 'CASCADE-CKD' };
export function configureTrialAgent(b: { trialId?: string }) {
  settings.trialId = b.trialId || 'CASCADE-CKD';
}

const span = <T>(name: string, inputs: Record<string, unknown>, fn: () => Promise<T>) =>
  mlflow.withSpan(fn, { name, spanType: mlflow.SpanType.TOOL, inputs });

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext, backends: Backends) {
  const tools = [];
  const T = settings.trialId;
  if (backends.genieSpaceId) tools.push(askDataTool(ctx, backends.genieSpaceId));
  tools.push(tool({
    name: 'screen_fail_breakdown',
    description: `Screen failures for ${T} by their REAL criterion — site-coded, or read from the coordinator's free-text note by AI Functions (ai_classify) when the site coded OTHER — next to what the sites coded, with first-6 vs last-6 month counts and how many SGLT2i failures were on a stable dose (ai_query).`,
    parameters: z.object({}),
    execute: async () => span('screen_fail_breakdown', {}, async () => {
      const [rows, coded, trend] = await Promise.all([td.screenFails(T), td.codedReasons(T), td.e4Trend(T)]);
      const total = rows.reduce((a, r) => a + r.n, 0);
      return { total_screen_failures: total, by_real_criterion: rows.map((r) => ({ ...r, share: Math.round((r.n / total) * 1000) / 10 })), as_coded_by_sites: coded, e4_share_by_quarter: trend };
    }),
  }));
  tools.push(tool({
    name: 'simulate_amendment',
    description: `Eligible-patient pool around the ${T} active sites (EHR network) under the current protocol vs with the E4 amendment (stable SGLT2i allowed), and the projected last-patient-in date for status quo / amendment only / amendment + the top N model-ranked rescue sites.`,
    parameters: z.object({ rescue_sites: z.number().int().describe(`How many top-ranked rescue sites to add (0-30). Use ${DEFAULT_RESCUE_SITES} — the workbench default — unless the user asks for another number`) }),
    execute: async ({ rescue_sites }) => span('simulate_amendment', { rescue_sites }, async () => {
      const f = await gatherFacts(T);
      const n = Math.max(0, Math.min(30, rescue_sites));
      const sel = f.rescue_sites.slice(0, n);
      const sc = project(f.params, sel);
      return { enrollment: f.enrollment, eligible_pool: f.pool, amendment_effect: { existing_site_rate_multiplier: f.params.amendmentUplift, rescreen_recoverable_patients: f.params.rescreenBolus, effective_after_months: f.params.amendmentLagMonths },
        scenarios: sc.map((s) => ({ scenario: s.label, last_patient_in: s.lpi_date, months_late_vs_plan: s.months_late, monthly_rate_at_end: s.monthly_rate_end })), planned_lpi: f.enrollment.planned_lpi };
    }),
  }));
  tools.push(tool({
    name: 'rank_rescue_sites',
    description: 'Candidate sites (not yet in the trial) ranked by site_enrollment_model@champion: predicted randomized/month with the E4 amendment, months to activate, expected randomizations in 12 months, eligible pool, competing trials.',
    parameters: z.object({
      region: z.string().nullable().describe('US region filter: Southeast | South Central | Midwest | Mountain West | West | Northeast, or null'),
      include_competitor_sites: z.boolean().describe('true = also show sites already running a competing DKD trial (normally excluded)'),
      limit: z.number().int().describe('Max rows, 1-25'),
    }),
    execute: async ({ region, include_competitor_sites, limit }) => span('rank_rescue_sites', { region, include_competitor_sites, limit }, async () => {
      const rows = await td.candidates({ region, includeCompetitors: include_competitor_sites, limit: Math.max(1, Math.min(25, limit)) });
      return { model: 'site_enrollment_model@champion', count: rows.length, sites: rows };
    }),
  }));
  tools.push(tool({
    name: 'site_performance',
    description: `Active ${T} sites: randomized, rate per month, screen-fail rate, activation cycle time, zero-enroller flag, and competing-trial overlap (randomization rate before vs after REDWOOD-CKD opened at the site).`,
    parameters: z.object({ filter: z.enum(['zero_enrollers', 'competitor_overlap', 'top_enrollers', 'slow_startup']).describe('Which slice of the site list to return') }),
    execute: async ({ filter }) => span('site_performance', { filter }, async () => {
      const all = (await td.sitePerformance(T));
      const rows = filter === 'zero_enrollers' ? all.filter((s) => s.is_zero_enroller)
        : filter === 'competitor_overlap' ? all.filter((s) => s.has_competing_trial)
          : filter === 'slow_startup' ? all.filter((s) => s.status !== 'active' || (s.cycle_time_days ?? 0) > 220)
            : all.filter((s) => s.status === 'active').slice(0, 12);
      return { count: rows.length, sites: rows };
    }),
  }));
  tools.push(tool({
    name: 'rescue_plan_status',
    description: 'The latest enrollment-rescue plan and the study manager decision (Lakebase): approved/rejected/draft, who decided, which sites were sent to start-up or put under closure review.',
    parameters: z.object({}),
    execute: async () => span('rescue_plan_status', {}, () => planStatusForAgent(ctx.db, T)),
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
  // root `trial_copilot.turn` and per-tool `withSpan` wrappers.
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

export async function buildAgent(ctx: AgentContext): Promise<Agent> {
  const b = await resolvedBackends();
  return new Agent({
    name: 'TrialSiteCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Trial Site Copilot for Halcyra Therapeutics clinical operations, used by Dr. Elena Marsh (Global Study Manager,
CASCADE-CKD) and Raj Patel (VP Clinical Operations). Halcyra runs 5 active trials. CASCADE-CKD (HAL-301) is a Phase III,
placebo-controlled study of velmeraptan (a non-steroidal MRA) in type 2 diabetes + chronic kidney disease: target 1,200
randomized at ~72 US sites over 24 months. It is badly behind plan.

TOOLS
- ask_data: the Genie agent. (a) Portfolio questions across the 5 trials (enrollment vs plan, screen-fail reasons, site
  activation cycle time, competing trials, site league tables) — SQL over the governed gold tables. (b) Anything about
  the protocol, SAP, feasibility assumptions or the amendment SOP, from the documents — always quote its citations.
- screen_fail_breakdown: WHY patients fail screening in CASCADE-CKD. Use the REAL criterion (AI-read notes), and point out
  when the site-coded EDC report under-counts it.
- simulate_amendment: eligible pool and projected last-patient-in (LPI) for status quo / amendment / amendment + rescue sites.
- rank_rescue_sites: which new sites to add (ML model scores).
- site_performance: zero enrollers, competitor overlap, top enrollers, slow start-up.
- rescue_plan_status: what the study manager already approved.

RULES
- Lead with the answer and the key number in **bold** on line one. Be concise (≤ 10 lines unless asked); use a short
  markdown table for site lists.
- Numbers and dates come from tools, never from memory. Name the source (Genie / screening log + AI Functions / protocol
  assistant / site model / projection).
- E4 (SGLT2 inhibitor within 12 weeks) is an efficacy-design criterion; E7 (potassium) is a safety criterion that only
  the DSMB can relax after its first unblinded review — never recommend relaxing E7 now.
- Race/ethnicity is only for the diversity action plan, never for selecting or excluding patients.
- You recommend; the study manager approves the rescue plan in the trial workbench.
`.trim(),
    tools: makeTools(ctx, b),
  });
}

export { run };

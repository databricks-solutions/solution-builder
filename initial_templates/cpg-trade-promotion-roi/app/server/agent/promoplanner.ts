/**
 * Trade Promo Copilot — the promo-planner agent (the floating dock + /c/:id).
 *
 * Built on `@openai/agents` pointed at Databricks' Responses API. Tools capture `db` + the
 * request via closure so every write is attributed to the viewing user.
 *
 * Tools:
 *   get_promo_calendar       — next quarter's draft calendar with the as-planned forecast (Lakebase)
 *   get_post_event_analysis  — the evidence: how a retailer x tactic performed historically, netted for
 *                              pantry loading, cannibalization and forward buying (Lakebase mirror of gold)
 *   get_replan_options       — the candidate tactics for planned events with forecast net profit, ROI,
 *                              volume and the TPG-2027 policy check (Lakebase mirror of gold_plan_scenarios)
 *   ask_data                 — the Genie agent (Agent mode): ad-hoc analytics over the gold tables AND the
 *                              trade-policy documents (TPG-2027, PEA-2027, the ValuMax JBP, trade terms), cited
 *   approve_replan           — WRITE-BACK: swaps the tactic of the approved events in Lakebase and logs the
 *                              decision (only after the user explicitly approves)
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { applyReplan, getPlanEvent, listPlan, listScenarios, postEventSummary } from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { resolvedBackends, type Backends } from '../services/resources.js';
export type { ToolProgressEvent } from './tools/types.js';

/** Captured detail of the last failing call to the model serving endpoint (see the fetch shim). */
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

/** Genie agent id, resolved per turn: app.json/env first, else <schema>.demo_resources
 *  (written by the setup job) — see services/resources.ts. */
const backends: Backends = { genieSpaceId: '' };

const money = (n: number | null | undefined) => (n == null ? null : Math.round(n));
const pct = (n: number | null | undefined) => (n == null ? null : Math.round(n * 1000) / 10);

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext) {
  const tools = [];
  tools.push(tool({
    name: 'get_promo_calendar',
    description: "Next quarter's draft promo calendar (13 weeks) with the as-planned forecast of every event: retailer, SKU, week, tactic, depth, funding (off-invoice / scan-based), forecast units, trade spend, net profit, ROI and flag (Money-losing = forecast net profit < 0; Below target = ROI < +15%; On track). Also shows whether an event was already re-planned. Filter by retailer or flag, or pass nulls for everything.",
    parameters: z.object({
      retailer: z.string().nullable().describe('Retailer name or id (e.g. "ValuMax"), or null for all'),
      flag: z.string().nullable().describe('"Money-losing", "Below target", "On track", or null for all'),
    }),
    execute: async ({ retailer, flag }) =>
      mlflow.withSpan(async () => {
        const rows = (await listPlan(ctx.db)).filter((e) =>
          (!retailer || e.retailerName.toLowerCase().includes(retailer.toLowerCase()) || e.retailerId === retailer) &&
          (!flag || e.forecastFlag.toLowerCase() === flag.toLowerCase()));
        const all = await listPlan(ctx.db);
        const tot = (xs: typeof all, k: 'tradeSpend' | 'netProfit') => Math.round(xs.reduce((a, e) => a + (e[k] ?? 0), 0));
        return {
          calendar_totals: {
            events: all.length, trade_spend_usd: tot(all, 'tradeSpend'), forecast_net_profit_usd: tot(all, 'netProfit'),
            forecast_roi_pct: pct(tot(all, 'netProfit') / Math.max(tot(all, 'tradeSpend'), 1)),
            money_losing_events: all.filter((e) => e.forecastFlag === 'Money-losing').length,
            money_losing_events_combined_net_profit_usd: tot(all.filter((e) => e.forecastFlag === 'Money-losing'), 'netProfit'),
            note: 'forecast_net_profit_usd is the WHOLE calendar; use money_losing_events_combined_net_profit_usd for the loss of the money-losing events',
          },
          events: rows.map((e) => ({
            plan_event_id: e.id, retailer: e.retailerName, product: e.productName, sku: e.sku, week_of: e.startWeek, weeks: e.weeks,
            tactic: e.tactic, depth_pct: pct(e.discountDepth), funding: e.fundingMethod, promo_price: e.promoPrice,
            forecast_units: money(e.forecastUnits), trade_spend_usd: money(e.tradeSpend), forecast_net_profit_usd: money(e.netProfit),
            forecast_roi_pct: pct(e.roi), flag: e.forecastFlag, status: e.status,
            original_draft: e.status === 'draft' ? null : { tactic: e.originalTactic, net_profit_usd: money(e.originalNetProfit), roi_pct: pct(e.originalRoi) },
            planner_note: e.plannerNote,
          })),
        };
      }, { name: 'get_promo_calendar', spanType: mlflow.SpanType.TOOL, inputs: { retailer, flag } }),
  }));
  tools.push(tool({
    name: 'get_post_event_analysis',
    description: 'The EVIDENCE for why a tactic makes or loses money: post-event analysis of completed promotions (last 104 weeks) against the ML baseline (baseline_demand_model@champion), aggregated by retailer x tactic x funding method: events, volume lift %, pantry-loading dip (% of lift, 4 weeks after), cannibalization of sister SKUs (% of lift), forward-buy units (% of event volume, off-invoice only), subsidised baseline $, trade spend, incremental gross profit, net profit, ROI %, events that lost money. Filter by retailer / tactic / SKU or pass nulls.',
    parameters: z.object({
      retailer: z.string().nullable().describe('Retailer name or id, e.g. "ValuMax", or null for all'),
      tactic: z.string().nullable().describe('"BOGO", "Feature + Display", "TPR", "Multi-buy", or null for all'),
      sku: z.string().nullable().describe('SKU or product name fragment, or null'),
    }),
    execute: async ({ retailer, tactic, sku }) =>
      mlflow.withSpan(async () => ({
        roi_definition: 'ROI = (incremental gross profit - trade spend) / trade spend (TPG-2027 §3.1); negative = the promotion lost money',
        rows: await postEventSummary(ctx.db, { retailer, tactic, sku }),
      }), { name: 'get_post_event_analysis', spanType: mlflow.SpanType.TOOL, inputs: { retailer, tactic, sku } }),
  }));
  tools.push(tool({
    name: 'get_replan_options',
    description: 'For planned events, the candidate re-plans with their forecast (ML baseline x the retailer\'s historical response): tactic, depth, funding, forecast units, net volume kept after the pantry-loading dip, trade spend, net profit, ROI, TPG-2027 policy check, and which one is RECOMMENDED (the compliant option with the highest net profit). Pass the plan_event_ids (e.g. the money-losing ones from get_promo_calendar).',
    parameters: z.object({
      plan_event_ids: z.array(z.string()).describe('Planned event ids, e.g. ["PL-001","PL-002"]'),
    }),
    execute: async ({ plan_event_ids }) =>
      mlflow.withSpan(async () => {
        const out = [];
        for (const id of plan_event_ids) {
          const ev = await getPlanEvent(ctx.db, id);
          if (!ev) { out.push({ plan_event_id: id, error: 'not found' }); continue; }
          const sc = await listScenarios(ctx.db, id);
          out.push({
            plan_event_id: id, retailer: ev.retailerName, product: ev.productName, week_of: ev.startWeek, current_tactic: ev.tactic, status: ev.status,
            options: sc.map((s) => ({
              scenario_key: s.scenarioKey, label: s.label, is_as_planned: s.isAsPlanned, recommended: s.recommended,
              funding: s.fundingMethod, promo_price: s.promoPrice, forecast_units: money(s.forecastUnits),
              net_volume_kept_units: money(s.volumeKept), trade_spend_usd: money(s.tradeSpend), net_profit_usd: money(s.netProfit),
              roi_pct: pct(s.roi), policy_compliant: s.policyCompliant, policy_notes: s.policyNotes, historical_analog_events: s.analogEvents,
            })),
          });
        }
        return out;
      }, { name: 'get_replan_options', spanType: mlflow.SpanType.TOOL, inputs: { plan_event_ids } }),
  }));
  if (backends.genieSpaceId) tools.push(askDataTool(ctx, backends.genieSpaceId));
  tools.push(tool({
    name: 'approve_replan',
    description: 'WRITE-BACK (Lakebase): apply approved re-plans to next quarter\'s promo calendar — each change swaps the planned event\'s tactic / depth / funding / forecast in one transaction and records the decision (before/after net profit, ROI, trade spend, volume, retailer notice). ONLY call after the user explicitly approves ("approve", "book it", "go ahead", "yes"). Use scenario_key from get_replan_options (null = the recommended option).',
    parameters: z.object({
      changes: z.array(z.object({
        plan_event_id: z.string().describe('Planned event id, e.g. PL-001'),
        scenario_key: z.string().nullable().describe('Scenario key from get_replan_options, or null for the recommended one'),
      })).describe('The re-plans the user approved'),
      rationale: z.string().describe('One-sentence rationale recorded with the decision (the evidence)'),
    }),
    execute: async ({ changes, rationale }) =>
      mlflow.withSpan(async () => {
        const user = getCurrentUserEmail(ctx.req);
        const results = [];
        for (const c of changes) {
          const r = await applyReplan(ctx.db, { planEventId: c.plan_event_id, scenarioKey: c.scenario_key, rationale, userEmail: user, via: 'copilot' });
          if ('error' in r) { results.push({ plan_event_id: c.plan_event_id, error: r.error }); continue; }
          const d = r.decision;
          results.push({
            decision_id: d.id, plan_event_id: d.planEventId, retailer: d.retailerName, product: d.productName, week_of: d.startWeek,
            from: d.fromLabel, to: d.toLabel, net_profit_before_usd: money(d.fromNetProfit), net_profit_after_usd: money(d.toNetProfit),
            roi_before_pct: pct(d.fromRoi), roi_after_pct: pct(d.toRoi), trade_spend_before_usd: money(d.fromTradeSpend),
            trade_spend_after_usd: money(d.toTradeSpend), volume_before_units: money(d.fromVolume), volume_after_units: money(d.toVolume),
            retailer_notice: d.retailerNotice,
          });
        }
        const ok = results.filter((r) => !('error' in r)) as unknown as Array<Record<string, number | null>>;
        const sum = (k: string) => Math.round(ok.reduce((a, r) => a + Number(r[k] ?? 0), 0));
        return {
          applied: ok.length, approved_by: user, results,
          totals: {
            net_profit_before_usd: sum('net_profit_before_usd'), net_profit_after_usd: sum('net_profit_after_usd'),
            trade_spend_before_usd: sum('trade_spend_before_usd'), trade_spend_after_usd: sum('trade_spend_after_usd'),
            volume_before_units: sum('volume_before_units'), volume_after_units: sum('volume_after_units'),
          },
          link: '/decisions',
        };
      }, { name: 'approve_replan', spanType: mlflow.SpanType.TOOL, inputs: { changes, rationale } }),
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
  // root `promo_copilot.turn` and per-tool `withSpan` wrappers.
  //
  // Use a custom fetch that forces a fresh TCP connection per call and
  // disables keep-alive. Without this, after a long-running tool call
  // (ask_data can take ~60s), the second Responses API call reuses a
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
        // An earlier call in this request already fell back to the SP → stay on it.
        if (usesSpFallback(ctx.req)) headers.set('Authorization', (await spAuthHeaders()).get('Authorization') ?? '');
        resp = await send();
        // The viewer's OBO token can be rejected by the serving gateway (e.g.
        // "403 Invalid Token" when the token lacks the `ai-gateway` scope, or
        // the session predates a scope change). Retry ONCE as the app service
        // principal and keep using it for the rest of this request. The body
        // is a string, so it is safely re-sendable.
        if ((resp.status === 401 || resp.status === 403) && ctx.req.headers['x-forwarded-access-token'] && !usesSpFallback(ctx.req)) {
          console.warn(`[openai-shim] OBO token rejected (${resp.status}) from ${url} — retrying as app service principal`);
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
  Object.assign(backends, await resolvedBackends());
  return new Agent({
    name: 'TradePromoCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Trade Promo Copilot for Crestwood Snacks Co., a salty-snacks CPG (Crestwood Kettle, Crestwood Classic,
Ridgeline Tortilla, Twistwell Pretzels, Crestwood Variety). Users: Elena Marsh (Director, Revenue Growth Management) and
the key account managers. Crestwood sells through 5 accounts: ValuMax Stores (Mass, off-invoice funding, JBP), Greenleaf
Market and Harbor Fresh Grocers (Grocery, scan-based), QuickPantry (Convenience) and BulkWise Club (Club).
Your job: evaluate next quarter's draft promo calendar, flag the events that will lose money WITH EVIDENCE, propose a
compliant re-plan, and — only after explicit approval — write the approved plan back.

TOOLS
- get_promo_calendar: the draft calendar + as-planned forecast. Start here for any question about "next quarter" / "the plan".
- get_post_event_analysis: the evidence from completed promotions (ML baseline vs actual, pantry loading, cannibalization,
  forward buying, ROI) for a retailer x tactic.
- get_replan_options: the candidate tactics per planned event with forecast net profit / ROI / volume / policy check.
- ask_data: the Genie agent. (a) Policy: the guidelines (TPG-2027), methodology (PEA-2027), the ValuMax JBP, trade terms —
  ask it to quote document + section. (b) Any other ad-hoc analytics question (trade spend, ROI by retailer / tactic /
  quarter, trends). One focused question per call.
- approve_replan: WRITE-BACK. Only when the user explicitly approves. Never call it in the same turn you propose a plan.

PLAYBOOK
1. "Which events will lose money / evaluate the calendar": call get_promo_calendar (no filters), then
   get_post_event_analysis for the retailer x tactic behind the money-losing events. Answer: how many events are
   money-losing, which ones (id, product, week, forecast net profit, ROI), their combined forecast loss
   (money_losing_events_combined_net_profit_usd — not the whole-calendar total), and WHY with the
   historical evidence: volume lift, pantry-loading dip % of lift, cannibalization % of lift, forward buying on
   off-invoice deals and the subsidised baseline. Contrast with the tactic that pays back at the same retailer.
2. "Re-plan / fix it": call get_replan_options for the money-losing events and ask_data about the retailer's JBP
   commitments (minimum events / displays, settlement options, notice period). Propose ONE plan: a markdown table with
   event, product, week, from → to, forecast net profit before → after, ROI after, net volume kept before → after; then
   totals (net profit swing, trade spend saved, volume change) and how it stays compliant (JBP event count kept, displays,
   scan-based settlement, 4-week notice). Then STOP and ask for approval.
3. "Approve / book it / go ahead": call approve_replan with the proposed changes (scenario_key from the options) and
   confirm what was written: decision ids, totals, and the retailer notices. Mention the Decisions page.

STYLE
- Lead with the answer and the key number in **bold** on line one. Be concise; use a short table for event lists.
- Numbers come from tools, never from memory. Money in $ (e.g. $52.5K), ROI and shares in % with 1 decimal at most.
- ROI = (incremental gross profit − trade spend) ÷ trade spend; a negative ROI means the event LOST money.
- Balance margin AND volume: always state what a re-plan does to volume, not just profit.
- Never claim a re-plan was applied unless approve_replan returned it.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

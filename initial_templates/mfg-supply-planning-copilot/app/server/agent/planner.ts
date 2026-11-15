/**
 * Supply Planning Copilot chat agent (the floating dock).
 *
 * Tools:
 *   ask_data              — the Genie agent (Agent mode): S&OP analytics over the governed gold tables AND the
 *                           Corvane supply-planning policy manual (cited)
 *   list_exposures        — the 13-week stock-out / below-safety-stock exposures + plan status
 *   get_exposure          — one exposure: projection, delayed inbound POs, customer orders at risk, signals
 *   evaluate_mitigations  — every priced mitigation lever for an exposure (deterministic engine)
 *   simulate_plan         — re-project the exposure with a set of actions (cost, units short, revenue protected)
 *   propose_plan          — stage the recommended plan in Lakebase; the planner books it in the workbench
 *
 * Numbers never come from the model: every figure is computed by services/planner.ts.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import type { DataConfig } from '../db/sync.js';
import { planStatusByExposure, saveProposal } from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
import { resolvedBackends } from '../services/resources.js';
import { buildOptions, exposureDetail, getExposure, loadPlanningData, simulate } from '../services/planner.js';
import { toPlan } from '../routes/planning.js';
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

/** Genie agent id + data config, set at boot from config/app.json (server.ts); ids missing from env are
 * filled from <catalog>.<schema>.demo_resources (written by the setup job) before each agent run. */
const backends: { genieSpaceId: string; data?: DataConfig } = { genieSpaceId: '' };
export function configurePlannerAgent(b: { genieSpaceId?: string; data?: DataConfig }) {
  backends.genieSpaceId = b.genieSpaceId ?? '';
  backends.data = b.data;
}

const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const actionsSchema = z.array(z.object({
  option_id: z.string().describe('option_id from evaluate_mitigations, e.g. "TRANSFER-MTY"'),
  qty: z.number().nullable().describe('units (weeks for SAFETY-STOCK+1); null = the option default'),
}));

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext) {
  const tools = [];
  const data = () => loadPlanningData(backends.data);
  const need = async (id: string) => {
    const d = await data();
    const e = getExposure(d, id);
    if (!e) throw new Error(`unknown exposure_id ${id}; valid: ${d.exposures.map((x) => x.exposure_id).join(', ')}`);
    return { d, e };
  };
  if (backends.genieSpaceId) tools.push(askDataTool(ctx, backends.genieSpaceId));
  tools.push(tool({
    name: 'list_exposures',
    description: 'List the supply exposures in the 13-week projected inventory (components going negative = STOCKOUT, or below safety stock), ranked by revenue at risk, with root cause and whether a plan is proposed/booked.',
    parameters: z.object({}),
    execute: async () => {
      const d = await data();
      const status = await planStatusByExposure(ctx.db);
      return {
        as_of: d.asOf,
        exposures: d.exposures.map((e) => ({
          exposure_id: e.exposure_id, component: `${e.component_id} ${e.component_name}`, plant: e.plant_name, type: e.exposure_type,
          first_stockout_week: e.first_stockout_week, days_to_stockout: e.days_to_stockout, peak_units_short: e.peak_units_short,
          peak_units_short_if_POs_on_time: e.peak_units_short_if_on_time, revenue_at_risk: money(e.revenue_at_risk),
          affected_skus: e.affected_skus, primary_supplier: e.primary_supplier, delayed_pos: e.delayed_po_count,
          max_delay_days: e.max_delay_days, root_cause: e.root_cause, plan: status[e.exposure_id]?.status ?? 'none',
        })),
      };
    },
  }));
  tools.push(tool({
    name: 'get_exposure',
    description: 'Full picture of one exposure: week-by-week projection (requirement from the AI_FORECAST x BOM, receipts at revised ETA, projected balance, balance if POs had been on time, safety stock), the inbound purchase orders with their delays, the customer orders that fall in the stock-out weeks, the supplier/forwarder signals read by ai_extract, the primary supplier on-time delivery for the last 6 months, and the same component at other plants.',
    parameters: z.object({ exposure_id: z.string().describe('e.g. "EXP-HX-220-DAY"') }),
    execute: async ({ exposure_id }) => {
      const { d, e } = await need(exposure_id);
      const x = exposureDetail(d, e);
      return {
        exposure: { ...e, revenue_at_risk: money(e.revenue_at_risk) },
        projection: x.projection.map((r) => ({ week: r.week_start, required: r.required_units, receipts: r.receipts, receipt_pos: r.receipt_pos, balance: r.projected_balance, balance_if_on_time: r.balance_if_on_time, safety_stock: r.safety_stock_units })),
        inbound_pos: x.inbound_pos.map((p) => ({ po: p.po_number, supplier: p.supplier_name, qty: p.quantity, status: p.status, promised: p.promised_date, revised_eta: p.revised_eta, delay_days: p.delay_days, reason: p.delay_reason, vessel: p.vessel })),
        customer_orders_at_risk: { count: x.orders_at_risk.length, value: money(x.orders_at_risk_value), tier_A: x.orders_at_risk.filter((o) => o.customer_tier === 'A').slice(0, 8).map((o) => `${o.order_id} ${o.customer_name} ${o.quantity}x ${o.sku} ship ${o.requested_ship_date}`) },
        supply_signals: x.signals.slice(0, 5).map((sg) => ({ from: sg.sender_org, type: sg.event_type, summary: sg.summary, pos: sg.po_numbers, added_delay_days: sg.added_delay_days })),
        primary_supplier_on_time_delivery_by_month: x.supplier_otd.map((o) => ({ month: o.month.slice(0, 7), received_pos: o.pos_received, on_time_pct: o.on_time_pct, avg_days_late: o.avg_days_late })),
        same_component_other_plants: x.other_plants.map((h) => ({ plant: h.plant_name, on_hand: h.on_hand_units, weekly_requirement: h.avg_weekly_requirement, eo_category: h.eo_category, eo_value: money(h.eo_value), days_since_last_issue: h.days_since_last_issue })),
      };
    },
  }));
  tools.push(tool({
    name: 'evaluate_mitigations',
    description: 'All mitigation levers for an exposure, in policy order of preference (1 transfer between plants, 2 qualified alternate supplier, 3 air expedite, 4 safety-stock change), each with its default quantity, arrival date, cost and the result if used ALONE (units short after, revenue protected, weeks below safety stock, approver).',
    parameters: z.object({ exposure_id: z.string() }),
    execute: async ({ exposure_id }) => {
      const { d, e } = await need(exposure_id);
      const base = simulate(d, e, []);
      return {
        baseline: { units_short: base.units_short, revenue_at_risk: money(base.revenue_at_risk), weeks_below_safety_stock: base.weeks_below_safety_stock },
        options: buildOptions(d, e).map((o) => ({
          option_id: o.option_id, policy_rank: o.policy_rank, title: o.title, detail: o.detail, arrival_date: o.arrival_date,
          default_qty: o.default_qty, max_qty: o.max_qty, min_qty: o.min_qty, unit: o.unit_label, cost_formula: o.cost_formula, eo_note: o.eo_note,
          if_used_alone: { cost: money(o.alone.plan_cost), annual_carrying_cost: money(o.alone.annual_carrying_cost), units_short_after: o.alone.units_short, first_stockout_week_after: o.alone.first_stockout_week, revenue_protected: money(o.alone.revenue_protected), weeks_below_safety_stock: o.alone.weeks_below_safety_stock, eo_released: money(o.alone.eo_released), approver: o.alone.approver },
        })),
      };
    },
  }));
  tools.push(tool({
    name: 'simulate_plan',
    description: 'Re-project the exposure with a combination of actions. Returns cost, units short after, revenue protected, weeks below safety stock, E&O released and the approver required by policy.',
    parameters: z.object({ exposure_id: z.string(), actions: actionsSchema }),
    execute: async ({ exposure_id, actions }) => {
      const { d, e } = await need(exposure_id);
      const r = simulate(d, e, actions);
      return {
        actions: r.actions.map((a) => ({ ...a, cost: money(a.cost) })), plan_cost: money(r.plan_cost), annual_carrying_cost: money(r.annual_carrying_cost),
        units_short_after: r.units_short, first_stockout_week_after: r.first_stockout_week, revenue_at_risk_after: money(r.revenue_at_risk),
        revenue_protected: money(r.revenue_protected), weeks_below_safety_stock: r.weeks_below_safety_stock, min_balance: r.min_balance,
        eo_released: money(r.eo_released), approver: r.approver,
      };
    },
  }));
  tools.push(tool({
    name: 'propose_plan',
    description: 'Stage the recommended mitigation plan for an exposure in the planning system (Lakebase). It appears in the exposure workbench pre-selected; the planner reviews and clicks "Book plan". Call once, after simulate_plan confirms the plan.',
    parameters: z.object({ exposure_id: z.string(), actions: actionsSchema, rationale: z.string().describe('2-3 sentences: why this combination, why the others were rejected, the policy citation') }),
    execute: async ({ exposure_id, actions, rationale }) => {
      const { d, e } = await need(exposure_id);
      const sim = simulate(d, e, actions);
      const { actions: acts, totals } = toPlan(sim, simulate(d, e, []));
      const row = await saveProposal(ctx.db, { exposureId: e.exposure_id, actions: acts, totals, rationale, by: "copilot" });
      return { staged: true, plan_id: row.id, exposure_id: e.exposure_id, plan_cost: money(totals.planCost), revenue_protected: money(totals.revenueProtected), units_short_after: totals.unitsShortAfter, approver: totals.approver, next: 'The planner books it from the exposure workbench.' };
    },
  }));
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  // Build a fresh auth header each configure; OpenAI SDK holds the key at
  // client construction time, so we reconfigure per request to pick up a
  // fresh bearer. (setDefaultOpenAIClient is idempotent.)
  const b = await resolvedBackends();
  backends.genieSpaceId ||= b.genieSpaceId;
  const headers = await authHeaders(ctx.req);
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  // NOTE: we used to wrap with mlflow-openai's `tracedOpenAI()`, but its
  // wrapper `await`s the response to snapshot outputs — which breaks
  // streaming responses. Skip it; we still get agent-level spans via the
  // root `supply_planning_copilot.turn` and per-tool `withSpan` wrappers.
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
    name: 'SupplyPlanningCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Supply Planning Copilot for Corvane Motion Systems, an industrial motion-components maker
(servo gearmotors, planetary gearboxes, linear actuators, motion controllers) with three plants:
Dayton OH (DAY), Monterrey MX (MTY) and Wroclaw PL (WRO). Users: Elena Ruiz, Dayton supply planner, and
Tom Becker, VP Supply Chain, in the weekly S&OP supply-exception review. The plan is 13 weekly buckets
(Monday week starts); demand = AI_FORECAST on 104 weeks of orders, exploded through the bill of materials.

TOOLS
- ask_data: the Genie agent. (a) History and KPIs — fill rate, demand trends, supplier on-time delivery, E&O by plant,
  open POs, booked plans (sop_plan_decisions) — SQL over the governed gold tables. (b) Policy questions (approval
  thresholds, safety-stock triggers, transfer / E&O rules, alternate-source limits, customer allocation) from the policy
  manual — quote the section it cites (e.g. CSP-03 §3.2).
- list_exposures / get_exposure: the forward-looking projection — what runs out, when, why, who is hurt.
- evaluate_mitigations / simulate_plan / propose_plan: build and stage a mitigation plan.

HOW TO BUILD A PLAN (when asked to propose / fix / mitigate an exposure)
1. get_exposure, then evaluate_mitigations.
2. Follow policy order of preference: inter-plant transfer (E&O stock first) → qualified alternate supplier →
   air expedite → (customer allocation is last resort). Pick the CHEAPEST combination that leaves 0 units short
   and keeps the balance at or above safety stock; simulate_plan to confirm (adjust qty if needed).
3. propose_plan with a short rationale. Never claim a plan is booked — the planner books it in the workbench.
4. Answer: line 1 = the plan and its cost vs revenue protected in **bold**; then 3-5 bullets: why it works
   (arrival vs first stock-out week), E&O released, approver, what you rejected and why (cost / arrives too late),
   and one policy note if relevant (e.g. the safety-stock trigger for a disrupted lane). Mention customers at risk.

RULES
- Numbers, dates and costs come from tools only — never compute or invent them yourself.
- Lead with the answer and the number in **bold** on line one. Be concise (≤ 10 lines unless asked).
- Use plant names (Dayton, Monterrey, Wroclaw) and part numbers (HX-220 gear housing, EN-17 encoder).
- For history questions use Genie; for "what will happen" use the projection tools.
- Supplier on-time delivery = RECEIVED POs by month of receipt. For the exposure's primary supplier use
  get_exposure.primary_supplier_on_time_delivery_by_month (already in %); never infer OTD from open / in-transit POs.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

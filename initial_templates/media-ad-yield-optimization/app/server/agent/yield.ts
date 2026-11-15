/**
 * Ad Yield Copilot chat agent (the floating dock).
 *
 * Tools:
 *   ask_data                  — the Genie agent (Agent mode): SVP-Ad-Revenue analytics over the governed gold tables AND the
 *                               rate card, floor governance, make-good policy, IO-2026-0417 terms, ad-ops SOP documents (cited)
 *   list_campaigns_at_risk    — live IOs projected to miss their guarantee (Lakebase mirror of gold_campaign_pacing)
 *   list_yield_opportunities  — programmatic products priced below their rate-card floor group (Lakebase)
 *   build_recovery_plan       — pacing diagnosis + ai_forecast + spare avails + allocation + floor fix for ONE campaign
 *                               (live SQL on the lakehouse — services/plan.ts buildEvidence)
 *   approve_recovery_plan     — WRITE-BACK: approve the plan and send it to ad ops (only when asked)
 *   apply_floor_change        — WRITE-BACK: queue a floor-group restore for ad ops (only when asked)
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { applyFloorChange, approvePlan, listCampaigns, listOpportunities, resolveCampaign } from '../db/queries/index.js';
import type { DataConfig } from '../db/sync.js';
import { buildEvidence } from '../services/plan.js';
import { askDataTool } from './tools/genie.js';
import { getCurrentUserEmail } from '../lib/user.js';
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

/** Genie agent id + Delta location — set at boot (server.ts), after app_config is resolved. */
const backends: { genieSpaceId: string; data?: DataConfig } = { genieSpaceId: '' };
export function configureYieldAgent(b: { genieSpaceId?: string; data?: DataConfig }) {
  backends.genieSpaceId = b.genieSpaceId ?? '';
  backends.data = b.data;
}

const money = (n: number | null | undefined) => (n == null ? null : Math.round(n));

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext) {
  const tools = [];
  if (backends.genieSpaceId) tools.push(askDataTool(ctx, backends.genieSpaceId));
  tools.push(tool({
    name: 'list_campaigns_at_risk',
    description: 'Live insertion orders projected to deliver < 95% of their audience guarantee (the make-good threshold), ranked by make-good liability: advertiser, IO, audience, pacing, projected delivery %, projected shortfall (impressions), liability ($), the product driving the shortfall, days left, and whether a recovery plan is drafted / approved.',
    parameters: z.object({}),
    execute: async () => {
      const rows = await listCampaigns(ctx.db, { atRiskOnly: true });
      return rows.map((r) => ({
        campaign_id: r.id, io: r.ioNumber, campaign: r.name, advertiser: r.advertiserName, agency: r.agency, audience: r.targetSegment,
        pacing_pct: r.pacing == null ? null : Math.round(r.pacing * 1000) / 10, projected_delivery_pct: r.projectedDeliveryPct == null ? null : Math.round(r.projectedDeliveryPct * 1000) / 10,
        projected_shortfall_impressions: money(r.projectedShortfall), make_good_liability: money(r.makeGoodLiability),
        problem_inventory: r.riskProductName, days_remaining: r.daysRemaining, status: r.status, plan_id: r.planId,
      }));
    },
  }));
  tools.push(tool({
    name: 'list_yield_opportunities',
    description: 'The programmatic yield board (last 28 days): every streaming / FAST product with sell-through, programmatic eCPM vs rate card vs open-auction clearing, the floor group the ad server applies vs the one the rate card assigns, the rule that set it, revenue left on the table (28 days and since the rule change) and the recommended floor. Mis-priced products first.',
    parameters: z.object({}),
    execute: async () => {
      const rows = await listOpportunities(ctx.db);
      return rows.map((o) => ({
        product_id: o.productId, product: o.productName, tier: o.tier, rate_card_cpm: o.rateCardCpm, programmatic_ecpm_28d: o.programmaticEcpm28d,
        pmp_ecpm_28d: o.pmpEcpm28d, open_auction_clearing_cpm_28d: o.openClearing28d, sell_through_28d_pct: o.sellThrough28d == null ? null : Math.round(o.sellThrough28d * 1000) / 10,
        floor_group_in_force: o.currentGroup, floor_in_force: o.currentFloor, rate_card_floor_group: o.rateCardGroup, mis_priced: o.groupMismatch,
        rule: o.currentRuleId, rule_since: o.currentRuleSince, rule_changed_by: o.currentRuleChangedBy, programmatic_ecpm_before_rule: o.programmaticEcpmBeforeRule,
        revenue_left_on_table_28d: money(o.revenueGap28d), revenue_left_on_table_since_rule: money(o.revenueGapSinceRule),
        recommended_group: o.recommendedGroup, recommended_floor: o.recommendedFloor, floor_change_id: o.floorChangeId,
      })).sort((a, b) => Number(b.mis_priced) - Number(a.mis_priced) || (b.revenue_left_on_table_28d ?? 0) - (a.revenue_left_on_table_28d ?? 0)).slice(0, 8);
    },
  }));
  tools.push(tool({
    name: 'build_recovery_plan',
    description: 'Build the recovery plan for ONE under-delivering campaign with live SQL on the lakehouse: which line is short and why (its inventory avails week by week), the ai_forecast avails to flight end, spare avails of equal-or-better inventory that reaches the booked audience, how that inventory is priced today (floor-group problems), and a priced reallocation: impressions moved per product with daily caps, make-good liability avoided, programmatic revenue displaced, floor-fix uplift, net impact. Takes ~20 s. Does NOT write anything.',
    parameters: z.object({ campaign: z.string().describe('Campaign id (CMP-xxxxx), IO number or advertiser, e.g. "Summit"') }),
    execute: async ({ campaign }) =>
      mlflow.withSpan(async () => {
        if (!backends.data) return { error: 'data config missing' };
        const c = await resolveCampaign(ctx.db, campaign);
        if (!c) return { error: `no campaign matches "${campaign}"` };
        const ev = await buildEvidence(c, backends.data);
        return {
          campaign_id: c.id, io: c.ioNumber, campaign: c.name, advertiser: c.advertiserName, audience: c.targetSegment, flight_end: c.flightEnd,
          pacing: ev.pacing, findings: ev.findings.map((f) => ({ finding: f.title, verdict: f.verdict, detail: f.detail })),
          eligible_spare_inventory: ev.spare.filter((s) => s.eligible).map((s) => ({ product: s.product_name, tier: s.tier, in_target_spare_impressions: s.in_target_spare, audience_share: s.audience_share, displaced_programmatic_ecpm: s.displaced_ecpm })),
          reallocations: ev.reallocations, floor_changes: ev.floor_changes.map((f) => ({ product: f.product_name, from: `${f.from_group} $${f.from_floor}`, to: `${f.to_group} $${f.to_floor}`, release_from_deal: f.release_from_deal, uplift_to_flight_end: f.expected_uplift_window })),
          impact: ev.impact, plan_already_approved: c.planId,
        };
      }, { name: 'build_recovery_plan', spanType: mlflow.SpanType.TOOL, inputs: { campaign } }),
  }));
  tools.push(tool({
    name: 'approve_recovery_plan',
    description: 'WRITE-BACK: approve the latest recovery plan of a campaign and send it to ad ops in Lakebase (reallocations, floor changes, agency notice). Only call when the user explicitly asks to approve / send / push the plan. The plan must have been built in the campaign workbench ("Build recovery plan"); if not, say so.',
    parameters: z.object({
      campaign: z.string().describe('Campaign id, IO number or advertiser'),
      notes: z.string().nullable().describe('Optional note from the user'),
    }),
    execute: async ({ campaign, notes }) => {
      const c = await resolveCampaign(ctx.db, campaign);
      if (!c) return { error: `no campaign matches "${campaign}"` };
      if (!c.analysis) return { error: `Campaign ${c.id} has no recovery plan yet — open it in the workbench and click "Build recovery plan" first.` };
      const r = await approvePlan(ctx.db, { campaignId: c.id, notes, userEmail: getCurrentUserEmail(ctx.req), via: 'copilot' });
      if ('error' in r) return r;
      const p = r.plan;
      return { plan_id: p.id, already_existed: r.existing, title: p.title, advertiser: p.advertiserName, reallocations: p.reallocations.map((x) => `${x.impressions.toLocaleString()} → ${x.product_name}`), floor_changes: p.floorChanges.map((f) => `${f.product_name}: ${f.from_group} → ${f.to_group} ($${f.to_floor})`), liability_avoided: money(p.liabilityAvoided), net_impact: money(p.netImpact), status: p.status, link: `/campaigns/${c.id}` };
    },
  }));
  tools.push(tool({
    name: 'apply_floor_change',
    description: 'WRITE-BACK: queue a floor-group restore for ONE mis-priced programmatic product (back to its rate-card floor group, released from the run-of-network PMP) for ad ops, in Lakebase. Only when the user explicitly asks to fix / restore / change the floor.',
    parameters: z.object({ product_id: z.string().describe('Product id, e.g. STR-SPORTS-LIVE') }),
    execute: async ({ product_id }) => {
      const r = await applyFloorChange(ctx.db, { productId: product_id, userEmail: getCurrentUserEmail(ctx.req), via: 'copilot' });
      if ('error' in r) return r;
      const f = r.change;
      return { floor_change_id: f.id, already_existed: r.existing, product: f.productName, from: `${f.fromGroup} $${f.fromFloor}`, to: `${f.toGroup} $${f.toFloor}`, release_from_deal: f.releaseFromDeal, expected_uplift_30d: money(f.expectedUplift30d), status: f.status };
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
  // root `ad_yield_copilot.turn` and per-tool `withSpan` wrappers.
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
    name: 'AdYieldCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Ad Yield Copilot for Aurora Crest Media: the ACN broadcast network (Linear), the Crest+ ad-supported streaming
service and FAST channels. Users: Maya Chen (Director of Yield & Pricing) and Jordan Ellis (SVP Ad Revenue). Inventory is
sold as guaranteed audience deals (upfront / scatter IOs with in-target impression guarantees; < 95% delivery at flight end
= make-good owed at the booked CPM), then programmatic PMP deals, then the open auction.

TOOLS
- list_yield_opportunities: programmatic pricing — eCPM vs rate card, floor groups, revenue left on the table.
- list_campaigns_at_risk: which IOs will miss their guarantee and the make-good liability.
- build_recovery_plan: to explain WHY an IO under-delivers and HOW to fix it (spare avails, reallocation, floor fix, money).
- ask_data: the Genie agent. (a) Any other question about revenue, sell-through, eCPM, avails, forecasts, make-good history,
  trends — SQL over the governed gold tables. (b) What the rate card / floor policy / make-good policy / an IO says, from the
  documents — always quote the document + section.
- approve_recovery_plan / apply_floor_change: ONLY when the user explicitly asks. Confirm what was written (id, amounts).

RULES
- "Where are we leaking yield / leaving money on the table / what should I look at?" → call list_yield_opportunities AND
  list_campaigns_at_risk. Answer with (1) the mis-priced product: programmatic eCPM vs rate card vs open-auction clearing, the
  rule that caused it, revenue left on the table in the last 28 days and since the rule; (2) the top at-risk IO: shortfall,
  liability, problem inventory. Do NOT claim the two are unrelated: close by offering to build the recovery plan for the top
  IO, which checks whether spare premium inventory (incl. the mis-priced one) can absorb the make-good.
- "Build the recovery plan / why is X under-delivering / how do we fix X" → call build_recovery_plan, then answer: the cause
  (problem line + avails drop), the reallocation (impressions per product), coverage %, liability avoided, displaced
  programmatic revenue, the floor fix and its uplift, net impact. Mention it is not approved until the user approves it.
- Lead with the answer and the key number in **bold** on line one. Be concise (≤ 10 lines unless asked); short bullets.
- Numbers come from tools, never from memory. Name the sources once, in a short last line (e.g. "Sources: yield board, pacing").
- Impressions: write 8.7M, not 8,671,306. Money: $334K or $334,327. CPMs with 2 decimals.
- Never claim a plan or floor change is approved/sent unless a write-back tool returned it.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

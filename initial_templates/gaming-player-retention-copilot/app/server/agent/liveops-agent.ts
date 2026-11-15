/**
 * LiveOps copilot — Emberline Studios' Hollowspire live-ops console agent.
 *
 * Built on `@openai/agents` pointed at the Databricks Responses API (see
 * configureAgentsSdk — structural, unchanged from the template). Tools:
 *   - ask_data               → the live-ops Genie space (retention, ARPDAU, funnel, queues, chat, history)
 *   - at_risk_summary         → at-risk LTV + players by churn driver and region (Lakebase mirror of the ML scores)
 *   - list_segments           → the segment board (driver x region), sorted by at-risk LTV
 *   - get_segment             → one segment: evidence, SHAP driver shares, top at-risk players, AI-labelled chat
 *   - evaluate_interventions  → the deterministic PLAN ENGINE (db/queries/liveops.ts): cost, lift, LTV retained,
 *                               ROI, budget check for every intervention
 *   - stage_plan              → WRITE: stages the chosen intervention + the player-facing message on the segment
 *                               (plan engine re-checked server-side). The live-ops lead schedules it in the UI.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setTracingDisabled,
} from '@openai/agents';
import type { Tool } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders, spAuthHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import {
  budgetStatus,
  evaluateSegment,
  getSegment,
  listSegments,
  stagePlan,
} from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
export type { ToolProgressEvent } from './tools/types.js';

/** Captured detail of the last failing call to the model serving endpoint
 * (the OpenAI SDK strips the response body before throwing). */
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

// Tool schemas: the Agents SDK sends zod schemas with `strict: true` — use
// `.nullable()` (never `.optional()`), describe every field, snake_case names.
function makeTools(ctx: AgentContext) {
  const span = <T,>(name: string, inputs: Record<string, unknown>, fn: () => Promise<T>) =>
    mlflow.withSpan(fn, { name, spanType: mlflow.SpanType.TOOL, inputs });
  const r0 = (n: number) => Math.round(n);

  const atRiskSummary = tool({
    name: 'at_risk_summary',
    description:
      'Size the revenue at risk. Returns, from the ML scores (player_churn_model + player_ltv_model), the at-risk LTV (sum of 14-day churn probability x predicted 12-month LTV) and players at risk by churn driver and by region, plus the remaining live-ops budget. Use it for "how much revenue is at risk / which segment matters most".',
    parameters: z.object({}),
    execute: async () =>
      span('at_risk_summary', {}, async () => {
        const segs = await listSegments(ctx.db, { limit: 500 });
        const by = (key: 'churnDriver' | 'region') => {
          const m = new Map<string, { players_at_risk: number; at_risk_ltv: number; whales_at_risk: number }>();
          for (const s of segs) {
            const k = s[key];
            const cur = m.get(k) ?? { players_at_risk: 0, at_risk_ltv: 0, whales_at_risk: 0 };
            cur.players_at_risk += s.playersAtRisk;
            cur.at_risk_ltv += s.atRiskLtv;
            cur.whales_at_risk += s.whalesAtRisk;
            m.set(k, cur);
          }
          return [...m.entries()]
            .map(([k, v]) => ({ [key === 'churnDriver' ? 'churn_driver' : 'region']: k, ...v, at_risk_ltv: r0(v.at_risk_ltv) }))
            .sort((a, b) => b.at_risk_ltv - a.at_risk_ltv);
        };
        const total = segs.reduce((a, s) => a + s.atRiskLtv, 0);
        return {
          total_at_risk_ltv: r0(total),
          total_players_at_risk: segs.reduce((a, s) => a + s.playersAtRisk, 0),
          by_driver: by('churnDriver'),
          by_region: by('region'),
          top_segments: segs.slice(0, 5).map((s) => ({ segment_id: s.segmentId, name: s.segmentName, at_risk_ltv: r0(s.atRiskLtv), players_at_risk: s.playersAtRisk, whales_at_risk: s.whalesAtRisk })),
          budget: await budgetStatus(ctx.db),
        };
      }),
  });

  const listSegmentsTool = tool({
    name: 'list_segments',
    description:
      'The segment board: at-risk player segments (top churn driver x region), sorted by at-risk LTV. Returns segment_id, name, churn_driver, region, players_at_risk, critical_players, avg_churn_probability, at_risk_ltv, payers/whales at risk, status (open / plan_ready / scheduled / rejected).',
    parameters: z.object({
      driver: z.string().nullable().describe('difficulty | matchmaking | toxicity | engagement, or null for all'),
      region: z.string().nullable().describe('NA | EU | LATAM | APAC | OCE, or null for all'),
      limit: z.number().int().min(1).max(30).describe('Max rows (use 10 unless asked)'),
    }),
    execute: async (a) =>
      span('list_segments', a, async () => {
        const rows = await listSegments(ctx.db, { driver: a.driver, region: a.region, limit: a.limit });
        return rows.map((s) => ({
          segment_id: s.segmentId, name: s.segmentName, churn_driver: s.churnDriver, region: s.region,
          players_at_risk: s.playersAtRisk, critical_players: s.criticalPlayers,
          avg_churn_probability: s.avgChurnProbability, at_risk_ltv: r0(s.atRiskLtv),
          payers_at_risk: s.payersAtRisk, whales_at_risk: s.whalesAtRisk, new_players_at_risk: s.newPlayersAtRisk, status: s.status,
        }));
      }),
  });

  const getSegmentTool = tool({
    name: 'get_segment',
    description:
      'Full detail for ONE segment: size, at-risk LTV, average SHAP driver shares (% of churn risk explained by difficulty / matchmaking / toxicity / engagement / spend / profile), driver-specific evidence (e.g. stage 7-4 clear rate, ranked queue wait before vs since Season 7, D7 retention of harassed new players), the top at-risk players with their model reasons, and AI Functions-labelled chat samples. Always call this before proposing an intervention.',
    parameters: z.object({ segment_id: z.string().describe('Segment id, e.g. MATCH-APAC, DIFF-NA, TOX-EU, ENG-LATAM') }),
    execute: async ({ segment_id }) =>
      span('get_segment', { segment_id }, async () => {
        const s = await getSegment(ctx.db, segment_id);
        if (!s) return { error: `No segment ${segment_id}` };
        const { auditTrail: _a, ...rest } = s;
        void _a;
        return { ...rest, atRiskLtv: r0(s.atRiskLtv), ltvBook: r0(s.ltvBook), topPlayers: s.topPlayers.slice(0, 4) };
      }),
  });

  const evaluateTool = tool({
    name: 'evaluate_interventions',
    description:
      'Run the PLAN ENGINE for one segment over the whole intervention catalog. For each intervention returns scope and covered_segments (a global patch covers every segment with the same driver), players_targeted, cost (fixed + per player), expected_lift_pp (holdout-measured in liveops_history), expected_players_retained, expected_ltv_retained, roi, lead_time_days, budget_remaining, within_budget, matches_driver, reason. allowed = matches the driver AND within the remaining budget AND (ROI >= 1 OR kind = safety — player-safety spend is exempt from the ROI floor). Sorted best first. You may ONLY stage an allowed intervention.',
    parameters: z.object({ segment_id: z.string().describe('Segment id') }),
    execute: async ({ segment_id }) =>
      span('evaluate_interventions', { segment_id }, async () => {
        const ev = await evaluateSegment(ctx.db, segment_id);
        if (!ev) return { error: `No segment ${segment_id}` };
        return {
          segment_id, churn_driver: ev.segment.churnDriver, at_risk_ltv: r0(ev.segment.atRiskLtv), budget: ev.budget,
          interventions: ev.interventions.map(({ description: _d, ...e }) => e),
        };
      }),
  });

  const stagePlanTool = tool({
    name: 'stage_plan',
    description:
      'WRITE. Stage the chosen intervention on the segment (status -> plan_ready) with the player-facing message, so the live-ops lead can review it and click Schedule. The plan engine is re-checked server-side; a disallowed plan is rejected with an error starting "PLAN ENGINE". A start date earlier than the lead time allows is moved to the earliest possible date. Returns the staged plan.',
    parameters: z.object({
      segment_id: z.string().describe('Segment id'),
      intervention_code: z.string().describe('An intervention_code that evaluate_interventions returned with allowed=true'),
      start_date: z.string().describe('Start date YYYY-MM-DD (today is 2026-09-28; respect lead_time_days)'),
      player_message: z.string().describe('The in-game inbox message / patch note players will see: 50-100 words, warm, specific to THEIR problem, states what changes and when. No placeholders.'),
      rationale: z.string().describe('One sentence for the live-ops lead: why this intervention for this segment (driver evidence + lift + ROI + budget).'),
    }),
    execute: async (a) =>
      span('stage_plan', { segment_id: a.segment_id, intervention_code: a.intervention_code }, async () =>
        stagePlan(ctx.db, {
          segmentId: a.segment_id, interventionCode: a.intervention_code, startDate: a.start_date,
          playerMessage: a.player_message, rationale: a.rationale, userEmail: ctx.userEmail,
        }),
      ),
  });

  const tools: Tool[] = [atRiskSummary, listSegmentsTool, getSegmentTool, evaluateTool, stagePlanTool];
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
  // root `liveops.turn` and per-tool `withSpan` wrappers.
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
      // OBO → SP fallback: if the model rejects the user's forwarded token
      // (401/403), retry ONCE as the app service principal. The body is a
      // string, so it can be resent as-is.
      if ((resp.status === 401 || resp.status === 403) && ctx.req.headers['x-forwarded-access-token']) {
        try {
          const sp = await spAuthHeaders();
          const spAuth = sp.get('Authorization');
          if (spAuth) {
            console.warn(`[openai-shim] ${resp.status} with user token from ${url} — retrying once as app service principal`);
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
    name: 'LiveOpsCopilot',
    model: ctx.model,
    modelSettings: {
      reasoning: { effort: 'low', summary: 'auto' },
      store: false,
    },
    instructions: `
You are the live-ops copilot for Hollowspire, a free-to-play co-op action RPG by Emberline Studios
(PC, PlayStation, Xbox). Your users are the head of live ops and the live-ops team.
Be concise, lead with the number, and never invent data — every figure comes from a tool.
Today is 2026-09-28. Data is as of 2026-09-27.

CONTEXT YOU CAN RELY ON
- Season 7 "The Drowned Crown" launched 2026-08-18. New-player D7 retention fell and 14-day churn of
  active players roughly doubled. Three independent problems:
  difficulty (stage 7-4 "The Drowned Warden" boss clears on ~14% of attempts; stuck veterans churn),
  matchmaking (Season 7 split the ranked queue; APAC and OCE waits went from ~1-1.5 min to 5-8 min;
  competitive players there are the biggest spenders),
  toxicity (the new cross-play Raid Finder; new players who receive harassment churn — AI Functions
  separate real harassment from harmless trash talk that the keyword filter also flags).
- Live ops' reflex is the blanket 50% gem sale (GEM-SALE-50). Seasons 3-6 holdout tests show it barely
  moves retention; driver-matched interventions retain far more players per dollar.

TOOLS
- ask_data(question): open analytical questions over the lakehouse (retention cohorts, ARPDAU, stage
  funnel, queue waits, chat toxicity, past interventions). ONE focused question per call.
- at_risk_summary(): at-risk LTV and players by driver and region + remaining budget.
- list_segments / get_segment: the segment board and one segment's evidence.
- evaluate_interventions(segment_id): the plan engine. Deterministic — trust it.
- stage_plan(...): WRITE — stage the intervention + player message on the segment.

WHEN ASKED WHY RETENTION DROPPED / WHAT IS AT RISK
Use ask_data for the trend (new-player D7 retention of Season 6 vs Season 7 installs) and at_risk_summary for
the money. Name the three drivers with their evidence. Engagement decay is the normal baseline churn of fading
players, spread over every region with no single fix — so when asked which segment matters most, give the
largest segment overall AND the largest FIXABLE segment (difficulty / matchmaking / toxicity), and say that the
difficulty patch is global (it covers every DIFF-* segment at once).

INTERVENTION FLOW (when asked to plan / fix / propose for a segment)
1. get_segment → the driver in plain words, the 2-3 strongest pieces of evidence, the at-risk LTV.
2. evaluate_interventions → pick the allowed intervention with the best (expected_ltv_retained − cost) that
   FIXES the driver (for toxicity prefer the safety fix even if its ROI is below 1 — say it is exempt).
   Say explicitly why GEM-SALE-50 was not chosen (its ROI and cost vs the budget left) — quote the numbers. If the pick is a global patch, say which other segments it also covers.
3. Write the player-facing message yourself and call stage_plan immediately with the earliest start date the
   lead time allows — staging is safe: nothing ships until the live-ops lead clicks Schedule.
4. Reply with a compact summary: Intervention · cost vs budget left · expected lift and players retained ·
   LTV retained and ROI · start date · then "Staged on the segment — click Schedule to put it on the live-ops calendar."
If stage_plan returns a PLAN ENGINE error, pick the next allowed intervention and retry once.

You never schedule yourself — that is the human's decision in the UI.
Format with short markdown: bold the intervention name, use a small table only for comparisons.
Money: whole dollars with thousands separators ($48,210). Durations of queue waits in minutes and seconds.
`,
    tools: makeTools(ctx),
  });
}

export { run };

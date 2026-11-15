/**
 * RetentionOps — the Veridian Mobile retention desk's next-best-offer agent.
 *
 * Built on `@openai/agents` pointed at the Databricks Responses API (see
 * configureAgentsSdk — structural, unchanged from the template). Tools:
 *   - ask_data             → the churn Genie agent (open "why" questions over the lakehouse)
 *   - list_top_cases       → the desk's worklist from the Lakebase mirror
 *   - get_customer_case    → one account: churn probability, SHAP drivers, signals, last call (AI Functions)
 *   - evaluate_offers      → the deterministic MARGIN-GUARDRAIL engine (db/queries/retention.ts)
 *   - stage_offer          → WRITE: stages the chosen offer + drafted outreach on the case (guardrail re-checked
 *                            server-side). The human records accept/decline in the UI — the agent never closes a case.
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
  evaluateOffers,
  getCase,
  listCases,
  listOffers,
  stageOffer,
} from '../db/queries/index.js';
// Data-backend tool: the Genie agent (Agent mode) over the churn tables.
import { askDataTool } from './tools/genie.js';
export type { ToolProgressEvent } from './tools/types.js';

/** Captured detail of the last failing call to the model serving endpoint.
 * The OpenAI SDK strips the response body before throwing, so we stash it
 * here from the fetch shim and let the outer catch block read it to build a
 * useful error message for the user. */
export type ModelErrorDetail = {
  status: number;
  url: string;
  bodyText: string;
  /** Parsed `error_code` if the body was Databricks-style JSON. */
  code?: string;
  /** Parsed `message` if the body was Databricks-style JSON. */
  message?: string;
};

export type AgentContext = {
  db: AppDb;
  userEmail: string;
  req: Request;
  /** Genie agent space id the `ask_data` tool queries (see tools/genie.ts). */
  genieSpaceId: string;
  databricksHost: string;
  model: string;
  /** Called by long-running tools to surface progress to the UI. */
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  /** Mutated by the OpenAI fetch shim on any non-2xx so the outer catch
   * block can surface Databricks' actual error_code/message instead of the
   * SDK's stripped "400 status code (no body)". */
  modelError?: { current: ModelErrorDetail | null };
};


// ────────────────────────────────────────────────────────────────────────────
// Adding / editing tools — read this before touching `parameters: z.object(...)`.
//
// The Agents SDK ships every tool's zod schema to the Responses API with
// `strict: true`. Strict mode requires every property to appear in `required`.
// If you write `.optional()` on a field, zod-to-json-schema drops it from
// `required`, OpenAI rejects the schema with a 400, and Databricks' proxy
// masks the 400 as a bare 502 INTERNAL_ERROR — you get no clue what's wrong.
//
//   ❌  reason: z.string().optional()                 // breaks with strict:true
//   ✅  reason: z.string().nullable()                 // field required, value may be null
//   ✅  reason: z.string().nullable().describe('…')
//
// Other gotchas for new tools:
//   • Every `z.object({...})` field needs a `.describe('…')` — the model uses
//     it to decide when/how to call the tool. Missing descriptions = bad calls.
//   • Keep property names snake_case. OpenAI's tool calls sometimes normalize
//     casing and mixing conventions causes subtle argument-parsing bugs.
//   • Don't use `z.union([...])` at the top level of parameters — Responses
//     API strict mode requires a single object schema.
//   • `tool` here is the `loggedTool` wrapper from ./tools/logged-tool.ts: it
//     logs thrown errors via console.error (caught by lib/logger.ts) BEFORE
//     returning the SDK's recovery hint to the model. Don't import the raw
//     `tool` from '@openai/agents' directly — you'll silently lose the logs.
// ────────────────────────────────────────────────────────────────────────────
function makeTools(ctx: AgentContext) {
  const span = <T,>(name: string, inputs: Record<string, unknown>, fn: () => Promise<T>) =>
    mlflow.withSpan(fn, { name, spanType: mlflow.SpanType.TOOL, inputs });

  const listTopCases = tool({
    name: 'list_top_cases',
    description:
      'List the retention desk worklist (at-risk accounts), sorted by annual revenue at risk. Filter by risk tier, top churn driver and region. Returns customer_id, name, tier, 30-day churn probability, top driver, monthly bill, annual revenue at risk, status.',
    parameters: z.object({
      tier: z.string().nullable().describe('Comma-separated tiers: Critical, High, Medium. null = Critical,High'),
      driver: z.string().nullable().describe('network | bill_shock | competitor | care | account, or null for all'),
      region: z.string().nullable().describe('Southwest | Texas | Southeast | Midwest | Northeast | West, or null'),
      limit: z.number().int().min(1).max(50).describe('Max rows (use 10 unless asked)'),
    }),
    execute: async (a) =>
      span('list_top_cases', a, async () => {
        const rows = await listCases(ctx.db, { tier: a.tier ?? 'Critical,High', driver: a.driver, region: a.region, limit: a.limit });
        return rows.map((r) => ({
          customer_id: r.customerId, name: r.customerName, tier: r.riskTier,
          churn_probability_30d: r.churnProbability, top_driver: r.topDriver, market: r.market,
          monthly_bill: r.monthlyBill, annual_revenue_at_risk: r.annualRevenueAtRisk, status: r.status,
        }));
      }),
  });

  const getCustomerCase = tool({
    name: 'get_customer_case',
    description:
      "Full retention case for ONE account: profile, 30-day churn probability from the UC-registered churn_risk_model, SHAP driver shares (% of the risk explained by network / bill_shock / competitor / care / port_out_intent / account), plain-English reasons, raw signals, and the latest call-center transcript analyzed by AI Functions (sentiment, intent, cancel threat, competitor mentioned, requested remedy, summary). Always call this before recommending an offer.",
    parameters: z.object({ customer_id: z.string().describe('Account id, e.g. VM-104233') }),
    execute: async ({ customer_id }) =>
      span('get_customer_case', { customer_id }, async () => {
        const c = await getCase(ctx.db, customer_id);
        if (!c) return { error: `No retention case for ${customer_id}` };
        const { auditTrail: _a, lastCall, ...rest } = c;
        void _a;
        return { ...rest, last_call: lastCall ? { ...lastCall, transcript: lastCall.transcript.slice(0, 1500) } : null };
      }),
  });

  const evaluateOffersTool = tool({
    name: 'evaluate_offers',
    description:
      "Run the MARGIN GUARDRAIL engine for one account over the whole offer catalog. For each offer returns cost, guardrail_cap (30% of the account's 12-month gross margin), within_guardrail, eligible (+ reason), expected_save_rate (historical save rate of that offer for this account's churn driver, from retention_offer_history) and expected_net_value. `allowed` = eligible AND within guardrail. Sorted best first. You may ONLY stage an allowed offer.",
    parameters: z.object({ customer_id: z.string().describe('Account id') }),
    execute: async ({ customer_id }) =>
      span('evaluate_offers', { customer_id }, async () => {
        const c = await getCase(ctx.db, customer_id);
        if (!c) return { error: `No retention case for ${customer_id}` };
        return { customer_id, top_driver: c.topDriver, monthly_bill: c.monthlyBill, offers: evaluateOffers(c, await listOffers(ctx.db)) };
      }),
  });

  const stageOfferTool = tool({
    name: 'stage_offer',
    description:
      'WRITE. Stage the chosen next-best offer and your drafted customer outreach on the case (status -> offer_ready) so the retention specialist can present it and record accept/decline. The guardrail is re-checked server-side; a breach is rejected with an error starting "GUARDRAIL". Returns the staged offer.',
    parameters: z.object({
      customer_id: z.string().describe('Account id'),
      offer_code: z.string().describe('An offer_code that evaluate_offers returned with allowed=true'),
      channel: z.enum(['sms', 'email', 'call']).describe('Outreach channel'),
      subject: z.string().describe('Short subject / headline (email subject or call opener)'),
      message: z.string().describe('The personalized outreach message, 60-120 words, first name, acknowledges THEIR specific issue, states the offer plainly. No placeholders.'),
      rationale: z.string().describe('One sentence for the specialist: why this offer for this account (driver + guardrail + expected save rate).'),
    }),
    execute: async (a) =>
      span('stage_offer', { customer_id: a.customer_id, offer_code: a.offer_code }, async () =>
        stageOffer(ctx.db, {
          customerId: a.customer_id, offerCode: a.offer_code, channel: a.channel,
          subject: a.subject, message: a.message, rationale: a.rationale, userEmail: ctx.userEmail,
        }),
      ),
  });

  const tools: Tool[] = [listTopCases, getCustomerCase, evaluateOffersTool, stageOfferTool];
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
    name: 'RetentionOps',
    model: ctx.model,
    modelSettings: {
      reasoning: { effort: 'low', summary: 'auto' },
      store: false,
    },
    instructions: `
You are the next-best-offer copilot for the retention desk at Veridian Mobile, a US
regional wireless carrier. Your users are retention specialists and their manager.
Be concise, lead with the number, and never invent data — every figure comes from a tool.

CONTEXT YOU CAN RELY ON
- Postpaid churn rose from ~1.0%/month to ~1.7%/month since July 2026. Three drivers:
  network (a 5G core migration on 2026-06-10 degraded sites PHX-03/07/08, TUS-02, LVS-05),
  bill shock (Switch & Save 12 promo roll-off), competitor (Crest Wireless $25/line promo
  since 2026-07-01 in Southwest + Texas markets; port-out PIN requests spike there).
- The desk historically answered everything with DISC-20 (20% off for 12 months). It saves
  far fewer customers than the driver-matched offer AND usually breaches the margin guardrail.

TOOLS
- ask_data(question): open analytical questions over the lakehouse (trends, segments, sites,
  save rates). ONE focused question per call.
- list_top_cases(tier, driver, region, limit): the worklist.
- get_customer_case(customer_id): risk, SHAP drivers, signals, last call (AI Functions).
- evaluate_offers(customer_id): the margin-guardrail engine. Deterministic — trust it.
- stage_offer(...): WRITE — stage the offer + outreach on the case.

NEXT-BEST-OFFER FLOW (when asked to recommend / save / draft for an account)
1. get_customer_case → name the top driver in plain words, quote the probability and the
   2-3 strongest reasons (and the customer's own words / sentiment from the last call).
2. evaluate_offers → pick the allowed offer with the best expected_net_value that ADDRESSES
   the driver. Say explicitly why DISC-20 was not chosen (guardrail breach or lower save rate)
   when that's the case — quote cost vs cap.
3. Draft the outreach yourself (first name, their specific issue, the offer, no placeholders)
   and call stage_offer immediately — staging is safe: nothing is sent and the specialist
   records the customer's accept/decline in the case panel. Do not ask for confirmation first.
4. Reply with a compact summary: Offer · cost vs guardrail cap · expected save rate · why ·
   then "Staged on the case — record the customer's answer with Accept / Decline."
If stage_offer returns a GUARDRAIL error, pick the next allowed offer and retry once.

You never record accept/decline yourself — that is the human's decision in the UI.
Format with short markdown: bold the offer name, use a small table only for offer comparisons.
`,
    tools: makeTools(ctx),
  });
}

export { run };

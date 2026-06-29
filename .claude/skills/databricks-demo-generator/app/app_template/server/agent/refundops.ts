/**
 * The action-taking agent — this is the DEMO'S DEFINING PIECE.
 *
 * Built on `@openai/agents` (OpenAI Agents SDK) pointed at Databricks'
 * Responses API (`setOpenAIAPI('responses')` lets us stream reasoning
 * summaries alongside final text). Tools capture `db` + `userEmail` via
 * closure so every action is attributed to the viewing user.
 *
 * WHY THIS FILE IS LOAD-BEARING FOR THE TEMPLATE STORY:
 *   The whole pitch is "AI that not only tells you what's wrong, but can
 *   act on it end-to-end, with the human in the loop." That translates to:
 *     1. An investigation tool that delegates to the Databricks
 *        Multi-Agent Supervisor (`ask_data` → MAS) for open-ended "why"
 *        questions backed by SQL + KA retrieval.
 *     2. Lookup tools that read the local Lakebase mirror (fast OLTP).
 *     3. A *write* tool that mutates state in one transaction.
 *   The agent instructions below are phased deliberately: Mode A for pure
 *   investigation; Mode B for write-intent with a mandatory confirmation
 *   step before anything destructive runs.
 *
 * REPURPOSING: to build a different use case:
 *   - Replace `makeTools(ctx)` with your own tools (Zod-schema'd).
 *   - Rewrite `buildAgent()`'s `instructions` string for your domain.
 *   - Keep `configureAgentsSdk()` as-is — it handles the Databricks
 *     Responses API wiring, the `Connection: close` workaround for stale
 *     sockets, and the 64-char `input[*].id` strip (see comments below).
 *   - The data-backend tool (`ask_mas` here) is registered via the
 *     reusable factories in `agent/tools/{mas,genie}.ts`. Pick the one
 *     that matches your demo:
 *       • MAS only      → use `askMasTool(ctx, ctx.masEndpointName)`
 *       • Genie only    → use `askGenieTool(ctx, ctx.genieSpaceId)`
 *                          (and rename the AgentContext field accordingly)
 *       • Both          → register both factories with distinct names,
 *                          and tell the model in instructions when to
 *                          prefer each.
 *
 * Name: the file is called `refundops` because this use case is refund
 * operations. Rename to match your own agent (e.g. `claimsops`,
 * `billingops`, `supporttriage`) and update the import in
 * `chat-stream/agent-stream.ts`.
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
import { authHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import {
  listReturns,
  lotPremiumBreakdown,
  processReturnBatchForLot,
} from '../db/queries/index.js';
// Data-backend tool factories. The template demo uses MAS, but if your
// demo has only a Genie space, swap `askMasTool` → `askGenieTool` and
// update the AgentContext field below (masEndpointName → genieSpaceId).
// If your demo has BOTH, register both tools and tell the model in the
// agent instructions when to prefer each.
import { askMasTool } from './tools/mas.js';
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
  /** MAS serving-endpoint name the `ask_mas` tool talks to. Set in
   * `config/app.json` as `masEndpointName`. The template demo uses MAS;
   * if your demo uses Genie instead, replace this field with
   * `genieSpaceId: string` and swap `askMasTool` → `askGenieTool` in
   * makeTools below. See server/agent/tools/{mas,genie}.ts. */
  masEndpointName: string;
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
  const findReturnsForLot = tool({
    name: 'find_returns_for_lot',
    description:
      "List pending returns for a given production lot. Returns id, customer name/email, premium tier (`final_tier`) and labeled-vs-predicted source (`premium_status_labeled`) from the premium classifier, anger score from `ai_classify`, SKU, product, reason, value, status. Use to preview the rows to the user before drafting a tiered offer.",
    parameters: z.object({
      lot: z.string().describe('Production lot identifier, e.g. LOT-2026-0310'),
    }),
    execute: async ({ lot }) =>
      mlflow.withSpan(
        async () => {
          const rows = await listReturns(ctx.db, { lot, status: 'pending' });
          return rows.map((r) => ({
            id: r.id,
            customer_name: r.customerName,
            customer_email: r.customerEmail,
            loyalty_tier: r.loyaltyTier,
            final_tier: r.finalTier,
            premium_status_labeled: r.premiumStatusLabeled,
            premium_prob: r.premiumProb,
            anger_score: r.angerScore,
            region: r.region,
            sku: r.sku,
            product_name: r.productName,
            category: r.category,
            lot: r.lot,
            return_reason: r.returnReason,
            return_value_usd: r.returnValueUsd,
            status: r.status,
          }));
        },
        {
          name: 'find_returns_for_lot',
          spanType: mlflow.SpanType.TOOL,
          inputs: { lot },
        },
      ),
  });

  const findLotPremiumBreakdown = tool({
    name: 'find_lot_premium_breakdown',
    description:
      "Summarize the premium / standard split for a production lot's pending returns, broken down by labeled (CS-tagged) vs predicted (hidden premiums the model surfaced). Joins app.returns × app.customers × app.customer_premium. Returns {total, premium_count, standard_count, premium_labeled_count, premium_predicted_hidden_count, no_prediction_count, premium_refund_usd, standard_refund_usd, top_countries[]}. Call this in Phase 1 right after identifying the lot — quote the labeled-vs-hidden split in your Phase 2 draft so the user sees what the model contributed BEFORE approving.",
    parameters: z.object({
      lot: z.string().describe('Production lot identifier, e.g. LOT-2026-0310'),
    }),
    execute: async ({ lot }) =>
      mlflow.withSpan(
        async () => lotPremiumBreakdown(ctx.db, lot),
        {
          name: 'find_lot_premium_breakdown',
          spanType: mlflow.SpanType.TOOL,
          inputs: { lot },
        },
      ),
  });

  // Pure — just generates a deterministic code string. No DB write; the
  // coupon ends up inline in the email body when process_return_batch
  // runs. Kept as a tool so the Thinking panel shows the step clearly.
  const createCouponTool = tool({
    name: 'create_coupon',
    description:
      'Generate a coupon code string for this batch. Does not write anywhere — the code is embedded in the email body by process_return_batch. Returns {code, percent_off, reason}.',
    parameters: z.object({
      percent_off: z.number().int().min(1).max(100),
      reason: z
        .string()
        .describe(
          'Short note for why the coupon exists. Surfaces in the audit trail.',
        ),
    }),
    execute: async ({ percent_off, reason }) =>
      mlflow.withSpan(
        async () => {
          const code = `SORRY${percent_off}-${reason
            .replace(/[^A-Z0-9]/gi, '')
            .toUpperCase()
            .slice(0, 20)}`;
          return { code, percent_off, reason };
        },
        {
          name: 'create_coupon',
          spanType: mlflow.SpanType.TOOL,
          inputs: { percent_off, reason },
        },
      ),
  });

  const tierOfferSchema = z.object({
    coupon_code: z
      .string()
      .describe('Coupon code from create_coupon for this tier.'),
    percent_off: z
      .number()
      .int()
      .min(1)
      .max(100)
      .describe('Discount percent — recorded on each row as coupon_pct_applied.'),
    email_subject_template: z
      .string()
      .describe(
        'Subject line template. Placeholders: {firstname} {lastname} {product_name} {coupon_code}.',
      ),
    email_body_template: z
      .string()
      .describe(
        'Email body template. Markdown allowed. Placeholders: {firstname} {lastname} {product_name} {coupon_code}.',
      ),
  });

  const processBatch = tool({
    name: 'process_return_batch',
    description:
      "BULK tool, TIER-AWARE: for every PENDING return in `lot`, JOIN app.customer_premium to read each customer's final_tier (premium|standard) — premium covers BOTH CS-tagged customers and the hidden premiums the model surfaced. Pick the matching offer from `tier_offers`, fill that tier's email template with the customer firstname/lastname/product_name/coupon_code, record the email + coupon_pct_applied on the row, append audit entries (with CS-tagged vs hidden notation for premium rows), and flip to approved — all in one UPDATE. Customers with no prediction default to the standard tier. Returns {premium_coupon, standard_coupon, premium_email_count, premium_labeled_count, premium_predicted_hidden_count, standard_email_count, approved_count, total_refund_usd, skipped_return_ids}. Use ONLY after the user has approved both drafts.",
    parameters: z.object({
      lot: z
        .string()
        .describe(
          'Production lot id (e.g. "LOT-2026-0223") — every pending return in this lot is processed.',
        ),
      tier_offers: z.object({
        premium: tierOfferSchema.describe(
          'Offer for customers with final_tier="premium" — CS-tagged OR model-predicted (typically 20% off + warmer personal apology).',
        ),
        standard: tierOfferSchema.describe(
          'Offer for customers with final_tier="standard" or no prediction (typically 5% goodwill).',
        ),
      }),
    }),
    execute: async (args) =>
      mlflow.withSpan(
        async () =>
          processReturnBatchForLot(ctx.db, {
            lot: args.lot,
            tier_offers: args.tier_offers,
            userEmail: ctx.userEmail,
          }),
        {
          name: 'process_return_batch',
          spanType: mlflow.SpanType.TOOL,
          inputs: {
            lot: args.lot,
            premium_coupon: args.tier_offers.premium.coupon_code,
            standard_coupon: args.tier_offers.standard.coupon_code,
          },
        },
      ),
  });

  // The data-backend tool. The template demo uses a MAS endpoint;
  // swap to `askGenieTool(ctx, ctx.genieSpaceId)` if your demo only has
  // a Genie space (and update AgentContext + config/app.json to match).
  // For a demo with both, register both tools — the model picks based
  // on the descriptions in tools/{mas,genie}.ts.
  // Skip registration entirely if no endpoint is configured — otherwise
  // the tool fires `POST /serving-endpoints//invocations` (note the
  // double slash) and returns a confusing 404 to the model. Boot-time
  // warning in server.ts already tells the operator to fix the config.
  // Typed as Tool[] so the heterogeneous tools (different param schemas) and
  // the optional data-backend tool can coexist — otherwise TS infers a narrow
  // union from the literal array and rejects the push below.
  const tools: Tool[] = [findReturnsForLot, findLotPremiumBreakdown, createCouponTool, processBatch];
  if (ctx.masEndpointName) {
    tools.push(askMasTool(ctx, ctx.masEndpointName));
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
  // root `refundops.turn` and per-tool `withSpan` wrappers.
  //
  // Use a custom fetch that forces a fresh TCP connection per call and
  // disables keep-alive. Without this, after a long-running tool call
  // (ask_data → MAS takes ~90s), the second Responses API call reuses a
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
  // This template ships with `databricks-gpt-5-4` as the agent model because
  // it's the only Databricks-hosted model that supports both the Responses
  // API passthrough AND the SDK-native `response.reasoning_summary_text.*`
  // event stream — which the UI subscribes to for the live "thinking" panel.
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
    name: 'RefundOps',
    model: ctx.model,
    modelSettings: {
      // Enable reasoning summaries so the UI can show live "thinking"
      // (response.reasoning_summary_text.delta events). `effort: 'low'`
      // keeps time-to-first-token snappy for the demo; bump to 'medium'
      // or 'high' if the model needs more deliberation.
      reasoning: { effort: 'low', summary: 'auto' },
      // `store: false` disables the Responses API's server-side
      // conversation state. Databricks' gateway doesn't fully support the
      // state backend; leaving this on causes the second round-trip (after
      // the tool output) to hit a bare 502. Stateless runs work fine.
      store: false,
    },
    instructions: `
You are the operations assistant for the VP of Operations at a D2C beauty
brand (LuxeBeauty). Your user is a non-technical executive. Be decisive,
concise, and always lead with the number.

════════════════════════════════════════════════════════════
TOOLS AT YOUR DISPOSAL
════════════════════════════════════════════════════════════

ask_data(question) — delegates to the multi-agent supervisor. Use for any
  WHY / WHAT HAPPENED / investigative question about data, customers,
  production incidents, or release notes. Prefer ONE well-formed question
  over many small ones.

find_returns_for_lot(lot) — returns pending returns for a specific lot,
  each row carrying the customer's final_tier and premium_status_labeled
  from the premium classifier, plus the row's anger_score from
  ai_classify. Output: {id, customer_name, customer_email, final_tier,
  premium_status_labeled, premium_prob, anger_score, sku, product_name,
  lot, return_reason, return_value_usd, status}.

find_lot_premium_breakdown(lot) — THE TIERING TOOL. Quick aggregation
  over app.returns × app.customers × app.customer_premium for the lot's
  pending returns. Returns {total, premium_count, standard_count,
  premium_labeled_count, premium_predicted_hidden_count, no_prediction_count,
  premium_refund_usd, standard_refund_usd, top_countries[]}. Call this in
  Phase 1 to find out how many customers are premium AND how the count
  splits between CS-tagged ("already known") and model-found ("hidden
  premiums") — you'll quote both numbers in the Phase 2 draft because
  the story beat is "the model found N premiums CS hadn't flagged".

create_coupon(percent_off, reason) — generates a coupon code string
  (pure, no DB write). Returns {code, percent_off, reason}. Call this
  TWICE in the tiered flow — once with percent_off=20 for premium
  customers, once with percent_off=5 for the standard cohort.

process_return_batch(lot, tier_offers) — THE BULK TOOL, TIER-AWARE. For
  every pending return in the lot: JOINs app.customer_premium to read
  each customer's final_tier (which already combines CS-tagged AND
  model-predicted premiums into one boolean), picks tier_offers.premium
  vs tier_offers.standard accordingly, fills that tier's email template
  with the customer firstname/lastname/product_name/coupon_code, records
  coupon_pct_applied on the row, fake-sends the email (persisted on the
  return row), appends an approval decision to the audit trail (noting
  CS-tagged vs hidden for premium rows), and flips status to approved —
  all in one UPDATE. Returns {premium_coupon, standard_coupon,
  premium_email_count, premium_labeled_count, premium_predicted_hidden_count,
  standard_email_count, approved_count, total_refund_usd,
  skipped_return_ids}. **This is how you execute phase 3.** Customers
  without a prediction fall through to the standard tier. Do NOT echo
  individual return IDs back — the tool reads them and their tiers
  server-side from the lot.

THERE ARE NO OTHER TOOLS. There is no send_customer_email, no
accept_order_return, no single-return variant. Everything you can do
is in the five tools above.

════════════════════════════════════════════════════════════
OPERATING MODES
════════════════════════════════════════════════════════════

MODE A — INVESTIGATION
If the user asks "why", "what", "who", "when", or anything that requires
reading data or documents → call ask_data EXACTLY ONCE with a SHORT,
targeted question. Then synthesize for the user. Do NOT use the action
tools unless the user explicitly asks you to fix something.

**Critical for latency**: ask_data calls out to a multi-agent supervisor
that spawns sub-agents per sub-question. Broad questions ("identify
driver, SKUs, lot, timing, reasons, incident...") trigger 4+ sub-agent
hops and take >90s. Narrow questions finish in 20-40s.

Prefer ONE of these shapes over the broad "tell me everything":
  - "Which production lot is driving the recent returns spike? Give me
     the lot id, the 3 affected SKUs, and a one-paragraph root cause."
  - "Which lot has return rate >50% this month, and what incident
     caused it?"

Avoid: asking for weekly trends + SKU breakdown + lot detail + reasons
+ incident narrative in a single question. The supervisor will hop
4 times.

MODE B — ACTION CHAIN (HUMAN-IN-THE-LOOP, TIERED BY PREMIUM STATUS)
If the user asks you to HANDLE / FIX / RESOLVE / PROCESS something, you
run a three-phase chain with a confirmation step in the middle. The
defining move of this chain: **you tier the response by the premium
classifier**. Premium customers (CS-tagged OR model-predicted) get the
bigger save (20% + personal apology); standard customers get a goodwill
nudge (5%). The classifier was trained on the ~4K customers CS has hand-
tagged over the years and predicts on the rest — predictions live in
app.customer_premium in Lakebase; you don't call the model, you just JOIN.

**The story beat that lands the model**: CS already tagged ~18 of the
250 affected customers as premium. The model found ~49 more "hidden
premiums" — untagged customers whose behavior (spend, tenure, return
rate, loyalty tier) looks identical to the tagged ones. Together: ~67
premium / ~183 standard. ALWAYS quote both numbers in Phase 2 ("18
already-tagged + 49 model-found hidden premiums") — that's the model's
value proposition.

Phase 1 and 2 are "prepare + show the user what will happen". Phase 3
is the destructive bulk tool. NEVER run phase 3 (process_return_batch)
until the user has explicitly approved.

--- Phase 1 · Discover (read-only) ---

  1. If you don't already know the target lot, call ask_data with a
     precise question: "Which production lot is driving the recent
     returns spike, and which SKUs are on that lot?". Extract the lot
     identifier from the answer (matches LOT-YYYY-#### or similar).
     If ask_data cannot produce a clear lot, ask the user once — do not
     guess.

  2. Call find_lot_premium_breakdown(<lot>). This is THE tiering moment.
     Output: {total, premium_count, standard_count, premium_labeled_count,
     premium_predicted_hidden_count, no_prediction_count, premium_refund_usd,
     standard_refund_usd, top_countries[]}. Remember these counts — both
     the overall split AND the labeled-vs-hidden breakdown — you quote
     them in Phase 2.

  3. (Optional) Call find_returns_for_lot(<lot>) if you want a sample of
     row-level detail (customer names, products) to preview in Phase 2.
     You do NOT need this for the bulk tool — only for the user-facing
     preview table.

--- Phase 2 · Two coupons + two drafts + ASK FOR CONFIRMATION ---

  4. Call create_coupon TWICE:
       - First: percent_off=20, reason="<lot> defect — premium save
         (CS-tagged + model-found premiums)". Remember as PREMIUM_COUPON.
       - Second: percent_off=5, reason="<lot> defect — goodwill nudge
         (standard cohort)". Remember as STD_COUPON.

  5. Draft TWO email templates — both use the literal placeholders
     {firstname}, {lastname}, {product_name}, and {coupon_code} (do
     NOT substitute them here; the bulk tool does per-row substitution).
       - PREMIUM_TEMPLATE: warmer, personal apology. Acknowledge the
         relationship and value; the 20% coupon is the save.
       - STD_TEMPLATE: brief, sincere, the 5% is goodwill.
     Different subject lines for the two tiers.

  6. Reply to the user with:
       - A bold headline showing the tier split with the model story:
         "Lot {lot}: {total} customers · {premium_count} premium
         ({premium_labeled_count} already tagged by CS + {premium_predicted_hidden_count}
         hidden premiums the model surfaced) · {standard_count} standard.
         Total refund $X."
       - One short markdown table summarizing top_countries from
         the breakdown — *"Where the premium cohort lives"*.
       - The PREMIUM_TEMPLATE in a fenced markdown block, labeled
         "Premium cohort (20% + personal apology) — N customers":
       - The STD_TEMPLATE in a fenced markdown block, labeled
         "Standard cohort (5% goodwill) — M customers":
       - A single-sentence CTA:
           "Reply **send** to email all {total} customers and approve
            their refunds — or tell me which template to change."

     STOP HERE. Do not proceed until the user's next message.

--- Phase 3 · Execute the tiered bulk tool (on approval) ---

  Triggered only when the user's NEXT message is an approval (any form:
  "send", "go", "ok", "approved", "ship it", "do it", "yes",
  "proceed", "looks good"). Anything that looks like a revision
  ("make the premium one warmer", "tighten the standard one",
  "mention X") means → keep BOTH coupons from phase 2, redraft only
  the affected TEMPLATE, and go back to phase 2 step 6 (STOP for
  confirmation again). Do NOT create new coupons on revision.

  On approval:

    A. Call process_return_batch exactly ONCE with:
         lot: the lot id from phase 1 step 1
         tier_offers: {
           premium: {
             coupon_code: PREMIUM_COUPON.code,
             percent_off: 20,
             email_subject_template: <your premium subject>,
             email_body_template:    <your premium body>,
           },
           standard: {
             coupon_code: STD_COUPON.code,
             percent_off: 5,
             email_subject_template: <your standard subject>,
             email_body_template:    <your standard body>,
           },
         }
       DO NOT pass individual return ids. The tool reads pending
       returns for that lot and looks up each customer's final_tier
       server-side.

    B. Final summary — see "SUMMARY FORMAT" below. Use the counts and
       total_refund_usd returned by the tool, not your own memory.

If process_return_batch returns non-empty skipped_return_ids, mention
that in the summary. If it errors, surface the error plainly. Never
pretend a tool ran.

════════════════════════════════════════════════════════════
EMAIL CRAFT
════════════════════════════════════════════════════════════

Tone: sincere, human, owning the mistake. Not corporate. Not over-long.
Length: 3–5 sentences. Subject line short and direct.

Never mention internal jargon to customers — no "lot number", no
"homogenizer", no "QC". Translate it: "a quality issue with this batch
of the product".

Include the coupon code inline in the body.

--- TEMPLATE EXAMPLE (use this shape, rewrite the prose if you want) ---

  Subject: About your recent {product_name} order

  Hi {firstname},

  We're sorry — we spotted a quality issue with the batch of
  {product_name} your order came from, and you shouldn't have to deal
  with that. Your refund is on the way; no need to send anything back.

  As a thank-you for your patience, please use the code
  **{coupon_code}** at checkout for 20% off your next order with us.

  If there's anything else we can do, reply to this email and I'll
  personally look after it.

  — The LuxeBeauty team

--- END TEMPLATE ---

When you show the draft in phase 1, include the template inside a
fenced markdown code block (triple backticks) so the user can see it
clearly. When you actually send in phase 2, fill the placeholders with
real values for each customer (firstname, lastname, product_name,
coupon_code).

════════════════════════════════════════════════════════════
SUMMARY FORMAT (final assistant message)
════════════════════════════════════════════════════════════

ALWAYS end an action chain with a markdown summary the executive can
read in 10 seconds. Example:

**Done — LOT-2026-0310 returns handled.**

- **250 customers** contacted with a tiered apology
  - **67 premium** → 20% coupon (SORRY20-LOT20260310)
    - 18 already-tagged premium by CS
    - 49 hidden premiums the model surfaced
  - **183 standard** → 5% goodwill coupon (SORRY5-LOT20260310)
- **250 returns approved** — $42,300 total refund value
- Top premium markets: France (24), Italy (15)
- Incident: homogenizer pressure fluctuation (QC'd + released anyway)

Next step: consider a field recall for unsold inventory from this lot.

Rules:
- Markdown-bold the headline stat on line 1.
- Numbers come from your tool calls (process_return_batch returns
  premium_email_count, premium_labeled_count, premium_predicted_hidden_count,
  standard_email_count, total_refund_usd) — NOT from memory.
- ALWAYS show the labeled-vs-hidden split for the premium count — it's
  the demo's load-bearing model-value moment.
- Quote the top premium countries from find_lot_premium_breakdown's
  top_countries output.
- Close with ONE concrete "next step" only if warranted.

════════════════════════════════════════════════════════════
TONE
════════════════════════════════════════════════════════════

The user is busy. Lead with the answer. No preamble like "Sure, I'll
help!". No questions-about-your-question unless something is genuinely
ambiguous. When investigating, synthesize — don't dump raw data.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

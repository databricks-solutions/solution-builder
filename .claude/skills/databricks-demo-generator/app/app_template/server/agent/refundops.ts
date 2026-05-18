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
  tool,
  setDefaultOpenAIClient,
  setTracingDisabled,
} from '@openai/agents';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import {
  listReturns,
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
// ────────────────────────────────────────────────────────────────────────────
function makeTools(ctx: AgentContext) {
  const findReturnsForLot = tool({
    name: 'find_returns_for_lot',
    description:
      'List pending returns for a given production lot. Returns id, customer name/email, SKU, product name, reason, value, status.',
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

  const processBatch = tool({
    name: 'process_return_batch',
    description:
      'BULK tool: for every PENDING return in the given `lot`, fill the email template with the customer firstname/lastname/product_name/coupon_code, record the email on the return, append audit entries, and flip the return to approved — all in one UPDATE. Returns {coupon_code, email_count, approved_count, total_refund_usd, skipped_return_ids}. Use ONLY after the user has approved the draft.',
    parameters: z.object({
      lot: z
        .string()
        .describe(
          'Production lot id (e.g. "LOT-2026-0223") — every pending return in this lot will be processed.',
        ),
      coupon_code: z
        .string()
        .describe(
          'The coupon code from create_coupon. Replaces {coupon_code} in the template.',
        ),
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
    }),
    execute: async (args) =>
      mlflow.withSpan(
        async () =>
          processReturnBatchForLot(ctx.db, {
            lot: args.lot,
            coupon_code: args.coupon_code,
            email_subject: args.email_subject_template,
            email_body: args.email_body_template,
            userEmail: ctx.userEmail,
          }),
        {
          name: 'process_return_batch',
          spanType: mlflow.SpanType.TOOL,
          inputs: {
            lot: args.lot,
            coupon_code: args.coupon_code,
          },
        },
      ),
  });

  // The data-backend tool. The template demo uses a MAS endpoint;
  // swap to `askGenieTool(ctx, ctx.genieSpaceId)` if your demo only has
  // a Genie space (and update AgentContext + config/app.json to match).
  // For a demo with both, register both tools — the model picks based
  // on the descriptions in tools/{mas,genie}.ts.
  const askMas = askMasTool(ctx, ctx.masEndpointName);

  return [findReturnsForLot, createCouponTool, processBatch, askMas];
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

find_returns_for_lot(lot) — returns pending returns for a specific lot.
  Output: {id, customer_name, customer_email, sku, product_name, lot,
  return_reason, return_value_usd, status}.

create_coupon(percent_off, reason) — generates a coupon code string
  (pure, no DB write). Returns {code, percent_off, reason}. Call this
  ONCE after the user approves the draft. The code ends up inline in
  the email body rendered by process_return_batch.

process_return_batch(lot, coupon_code, email_subject_template,
  email_body_template) — THE BULK TOOL. For every pending return in the
  given lot: fills the template with firstname/lastname/product_name/
  coupon_code, fake-sends the email (persisted on the return row),
  appends an approval decision to the audit trail, and flips status to
  approved — all in one UPDATE. Returns {coupon_code, email_count,
  approved_count, total_refund_usd, skipped_return_ids}. **This is how
  you execute phase 2.** Do NOT echo individual return IDs back — the
  tool reads them server-side from the lot.

THERE ARE NO OTHER TOOLS. There is no send_customer_email, no
accept_order_return, no single-return variant. Everything you can do
is in the four tools above.

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

MODE B — ACTION CHAIN (HUMAN-IN-THE-LOOP)
If the user asks you to HANDLE / FIX / RESOLVE / PROCESS something, you
run a three-phase chain with a confirmation step in the middle. Phase 1
and 2 are "prepare + show the user what will happen". Phase 3 is the
destructive bulk tool. NEVER run phase 3 (process_return_batch) until
the user has explicitly approved.

--- Phase 1 · Discover (read-only) ---

  1. If you don't already know the target lot, call ask_data with a
     precise question: "Which production lot is driving the recent
     returns spike, and which SKUs are on that lot?". Extract the lot
     identifier from the answer (matches LOT-YYYY-#### or similar).
     If ask_data cannot produce a clear lot, ask the user once — do not
     guess.

  2. Call find_returns_for_lot(<lot>). This gives the authoritative
     list of affected customers and lets you compute the total refund
     value (sum of return_value_usd). You use this output ONLY to
     preview numbers + sample customers to the user in phase 2 — you do
     NOT need to pass these ids anywhere. process_return_batch takes
     the lot id and reads the pending returns itself.

--- Phase 2 · Coupon + draft + ASK FOR CONFIRMATION ---

  3. Call create_coupon once. percent_off = 20 unless the user
     specified otherwise. reason = "<lot> defect — <short technical
     summary you learned from ask_data>" (keep it short and real,
     e.g. "LOT-2026-0310 texture defect — homogenizer pressure").
     Remember the returned code.

  4. Reply to the user with:
       - A bold headline: lot, coupon code (from step 3), number of
         customers, total refund $.
       - "Here's the email I'd send:" followed by the TEMPLATE in a
         fenced markdown code block. The template MUST use the literal
         placeholders {firstname}, {lastname}, {product_name}, and
         {coupon_code} — do NOT substitute them here. (The bulk tool
         substitutes them per customer.)
       - A short markdown table with customer name + product (first
         ~10 rows; "...and N more." if truncated).
       - A single-sentence CTA:
           "Reply **send** to email all N customers and approve their
            refunds — or tell me what to change in the email."

     STOP HERE. Do not proceed until the user's next message.

--- Phase 3 · Execute the bulk tool (on approval) ---

  Triggered only when the user's NEXT message is an approval (any form:
  "send", "go", "ok", "approved", "ship it", "do it", "yes",
  "proceed", "looks good"). Anything that looks like a revision
  ("make it shorter", "warmer tone", "mention X", "change Y") means
  → keep the same coupon from phase 2, redraft the TEMPLATE only, and
  go back to phase 2 step 4 (STOP for confirmation again). Do NOT
  create another coupon on revision.

  On approval:

    A. Call process_return_batch exactly ONCE with:
         lot: the lot id from phase 1 step 1 (e.g. "LOT-2026-0223") —
           DO NOT pass individual return ids. The tool reads pending
           returns for that lot server-side.
         coupon_code: the code from phase 2 step 3
         email_subject_template: the subject you drafted (with the
           {firstname} {lastname} {product_name} {coupon_code}
           placeholders still in it)
         email_body_template: the body you drafted (same placeholders)

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

- **24 customers** contacted with a personalized apology
- Coupon **SORRY20-LOT20260310** (20% off, reused across all emails)
- **24 returns approved** — $1,152 total refund value
- Incident: homogenizer pressure fluctuation (QC'd + released anyway)

Next step: consider a field recall for unsold inventory from this lot.

Rules:
- Markdown-bold the headline stat on line 1.
- Numbers come from your tool calls, NOT from memory. If you don't know
  the total refund value, sum it from find_returns_for_lot output.
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

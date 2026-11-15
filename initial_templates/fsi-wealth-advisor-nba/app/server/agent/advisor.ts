/**
 * Advisor Copilot chat agent (the floating dock) — Calder Pine Private Wealth.
 *
 * Tools:
 *   ask_data              — the Genie agent (Agent mode): wealth-desk analytics over the governed Delta tables AND the
 *                           Calder Pine suitability / vulnerable-client / disclosure / communications policies (cited)
 *   get_morning_book      — the advisor's ranked book (Lakebase): money in motion, AUM at risk, model pick vs suitable pick
 *   get_client_brief      — one household: profile, signals, AI-read CRM notes, every scored action with its suitability rules
 *
 * The full meeting prep (brief + outreach draft) is NOT a chat tool — it runs from the client
 * page (services/prep.ts) so its agenda, disclosures and email render as UI and can be logged.
 */
import { resolvedBackends } from '../services/resources.js';
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { bookForAgent, getClient, listBook } from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
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

/** Genie agent id: config/app.json env if set, else <schema>.demo_resources (services/resources.ts). */
const backends = { genieSpaceId: '' };
export function configureAdvisorAgent(b: { genieSpaceId?: string }) {
  backends.genieSpaceId = b.genieSpaceId ?? '';
}

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext) {
  const tools = [];
  if (backends.genieSpaceId) tools.push(askDataTool(ctx, backends.genieSpaceId));
  tools.push(tool({
    name: 'get_morning_book',
    description: "The advisor's Morning Book from Lakebase, ranked by priority (money in motion, AUM at risk, urgency). Each row: household, client, AUM, money in motion, AUM at risk, signals, days to act, days since last contact, the propensity model's top action and its suitability status, and the best SUITABLE action.",
    parameters: z.object({
      filter: z.enum(['all', 'this_week', 'at_risk', 'lending', 'blocked']).describe('all | this_week (act within 14 days) | at_risk (AUM at risk) | lending (refi / home purchase) | blocked (model top pick fails suitability)'),
      limit: z.number().int().describe('Max rows, 1-25'),
    }),
    execute: async ({ filter, limit }) => {
      const rows = await bookForAgent(ctx.db, { filter: filter === 'all' ? null : filter, limit: Math.max(1, Math.min(25, limit)) });
      return { count: rows.length, households: rows };
    },
  }));
  tools.push(tool({
    name: 'get_client_brief',
    description: 'One household in detail: profile (risk, horizon, liquidity, experience, vulnerable flag), signals, accounts, mortgages, the latest CRM notes with the AI Functions read-out, and EVERY scored next-best action with propensity, assets in scope, expected revenue and the suitability rule results S1-S7.',
    parameters: z.object({ client: z.string().describe('Household id (e.g. HH-10042) or the client name (e.g. "Margaret Castellano")') }),
    execute: async ({ client }) => {
      let id = client.trim().toUpperCase();
      if (!/^HH-\d+$/.test(id)) {
        const hits = (await listBook(ctx.db, { q: client.trim().split(/\s+/).pop() ?? client, limit: 5 })) as Array<{ id: string; primary_name: string }>;
        const exact = hits.find((h) => h.primary_name.toLowerCase() === client.trim().toLowerCase()) ?? hits[0];
        if (!exact) return { error: `No client matching "${client}" in this book` };
        id = exact.id;
      }
      const c = await getClient(ctx.db, id);
      if (!c) return { error: `No household ${client} in this book` };
      return {
        household_id: c.id, client: c.primaryName, age: c.primaryAge, segment: c.segment, aum: c.aum, sweep_cash: c.sweepCash,
        risk_profile: c.riskProfile, horizon_years: c.timeHorizonYears, liquidity_need: c.liquidityNeed, experience: c.investmentExperience,
        vulnerable: c.vulnerable ? c.vulnerableReason : false, last_contact: c.lastContactDate, days_since_contact: c.daysSinceContact,
        money_in_motion: c.moneyInMotion, aum_at_risk: c.aumAtRisk, signals: c.signals, accounts: c.accounts, mortgages: c.liabilities,
        notes: c.notes.slice(0, 4).map((n) => ({ date: n.date, text: n.text, ai: n.ai })),
        actions: c.recommendations.map((r) => ({ rank: r.model_rank, action: r.action_code, name: r.action_name, propensity: r.propensity,
          assets_in_scope: r.assets_in_scope, expected_revenue_12m: r.expected_revenue, suitability: r.status,
          failed_or_review: r.rules.filter((x) => x.result !== 'PASS').map((x) => `${x.rule_id} ${x.rule}: ${x.result} — ${x.finding}`) })),
        decision: c.decision,
      };
    },
  }));
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  // Pick up the Genie agent id the setup job wrote to demo_resources (retries if the boot lookup failed).
  configureAdvisorAgent(await resolvedBackends());
  // Build a fresh auth header each configure; OpenAI SDK holds the key at
  // client construction time, so we reconfigure per request to pick up a
  // fresh bearer. (setDefaultOpenAIClient is idempotent.)
  const headers = await authHeaders(ctx.req);
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  // NOTE: we used to wrap with mlflow-openai's `tracedOpenAI()`, but its
  // wrapper `await`s the response to snapshot outputs — which breaks
  // streaming responses. Skip it; we still get agent-level spans via the
  // root `wealth_advisor_copilot.turn` and per-tool `withSpan` wrappers.
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
    name: 'AdvisorCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Advisor Copilot at Calder Pine Private Wealth (a fictional US wealth manager: 36 advisors, 6 offices,
~5,400 client households, ~$7.6B AUM). You are used by wealth advisors (today: Elena Marsh, Senior Wealth Advisor,
Denver, book ADV-007) and by the head of the wealth desk. Data is as of 2026-09-28. The Fed cut rates three times
this summer (Fed funds 4.50% -> 3.75%): 12-month CDs renew at 3.55%, the bank sweep pays 0.25%, government money
market funds ~3.60%, online banks (Brightline Direct) advertise 4.00%, 30-yr mortgages are 5.90%.

TOOLS
- ask_data: the Genie agent. (a) Firm / desk analytics — money in motion, AUM and flows, outflows, next-best-action
  conversion (targeted vs generic), retention after life events, complaints — SQL over the governed tables. (b) Any
  suitability / vulnerable client / disclosure / outreach rule from the policy library — quote its citation.
- get_morning_book: this advisor's ranked book (who to call first and why).
- get_client_brief: one household in full, with every scored action and its suitability rule results.

RULES
- The propensity model predicts who will ACCEPT an offer; it is NOT a suitability check. Never recommend an action whose
  suitability is FAIL, and say which rules block it (S1 risk, S2 horizon, S3 liquidity, S4 experience, S5 vulnerable
  client, S6 concentration, S7 rollover best interest). REVIEW = allowed only with its condition met.
- Lead with the answer and the key number in **bold** on line one. Be concise (<= 8 lines unless asked). Use $ with
  K/M abbreviations.
- Numbers come from tools, never from memory. Name the source (Genie / policy library / Morning Book).
- For "who should I call first", use get_morning_book(filter=all) and explain the #1 in one line per signal.
- The advisor decides and logs decisions on the client page ("Prep meeting", then log the decision) — you never
  claim to have sent an email or booked a meeting.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

/**
 * Underwriting Copilot chat agent (the floating dock) — Tidewell Specialty Insurance, commercial P&C.
 *
 * Tools (the orchestrator delegates analytics AND guideline questions to one Genie agent):
 *   ask_data                  — the Genie agent (Agent mode): portfolio + queue analytics over the governed Delta tables,
 *                               and appetite / rating / authority / documentation rules from the guideline documents (cited)
 *   list_queue                — the live underwriting queue (Lakebase): triage lane, priority, discrepancies, ML risk, status
 *   get_submission            — one submission: application vs SOV vs loss run, rules hit, risk drivers, latest review
 *   run_underwriting_review   — runs the review (documents → risk → appetite + guideline documents → pricing → memo) and saves the draft
 *   refer_to_cuo              — sends a drafted review that needs CUO authority to the referral queue
 * The agent never issues a decision: the underwriter issues it (or the CUO approves it) in the workbench.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { findSubmission, listQueue, setStatus } from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
import { resolvedBackends } from '../services/resources.js';
import { getCurrentUserEmail } from '../lib/user.js';
import type { UwReview } from '../db/schema.js';
import type { StepEvent } from '../services/underwrite.js';
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

type ReviewRunner = (req: Request, id: string, onStep: (e: StepEvent) => void) => Promise<UwReview | null>;

/** Genie agent id + review runner, set once at boot (server.ts). */
const backends: { genieSpaceId: string; runReview: ReviewRunner | null } = { genieSpaceId: '', runReview: null };
export function configureUwAgent(b: { genieSpaceId?: string; runReview: ReviewRunner }) {
  backends.genieSpaceId = b.genieSpaceId ?? '';
  backends.runReview = b.runReview;
}

const reviewDigest = (r: UwReview) => ({
  decision: r.decision,
  total_premium_usd: r.pricing.total_premium, property_premium_usd: r.pricing.property_premium, gl_premium_usd: r.pricing.gl_premium,
  tiv_submitted_usd: r.pricing.tiv_submitted, tiv_quoted_usd: r.pricing.tiv_quoted, excluded_locations: r.excluded_locations,
  broker_target_premium_usd: r.pricing.target_premium,
  locations: r.locations.map((l) => ({ loc: l.loc_no, name: l.building_name, tiv: l.tiv, roof_age: l.roof_age, included: l.included, premium_usd: l.premium, why_excluded: l.exclusion_reason })),
  risk: r.risk, rules: r.rules.filter((c) => c.status !== 'pass').map((c) => `${c.rule_id} ${c.status} (${c.doc_ref}): ${c.detail}`),
  conditions: r.conditions, referral_required: r.referral_required, referral_reasons: r.referral_reasons,
  guideline_answer: r.guidance?.answer?.slice(0, 900) ?? null, rationale: r.rationale,
});

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext) {
  const tools = [];
  if (backends.genieSpaceId) tools.push(askDataTool(ctx, backends.genieSpaceId));
  tools.push(tool({
    name: 'list_queue',
    description: "The live underwriting queue (Lakebase), highest priority first: insured, broker, segment, state, TIV (from the SOV), triage lane, priority score, number of application-vs-document discrepancies, ML risk band as submitted vs verified, days to effective date, desk status.",
    parameters: z.object({ limit: z.number().int().describe('Max submissions, 1-24'), lane: z.string().nullable().describe('Optional triage lane filter, e.g. "Documents disagree", "Fast track"') }),
    execute: async ({ limit, lane }) => {
      let rows = (await listQueue(ctx.db)) as Array<Record<string, unknown>>;
      if (lane) rows = rows.filter((r) => String(r.triage_lane).toLowerCase().includes(lane.toLowerCase()));
      return { count: rows.length, submissions: rows.slice(0, Math.max(1, Math.min(24, limit))).map((r) => ({
        id: r.id, insured: r.insured_name, broker: r.broker_name, segment: r.segment, state: r.state, tiv_usd: Math.round(Number(r.sov_tiv)),
        lane: r.triage_lane, priority: r.priority_score, discrepancies: r.discrepancy_count, risk_as_submitted: r.band_as_submitted,
        risk_verified: r.band_verified, days_to_effective: r.days_to_effective, status: r.status })) };
    },
  }));
  tools.push(tool({
    name: 'get_submission',
    description: 'One submission in full: what the application says vs what the SOV (every location: construction, year built, roof year, sprinklers, TIV) and the loss run (every claim) show, the discrepancies, appetite / authority rules hit, ML risk as submitted vs verified with drivers, and the latest review if one was drafted.',
    parameters: z.object({ submission: z.string().describe('Submission id (e.g. "SUB-26-0417") or insured name') }),
    execute: async ({ submission }) => {
      const s = await findSubmission(ctx.db, submission);
      if (!s) return { error: `No submission matching ${submission}` };
      return {
        id: s.id, insured: s.insuredName, business: s.businessDescription, broker: `${s.brokerName} (${s.brokerTier})`, segment: s.segment, state: s.state,
        effective_date: s.effectiveDate, broker_remarks: s.remarks, target_premium_usd: s.targetPremium, application_says: s.app,
        sov: s.locations.map((l) => ({ loc: l.locNo, name: l.buildingName, city: l.city, construction: l.construction, year_built: l.yearBuilt, roof_year: l.roofYear, roof_age: l.roofAgeYears, sprinklered: l.sprinklered, protection_class: l.protectionClass, tiv: l.tiv })),
        loss_run: { carrier: s.lossRunCarrier, valued: s.lossRunValued, years: s.lossRunYears, claims: s.claims.map((c) => ({ date: c.lossDate, loc: c.locNo, line: c.line, cause: c.cause, incurred: c.totalIncurred, status: c.status })) },
        discrepancies: s.discrepancies, rules_hit: s.rulesHit, triage_lane: s.triageLane,
        risk: { as_submitted: `${s.bandAsSubmitted} (${s.pAsSubmitted})`, verified: `${s.bandVerified} (${s.pVerified})`, drivers: s.riskDrivers },
        status: s.status, workbench: `/submissions/${s.id}`, review: s.review ? reviewDigest(s.review) : null,
      };
    },
  }));
  tools.push(tool({
    name: 'run_underwriting_review',
    description: 'Run the underwriting review for ONE submission: reconciles the application with the SOV and loss runs, scores the risk model, checks every appetite / authority rule, asks the Genie agent about the guideline documents, rates each location on the TSI-RATE-03 plan (excluding out-of-appetite locations) and drafts the rationale + broker letter. Saves the draft to the workbench (~30-60 s). Does NOT issue anything.',
    parameters: z.object({ submission: z.string().describe('Submission id or insured name') }),
    execute: async ({ submission }) => {
      const s = await findSubmission(ctx.db, submission);
      if (!s) return { error: `No submission matching ${submission}` };
      if (s.status === 'decided') return { error: `${s.id} already has an issued decision`, review: s.review ? reviewDigest(s.review) : null };
      const r = await backends.runReview!(ctx.req, s.id, () => {});
      return r ? { saved_as_draft: true, workbench: `/submissions/${s.id}`, insured: s.insuredName, ...reviewDigest(r) } : { error: 'review failed' };
    },
  }));
  tools.push(tool({
    name: 'refer_to_cuo',
    description: 'Send a drafted review that needs Chief Underwriting Officer authority (TIV above $25M after exclusions, or an appetite referral) to the CUO referral queue. The CUO (a human) approves it in Referrals.',
    parameters: z.object({ submission: z.string(), note: z.string().nullable().describe('Short note for the CUO') }),
    execute: async ({ submission, note }) => {
      const s = await findSubmission(ctx.db, submission);
      if (!s?.review) return { error: `No drafted review for ${submission} — run run_underwriting_review first` };
      if (s.status === 'decided') return { error: 'decision already issued' };
      if (!s.review.referral_required) return { status: 'no_referral_needed', message: 'Within senior underwriter authority — issue it from the workbench (Issue decision).' };
      await setStatus(ctx.db, s.id, 'referred', getCurrentUserEmail(ctx.req), 'referred', note ?? s.review.referral_reasons.join(' '));
      return { status: 'referred', referrals_page: '/referrals', reasons: s.review.referral_reasons };
    },
  }));
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  // Fill in the Genie agent id from demo_resources if app config left it empty.
  const b = await resolvedBackends();
  backends.genieSpaceId ||= b.genieSpaceId;
  // Build a fresh auth header each configure; OpenAI SDK holds the key at
  // client construction time, so we reconfigure per request to pick up a
  // fresh bearer. (setDefaultOpenAIClient is idempotent.)
  const headers = await authHeaders(ctx.req);
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  // NOTE: we used to wrap with mlflow-openai's `tracedOpenAI()`, but its
  // wrapper `await`s the response to snapshot outputs — which breaks
  // streaming responses. Skip it; we still get agent-level spans via the
  // root `uw_copilot.turn` and per-tool `withSpan` wrappers.
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
    name: 'UnderwritingCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Underwriting Copilot for Tidewell Specialty Insurance (a fictional US middle-market commercial property &
package carrier). Users: Dana Whitfield (senior underwriter, $25M TIV authority), Marcus Oyelaran (Chief Underwriting
Officer, approves referrals) and the portfolio team. Today is Monday 28 September 2026. The latest complete loss
quarter is 2026-Q2; "last four quarters" = 2025-Q3..2026-Q2.
Context: Appetite Bulletin TSI-UW-B-2026-07 (effective 1 July 2026) put hail-belt habitational locations with roofs older
than 15 years out of appetite after that cell's loss ratio deteriorated. 24 broker submissions are in today's queue; their
PDFs (application, statement of values, loss run) were read with ai_parse_document at intake.

TOOLS
- ask_data: the Genie agent. (a) Portfolio numbers — loss ratio by segment / hail belt / roof band / quarter, perils,
  brokers and hit ratios, queue counts by lane. (b) Any appetite, rating, authority or documentation question, answered
  from the guideline documents — quote the document ID + section it cites. Ask ONE precise question per call.
- list_queue / get_submission: the live queue and one submission's documents, discrepancies, rules and risk.
- run_underwriting_review: when asked to review / underwrite / price / quote / decline a submission. Then explain it.
- refer_to_cuo: only when the user asks to send a review to the CUO.

RULES
- Lead with the answer and the key number in **bold** on line one. Be concise (<= 8 lines unless asked).
- Numbers come from tools, never from memory; name the source (Genie / live queue / documents / guidelines / review engine).
- Cite only the document IDs and section numbers that appear verbatim in a tool output (e.g. 'TSI-UW-B-2026-07 §2.2'); never invent a section.
- "Underwrite the documents, not the application": when the SOV or loss run contradicts the application, say so with the
  location and the numbers.
- For "which segment is deteriorating" ask Genie: "Loss ratio by portfolio_cell: last four quarters vs prior four quarters, with the change in points".
- You never issue decisions. The underwriter issues in the workbench; the CUO approves referrals in Referrals.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

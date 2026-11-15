/**
 * PA Copilot agent — the utilization-management assistant for MedVault's
 * UM nurses (OpenAI Agents SDK on the Databricks Foundation Model API,
 * Responses API, MLflow-traced).
 *
 * Tools:
 *   queue_overview            open queue KPIs + lanes + breakdowns (Lakebase)
 *   get_case                  one case: request, AI criteria evidence, notes
 *   find_auto_approval_lane   cases passing the MV-UM-000 auto-approval rule
 *   release_auto_approvals    WRITE: approve the lane (only after the nurse confirms)
 *   ask_data                  the Genie agent (Agent mode): historical PA analytics over Delta AND the MedVault
 *                             medical policy documents (cited)
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import type { Tool } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { getExecutionContext } from '@databricks/appkit';
import { authHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import {
  autoApprovalCandidates,
  autoApproveBatch,
  caseSummary,
  getCase,
  queueBreakdown,
} from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
import { writeDecisionsToDelta } from '../lib/writeback.js';
export type { ToolProgressEvent } from './tools/types.js';

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
  /** Genie Agent space id (tables + documents volume) the `ask_data` tool queries. */
  genieSpaceId: string;
  databricksHost: string;
  model: string;
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  modelError?: { current: ModelErrorDetail | null };
};

/** Resource wiring set once at boot by server.ts (Genie agent, Delta target). */
const resources = { genieSpaceId: '', catalog: '', schema: '' };
export function setAgentResources(r: Partial<typeof resources>) {
  Object.assign(resources, r);
}

function makeTools(ctx: AgentContext) {
  const queueOverview = tool({
    name: 'queue_overview',
    description:
      'Snapshot of the OPEN prior-authorization queue: totals, expedited count, breached / at-risk SLA clocks (72h expedited, 168h standard, measured at the Monday 08:00 snapshot), AI lanes (Auto-approval lane, Nurse fast-track, Request information, Physician review), decisions taken today, and breakdowns by policy, practice group, channel and urgency. Call this first for any question about the current queue.',
    parameters: z.object({}),
    execute: async () =>
      mlflow.withSpan(async () => ({ summary: await caseSummary(ctx.db), breakdown: await queueBreakdown(ctx.db) }), {
        name: 'queue_overview',
        spanType: mlflow.SpanType.TOOL,
      }),
  });

  const getCaseTool = tool({
    name: 'get_case',
    description:
      'Full detail of ONE prior-auth request by id (e.g. PA-2609-009507): member, provider, service, urgency, SLA hours remaining, the AI recommendation with rationale, every policy criterion with its status (Met / Not Met / Not Documented) and the verbatim evidence quote + source note id, and the submitted clinical notes.',
    parameters: z.object({ request_id: z.string().describe('The PA request id, e.g. PA-2609-009507') }),
    execute: async (args) =>
      mlflow.withSpan(
        async () => {
          const c = await getCase(ctx.db, args.request_id);
          if (!c) return { error: `No open case ${args.request_id}` };
          return c;
        },
        { name: 'get_case', spanType: mlflow.SpanType.TOOL, inputs: args },
      ),
  });

  const findLane = tool({
    name: 'find_auto_approval_lane',
    description:
      'List the open cases that pass the MV-UM-000 auto-approval rule: policy is auto-approval eligible AND the AI marked EVERY criterion Met with cited evidence AND recommendation APPROVE AND confidence >= 0.85. Returns count, expedited count, total estimated cost and the rows (id, member, policy, urgency, hours remaining, confidence). Read-only.',
    parameters: z.object({}),
    execute: async () =>
      mlflow.withSpan(
        async () => {
          const rows = await autoApprovalCandidates(ctx.db);
          return {
            count: rows.length,
            expedited: rows.filter((r) => r.urgency === 'Expedited').length,
            est_cost_usd: Math.round(rows.reduce((s, r) => s + (r.estCostUsd ?? 0), 0)),
            by_policy: Object.entries(
              rows.reduce<Record<string, number>>((m, r) => ((m[r.policyTitle ?? r.policyId] = (m[r.policyTitle ?? r.policyId] ?? 0) + 1), m), {}),
            ).map(([policy, n]) => ({ policy, n })),
            rows: rows.slice(0, 40).map((r) => ({
              request_id: r.requestId,
              member: r.memberName,
              policy: r.policyTitle,
              urgency: r.urgency,
              hours_remaining: r.hoursRemaining,
              ai_confidence: r.aiConfidence,
            })),
          };
        },
        { name: 'find_auto_approval_lane', spanType: mlflow.SpanType.TOOL },
      ),
  });

  const release = tool({
    name: 'release_auto_approvals',
    description:
      'WRITE ACTION. Approves every case in the auto-approval lane (the rule is re-checked at write time; automation never denies or pends). Writes the decision + audit entry to Lakebase and appends it to the Delta um_decisions table. Call ONLY after the nurse explicitly confirmed ("yes", "go ahead", "release them"). Returns the number approved.',
    parameters: z.object({
      confirmed_by_user: z.boolean().describe('true only if the user explicitly confirmed the release in their last message'),
    }),
    execute: async (args) =>
      mlflow.withSpan(
        async () => {
          if (!args.confirmed_by_user) return { error: 'Ask the nurse to confirm before releasing.' };
          const rows = await autoApproveBatch(ctx.db, { by: ctx.userEmail });
          writeDecisionsToDelta(
            resources.catalog,
            resources.schema,
            rows.map((r) => ({
              requestId: r.requestId,
              decision: 'Auto-approved',
              decidedBy: 'AUTO-RULE-v1',
              aiRecommendation: r.aiRecommendation,
              agreedWithAi: true,
              note: `Released via PA Copilot by ${ctx.userEmail}`,
            })),
          );
          return {
            approved: rows.length,
            expedited: rows.filter((r) => r.urgency === 'Expedited').length,
            request_ids: rows.map((r) => r.requestId),
          };
        },
        { name: 'release_auto_approvals', spanType: mlflow.SpanType.TOOL, inputs: args },
      ),
  });


  const tools: Tool[] = [queueOverview, getCaseTool, findLane, release];
  if (resources.genieSpaceId) tools.push(askDataTool(ctx, resources.genieSpaceId));
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
      console.debug(
        `[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get('content-type') ?? '?'})`,
      );
      // SP fallback: if the model call is rejected with the forwarded USER token
      // (401/403 — e.g. the user's OBO token lacks the model-serving scope or the
      // endpoint permission), retry ONCE as the app service principal. The body
      // is a string, so it can be resent as-is.
      if ((resp.status === 401 || resp.status === 403) && ctx.req.headers['x-forwarded-access-token']) {
        try {
          const spAuth = new Headers();
          await getExecutionContext().client.config.authenticate(spAuth);
          const spBearer = spAuth.get('Authorization');
          if (spBearer) {
            console.warn(`[openai-shim] ${resp.status} with user token from ${url} — retrying with app SP`);
            headers.set('Authorization', spBearer);
            resp = await fetch(input as Parameters<typeof fetch>[0], { ...init, headers, body, keepalive: false });
          }
        } catch (e) {
          console.error('[openai-shim] SP fallback failed', e);
        }
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
    name: 'PACopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are PA Copilot, the utilization-management assistant inside MedVault Health Plan's
prior-authorization workbench. Your user is a UM nurse reviewer (e.g. Dana Whitfield, RN)
or the UM operations lead. Be precise, clinical, and brief. Lead with the number.

CONTEXT
- The queue is a snapshot taken Monday 08:00; SLA clocks follow CMS-0057-F: 72 hours for
  EXPEDITED requests, 7 calendar days (168h) for STANDARD requests.
- Every open case was pre-reviewed by AI Functions (ai_query) against its medical policy:
  each criterion is Met / Not Met / Not Documented with a verbatim quote from the notes.
- Lanes: "Auto-approval lane" (auto-eligible policy + all criteria met + confidence >= 0.85),
  "Nurse fast-track" (all met but the policy requires nurse sign-off, e.g. surgery / specialty drug),
  "Request information" (something is not documented -> pend with a specific request),
  "Physician review" (a criterion is not met -> only a Medical Director may deny).
- Automation may APPROVE but must NEVER deny or pend. Never recommend a denial yourself.

TOOLS
- queue_overview: current queue KPIs + lanes + breakdowns. Use first for "what's on my plate".
- get_case(request_id): a single case with evidence. Cite criterion ids (e.g. MV-RAD-014.C2)
  and quote the evidence when explaining a case.
- find_auto_approval_lane: read-only list of cases the rule would approve.
- release_auto_approvals(confirmed_by_user): the WRITE. Two-step protocol: first call
  find_auto_approval_lane and present the count, expedited count, the policies involved and
  the rule; ask "Release these N auto-approvals?" and STOP. Only when the user confirms, call
  release_auto_approvals with confirmed_by_user=true and report how many were approved.
- ask_data(question): the Genie agent. (a) Any "what does the policy require / who can deny / what
  is the auto-approval rule" question, answered from the medical policy documents — cite the policy id.
  (b) Historical analytics over the last 120 days (turnaround, SLA compliance, pend/denial rates by
  practice group, channel, weekend fax backlog). Ask ONE clear question per call.

STYLE
- Markdown. Bold the headline number on line 1. Short bullets. No preamble.
- Numbers must come from tool outputs, never from memory.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

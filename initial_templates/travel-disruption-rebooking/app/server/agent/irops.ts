/**
 * IROPS Copilot chat agent (the floating dock) — Aeralis Airways, Winter Storm Harlan.
 *
 * Tools (the orchestrator delegates analytics AND policy questions to one Genie agent):
 *   ask_data                 — the Genie agent (Agent mode): ops analytics over the governed Delta tables AND the IROPS
 *                              policy, fare rules, EU261/UK261 + US DOT documents (cited)
 *   list_disrupted_flights   — the live Lakebase desk: cancelled flights, what AutoProtect did, plan status
 *   get_priority_passengers  — who on a flight needs protecting (SSR, connections, escalated messages, top tier)
 *   plan_reaccommodation     — runs the deterministic re-accommodation engine for a flight and saves the draft plan
 *   submit_plan_for_approval — sends a drafted plan to the IROPS Duty Manager's approval queue
 * The agent never commits a plan: the Duty Manager (a human) approves in the Approvals page.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { findFlight, listFlights, priorityPassengers, setStatus } from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
import { resolvedBackends } from '../services/resources.js';
import { getCurrentUserEmail } from '../lib/user.js';
import type { ReaccomPlan } from '../db/schema.js';
import type { StepEvent } from '../services/reaccom.js';
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

type PlanRunner = (req: Request, flightId: string, onStep: (e: StepEvent) => void) => Promise<ReaccomPlan | null>;

/** Genie agent id + plan runner, set once at boot (server.ts). */
const backends: { genieSpaceId: string; runPlan: PlanRunner | null } = { genieSpaceId: '', runPlan: null };
export function configureIropsAgent(b: { genieSpaceId?: string; runPlan: PlanRunner }) {
  backends.genieSpaceId = b.genieSpaceId ?? '';
  backends.runPlan = b.runPlan;
}

const planDigest = (p: ReaccomPlan) => ({
  flight: p.flight_number,
  plan: { same_day: p.metrics.same_day, pax: p.metrics.pax, priority_same_day: `${p.metrics.priority_same_day}/${p.metrics.priority_pax}`,
    special_assistance_overnight: p.metrics.special_assistance_overnight, umnr_overnight: p.metrics.umnr_overnight,
    misconnects: p.metrics.misconnects, partner_seats: p.metrics.partner_seats, partner_spend_usd: Math.round(p.metrics.partner_spend),
    hotel_rooms: p.metrics.hotel_rooms, total_cost_usd: Math.round(p.metrics.total_cost), cost_per_pax_usd: Math.round(p.metrics.cost_per_pax),
    predicted_detractor_rate: p.metrics.predicted_detractor_rate },
  autoprotect: { same_day: p.autoprotect.same_day, special_assistance_overnight: p.autoprotect.special_assistance_overnight,
    umnr_overnight: p.autoprotect.umnr_overnight, misconnects: p.autoprotect.misconnects, split_bookings: p.autoprotect.split_parties,
    total_cost_usd: Math.round(p.autoprotect.total_cost), cost_per_pax_usd: Math.round(p.autoprotect.cost_per_pax),
    predicted_detractor_rate: p.autoprotect.predicted_detractor_rate },
  requires_approval: p.requires_approval, approval_reasons: p.approval_reasons,
  guardrails: p.guardrails.map((g) => `${g.rule_id} ${g.status}: ${g.detail}`),
  priority_bookings: [...new Map(p.assignments.filter((a) => ['P1', 'P2', 'P3'].includes(a.priority)).map((a) => [a.pnr, a])).values()].slice(0, 12)
    .map((a) => ({ pnr: a.pnr, who: p.assignments.filter((x) => x.pnr === a.pnr).map((x) => x.name).join(', '), why: a.priority_reason,
      new_flight: a.label, arrive: a.arrive, same_day: a.same_day, autoprotect_had: `${a.ap.label} (${a.ap.same_day ? 'today' : a.ap.nights === 1 ? 'tomorrow' : 'day+2'})`, note: a.note })),
});

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext) {
  const tools = [];
  if (backends.genieSpaceId) tools.push(askDataTool(ctx, backends.genieSpaceId));
  tools.push(tool({
    name: 'list_disrupted_flights',
    description: 'The live IROPS desk (Lakebase): Winter Storm Harlan cancelled flights, worst first, with passengers, special-assistance (SSR) and UMNR counts, onward long-haul connectors, what AutoProtect did (same-day count, SSR passengers left overnight, misconnects) and the desk plan status.',
    parameters: z.object({ limit: z.number().int().describe('Max flights, 1-36') }),
    execute: async ({ limit }) => {
      const rows = (await listFlights(ctx.db)) as Array<Record<string, unknown>>;
      return { count: rows.length, flights: rows.slice(0, Math.max(1, Math.min(36, limit))).map((r) => ({
        flight: r.flight_number, route: `${r.origin}→${r.destination}`, departs: r.sched_dep, pax: r.pax, special_assistance: r.special_assistance,
        umnr: r.umnr, onward_long_haul: r.onward, escalated_messages: r.escalated, eu_uk_261: r.eu_uk_261,
        autoprotect_same_day: r.ap_same_day, autoprotect_ssr_overnight: r.ap_ssr_overnight, autoprotect_misconnects: r.ap_misconnects,
        desk_status: r.status, plan_same_day: r.plan_same_day })) };
    },
  }));
  tools.push(tool({
    name: 'get_priority_passengers',
    description: 'Passengers on one cancelled flight who need protecting first: special assistance (UMNR, wheelchair, lap infant), onward long-haul connections, escalated messages (AI Functions summary + urgency), Platinum/Diamond — with what AutoProtect held for them.',
    parameters: z.object({ flight_number: z.string().describe('e.g. "AE 1418"'), limit: z.number().int().describe('Max passengers, 1-40') }),
    execute: async ({ flight_number, limit }) => {
      const f = await findFlight(ctx.db, flight_number);
      if (!f) return { error: `No cancelled flight ${flight_number}` };
      return { flight: f.flightNumber, route: `${f.origin}→${f.destination}`, passengers: await priorityPassengers(ctx.db, f.id, limit) };
    },
  }));
  tools.push(tool({
    name: 'plan_reaccommodation',
    description: 'Run the re-accommodation engine for ONE cancelled flight: priority order, parties kept together, own + Lumen Air partner seats, hotel entitlement and cost guardrails, compared with AutoProtect; also consults the policy documents (Genie agent) and drafts passenger notifications. Saves the draft plan to the flight workbench (~40-60 s). Does NOT commit anything.',
    parameters: z.object({ flight_number: z.string().describe('e.g. "AE 1418"') }),
    execute: async ({ flight_number }) => {
      const f = await findFlight(ctx.db, flight_number);
      if (!f) return { error: `No cancelled flight ${flight_number}` };
      if (f.status === 'committed') return { error: `${f.flightNumber} is already committed`, plan: f.plan ? planDigest(f.plan) : null };
      const plan = await backends.runPlan!(ctx.req, f.id, () => {});
      return plan ? { saved_as_draft: true, workbench: `/flights/${f.id}`, ...planDigest(plan) } : { error: 'plan failed' };
    },
  }));
  tools.push(tool({
    name: 'submit_plan_for_approval',
    description: 'Send the drafted plan of a flight to the IROPS Duty Manager approval queue (only for plans that need approval — over the partner-spend limit or with a policy exception). A human approves and commits it.',
    parameters: z.object({ flight_number: z.string(), note: z.string().nullable().describe('Short justification for the Duty Manager') }),
    execute: async ({ flight_number, note }) => {
      const f = await findFlight(ctx.db, flight_number);
      if (!f?.plan) return { error: `No drafted plan for ${flight_number} — run plan_reaccommodation first` };
      if (f.status === 'committed') return { error: 'already committed' };
      if (!f.plan.requires_approval) return { status: 'no_approval_needed', message: 'Within guardrails — the desk can commit it from the workbench (Commit plan).' };
      await setStatus(ctx.db, f.id, 'awaiting_approval', getCurrentUserEmail(ctx.req), 'submitted', note ?? f.plan.approval_reasons.join(' '));
      return { status: 'awaiting_approval', approvals_page: '/approvals', reasons: f.plan.approval_reasons };
    },
  }));
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  // The Genie agent id comes from <schema>.demo_resources (setup job) when not set in env —
  // resolve before every run (the boot-time lookup may have hit a cold warehouse).
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
  // root `irops_copilot.turn` and per-tool `withSpan` wrappers.
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
    name: 'IropsCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the IROPS Copilot for the Aeralis Airways Operations Control Center at Chicago O'Hare (Aeralis is a fictional
US airline; Lumen Air is its partner). Users: Marisol Vega (IROPS desk re-accommodation lead), Tom Brennan (IROPS Duty
Manager, approves plans) and Priya Shah (VP Customer Experience).
Today is Friday 13 February 2026, Winter Storm Harlan: ORD ground stop 05:40-12:30 CT; Aeralis cancelled 36 flights.
At 05:10 the legacy auto-rebooker AutoProtect held seats FIFO by booking date, own metal only — ignoring SSR codes,
onward connections, loyalty tier, partner seats and parties. The desk re-plans flight by flight.

TOOLS
- ask_data: the Genie agent. (a) Numbers about the storm or IROPS history — how many passengers, AutoProtect outcomes,
  special-assistance passengers left overnight, misconnects, cost per disrupted passenger, NPS, AutoProtect vs the DEN
  desk-priority pilot. (b) Any rule, entitlement or regulation question, from the policy documents — quote the document ID.
- list_disrupted_flights / get_priority_passengers: what is on the live desk right now.
- plan_reaccommodation: when asked to re-plan / re-accommodate / protect a flight. Then explain the plan vs AutoProtect.
- submit_plan_for_approval: only when the user asks to send a plan to the Duty Manager.

RULES
- Lead with the answer and the key number in **bold** on line one. Be concise (<= 8 lines unless asked).
- Numbers come from tools, never from memory; name the source (Genie agent / live desk / policy documents / plan engine).
- For the overall storm picture ask Genie ONE question: "Winter Storm Harlan impact summary: disrupted passengers, AutoProtect same-day and overnight, special-assistance and UMNR overnight, misconnects". Use list_disrupted_flights for which flights are worst.
- You never commit rebookings. The Duty Manager approves in Approvals; the desk commits in the flight workbench.
`.trim(),
    tools: makeTools(ctx),
  });
}

export { run };

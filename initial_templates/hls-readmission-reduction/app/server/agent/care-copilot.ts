/**
 * Readmission Copilot chat agent (the floating dock) — the care-coordinator agent.
 *
 * Tools:
 *   ask_data                — the Genie agent (Agent mode): readmission analytics over the Delta gold tables AND
 *                             Larkspur care-transition pathways / policies / HRRP primer documents (cited)
 *   readmission_signal      — HF readmission change by unit, 4 West by discharge weekday, the 7-day follow-up effect, unit events
 *   hrrp_exposure           — estimated CMS HRRP penalty per hospital + the what-if of booking weekend follow-ups on 4 West
 *   get_worklist            — open discharges ranked by readmission_risk_model@champion (Lakebase mirror)
 *   get_patient             — one patient: risk, drivers, what-if, AI-read discharge note, plan + tasks
 *   build_transition_plan   — builds the pathway-based transition plan for a patient (saved as a draft in Lakebase)
 *   create_outreach_task    — WRITE-BACK: creates an outreach task in Lakebase (book follow-up, 48-h call, Ride Assist, …)
 *   outreach_queue          — open / done outreach tasks (Lakebase)
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { createTask, findPatient, latestPlan, listTasks, listWorklist, savePlan } from '../db/queries/index.js';
import { askDataTool } from './tools/genie.js';
import * as cd from '../services/care-data.js';
import { buildTransitionPlan } from '../services/transition-plan.js';
import { resolvedBackends } from '../services/resources.js';
import { hrrpWhatIf } from '../../shared/hrrp.js';
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

/** Model for the plan's summary/call script (chat completions), set at boot (server.ts). */
const settings = { memoModel: 'databricks-claude-sonnet-4-5' };
export function configureCareAgent(s: { memoModel?: string }) {
  if (s.memoModel) settings.memoModel = s.memoModel;
}

const span = <T>(name: string, inputs: Record<string, unknown>, fn: () => Promise<T>) =>
  mlflow.withSpan(fn, { name, spanType: mlflow.SpanType.TOOL, inputs });
const pct = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 10);

const TASK_TYPES = ['book_followup', 'call_48h', 'med_rec_call', 'lab_order', 'home_health', 'ride_assist', 'financial_counseling', 'interpreter_teach_back', 'other'] as const;

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext, b: { genieSpaceId: string }) {
  const tools = [];
  if (b.genieSpaceId) tools.push(askDataTool(ctx, b.genieSpaceId));
  tools.push(tool({
    name: 'readmission_signal',
    description: 'Where and why heart-failure readmissions are rising: HF 30-day readmission rate by unit (last 26 weeks vs before), 4 West HF by discharge weekday (7-day follow-up booked % and readmission rate, before vs last 26 weeks), readmission rate with vs without a 7-day follow-up per HRRP condition, the operational changes on 4 West, and the social risks AI Functions read in the discharge notes.',
    parameters: z.object({}),
    execute: async () => span('readmission_signal', {}, async () => {
      const [k, units, weekday, followup, events, notes] = await Promise.all([cd.kpis(), cd.unitHf('HF'), cd.signalByWeekday(), cd.followupEffect(), cd.unitEvents(cd.SIGNAL_UNIT), cd.noteSignals()]);
      return { data_as_of: k.as_of, headline: k, hf_by_unit: units, four_west_hf_by_weekday: weekday, followup_effect_12m: followup, four_west_events: events, note_social_risks_all_hrrp_conditions: notes,
        note: 'rates are fractions (0.275 = 27.5%); only discharges with a closed 30-day window count. note_social_risks_all_hrrp_conditions covers ALL HRRP conditions with a discharge note (last ~120 days), not heart failure only.' };
    }),
  }));
  tools.push(tool({
    name: 'hrrp_exposure',
    description: 'Estimated CMS HRRP penalty per hospital (trailing 12 months), the per-condition excess readmission ratio (ERR) estimates (12 months and last 6 months), and a deterministic what-if for Larkspur Regional: had 4 West booked a 7-day follow-up for target_followup_pct % of its weekend heart-failure discharges over the same 12 months — readmissions avoided, new HF ERR, penalty saved.',
    parameters: z.object({ target_followup_pct: z.number().describe('Target % of 4 West weekend HF discharges leaving with a 7-day follow-up booked (e.g. 75)') }),
    execute: async ({ target_followup_pct }) => span('hrrp_exposure', { target_followup_pct }, async () => {
      const [penalty, perf, inputs] = await Promise.all([cd.hrrpPenalty(), cd.hrrpPerformance(), cd.whatIfInputs()]);
      return { penalty_by_hospital: penalty, conditions_with_err_above_1: perf.filter((r) => r.err_estimate > 1 || r.err_last_6m > 1.05),
        what_if_larkspur_regional: { inputs, result: hrrpWhatIf(inputs, target_followup_pct / 100) },
        caveat: 'ERR here = observed vs national rate over the trailing 12 months, credibility-weighted for small volumes (not CMS risk adjustment, which uses a 3-year hierarchical model).' };
    }),
  }));
  tools.push(tool({
    name: 'get_worklist',
    description: 'The care-transitions worklist: open discharges (planned in the next days, or discharged in the last 7 days) ranked by predicted 30-day readmission risk (readmission_risk_model@champion), with follow-up status, top drivers, social risks read from the note, and plan status.',
    parameters: z.object({
      unit_id: z.string().nullable().describe('Unit filter, e.g. LRMC-4W (4 West), LRMC-3N, MCH-2W — or null'),
      condition: z.string().nullable().describe('HF | AMI | PN | COPD | CABG | THA_TKA | OTHER — or null'),
      risk_tier: z.string().nullable().describe('High | Medium | Low — or null'),
      limit: z.number().int().describe('Max rows 1-25'),
    }),
    execute: async ({ unit_id, condition, risk_tier, limit }) => span('get_worklist', { unit_id, condition, risk_tier, limit }, async () => {
      const rows = await listWorklist(ctx.db, { unitId: unit_id, condition, tier: risk_tier, limit: Math.max(1, Math.min(25, limit)) });
      return { count: rows.length, patients: rows.map((r) => ({
        encounter_id: r.encounterId, patient: r.patientName, age: r.data.age, unit: r.unitName, condition: r.hrrpCondition, discharge_date: r.dischargeDate,
        discharge_day: r.data.discharge_dow, status: r.status, risk_pct: pct(r.riskScore), tier: r.riskTier, followup_booked: r.followupBooked,
        risk_if_followup_pct: pct(r.data.risk_if_followup), top_drivers: r.data.top_drivers, note_social: r.data.sdoh_summary, plan_status: r.planStatus,
      })) };
    }),
  }));
  tools.push(tool({
    name: 'get_patient',
    description: 'One worklist patient by name or encounter id: demographics, risk score + drivers + what-if, what AI Functions read in the discharge note (social risks, medication changes, follow-up as written, pending labs), the latest transition plan and its outreach tasks.',
    parameters: z.object({ patient: z.string().describe('Patient name (e.g. "Harold Brennan") or encounter id') }),
    execute: async ({ patient }) => span('get_patient', { patient }, async () => {
      const p = await findPatient(ctx.db, patient);
      if (!p) return { error: `No open discharge found for "${patient}"` };
      const [plan, tasks] = await Promise.all([latestPlan(ctx.db, p.encounterId), listTasks(ctx.db, { encounterId: p.encounterId })]);
      const { note_text, ...rest } = p.data;
      return { encounter_id: p.encounterId, patient: p.patientName, unit: p.unitName, condition: p.hrrpCondition, discharge_date: p.dischargeDate, status: p.status,
        risk_pct: pct(p.riskScore), tier: p.riskTier, followup_booked: p.followupBooked, details: rest, discharge_note: note_text,
        plan: plan ? { id: plan.id, status: plan.status, tasks: plan.plan.tasks.map((t) => t.title) } : null,
        outreach_tasks: tasks.map((t) => ({ title: t.title, due: t.dueDate, owner: t.owner, status: t.status })) };
    }),
  }));
  tools.push(tool({
    name: 'build_transition_plan',
    description: 'Build the pathway-based transition plan for ONE worklist patient: risk + drivers, AI-read note, unit context, care-pathway guidance (the Genie agent over the pathway documents), the outreach task list with owners and due dates, and a 48-hour call script. Saved as a DRAFT the coordinator approves in the worklist (or create tasks directly with create_outreach_task).',
    parameters: z.object({ patient: z.string().describe('Patient name or encounter id') }),
    execute: async ({ patient }) => span('build_transition_plan', { patient }, async () => {
      const p = await findPatient(ctx.db, patient);
      if (!p) return { error: `No open discharge found for "${patient}"` };
      const plan = await buildTransitionPlan(ctx.req, p, { genieSpaceId: b.genieSpaceId, memoModel: settings.memoModel, onStep: () => {} });
      const row = await savePlan(ctx.db, { plan, by: ctx.userEmail, via: 'copilot' });
      const f = plan.facts;
      return { plan_id: row.id, status: 'draft', encounter_id: p.encounterId, summary: plan.summary,
        facts: { ...f, risk_score: undefined, risk_if_followup: undefined, risk_if_followup_hh: undefined, risk_pct: pct(f.risk_score), risk_if_followup_pct: pct(f.risk_if_followup), risk_if_followup_and_home_health_pct: pct(f.risk_if_followup_hh) },
        tasks: plan.tasks.map((t) => ({ task_type: t.task_type, title: t.title, due_date: t.due_date, owner: t.owner, source: t.source })),
        pathway_sources: plan.guidance?.sources ?? [], call_script: plan.call_script };
    }),
  }));
  tools.push(tool({
    name: 'create_outreach_task',
    description: 'WRITE-BACK: create ONE outreach task in the care team queue (Lakebase) for a worklist patient. Only call it when the user asks you to create / assign / schedule a task.',
    parameters: z.object({
      encounter_id: z.string().describe('The patient encounter id (from get_worklist / get_patient)'),
      task_type: z.enum(TASK_TYPES),
      title: z.string().describe('Short imperative title, e.g. "Book HF Transitions Clinic visit by Thu Oct 8"'),
      detail: z.string().describe('What to do and why (1-2 sentences, cite the pathway section)'),
      due_date: z.string().describe('YYYY-MM-DD'),
      owner: z.string().describe('Discharge navigator | RN navigator | Transitions pharmacist | Care-transitions coordinator | Discharging physician'),
    }),
    execute: async (a) => span('create_outreach_task', a, async () => {
      const row = await createTask(ctx.db, { encounterId: a.encounter_id, taskType: a.task_type, title: a.title, detail: a.detail, dueDate: a.due_date, owner: a.owner, by: ctx.userEmail });
      return { created: true, task_id: row.id, patient: row.patientName, title: row.title, due_date: row.dueDate, owner: row.owner, status: row.status };
    }),
  }));
  tools.push(tool({
    name: 'outreach_queue',
    description: 'Outreach tasks in the care team queue (Lakebase), open or done, with patient, owner and due date.',
    parameters: z.object({ status: z.enum(['open', 'done']).nullable() }),
    execute: async ({ status }) => span('outreach_queue', { status }, async () => {
      const rows = await listTasks(ctx.db, { status });
      return { count: rows.length, tasks: rows.slice(0, 40).map((t) => ({ patient: t.patientName, title: t.title, due: t.dueDate, owner: t.owner, status: t.status, via: t.createdVia })) };
    }),
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
  // root `care_copilot.turn` and per-tool `withSpan` wrappers.
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

export async function buildAgent(ctx: AgentContext): Promise<Agent> {
  const b = await resolvedBackends();
  return new Agent({
    name: 'ReadmissionCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Readmission Copilot for Larkspur Health's care-transitions team, used by Maya Okafor, RN (Director of Care
Transitions) and the care coordinators. Larkspur Health runs 3 hospitals: Larkspur Regional Medical Center (LRMC, flagship),
Millbrook Community Hospital (MCH) and Castle Ridge Hospital (CRH). The goal: reduce 30-day readmissions and the CMS HRRP
penalty by getting every high-risk patient the right transition plan before or right after discharge.

TOOLS
- readmission_signal: where/why readmissions are rising (unit, discharge weekday, 7-day follow-up effect, unit events, social
  risks read from notes). Use it first for "what is going on / why" questions.
- ask_data: the Genie agent. (a) Any other analytics question over the governed gold tables (SQL). (b) What Larkspur's
  pathways and policies require, from the documents (cite the section it returns).
- hrrp_exposure: the CMS HRRP penalty estimate and the what-if of fixing weekend follow-ups on 4 West.
- get_worklist / get_patient: today's open discharges ranked by the readmission risk model; one patient's full picture.
- build_transition_plan: the full pathway-based plan for one patient (draft).
- create_outreach_task: WRITE-BACK a task to the care team queue — only when the user asks you to create/assign tasks.
- outreach_queue: what is already assigned.

RULES
- Lead with the answer and the key number in **bold** on line one. Be concise (≤ 10 lines unless asked); short markdown
  tables for lists of patients or units.
- Numbers and dates come from tools, never from memory. Tool rates are fractions — show them as percentages. Name the source
  (Genie / readmission model / AI Functions on discharge notes / care pathways / HRRP estimate).
- The HRRP ERR in this app is a management estimate (observed vs national rate, credibility-weighted), not the CMS
  risk-adjusted figure; say so when you quote a penalty.
- The model does not see transportation or cost barriers — those come from the discharge note (AI Functions); call them out.
- When creating tasks after a plan, create one task per plan item the user approved, with the plan's due date and owner.
- You recommend and draft; the coordinator approves. Never give clinical orders — frame medication items as tasks for the
  pharmacist / physician.
`.trim(),
    tools: makeTools(ctx, b),
  });
}

export { run };

/**
 * Warranty Copilot chat agent (the floating dock).
 *
 * Tools:
 *   ask_data                 — the Genie agent (Agent mode): VP-Quality analytics over the governed gold tables AND the
 *                              PPAPs, PCN-0419, the supplier quality agreement, warranty policy, field-campaign procedure (cited)
 *   list_warranty_signals    — the live early-warning board (Lakebase)
 *   get_root_cause_evidence  — assembles the root-cause case for a signal: cohort isolation,
 *                              alternatives ruled out, telemetry, exposure + priced containment
 *                              (live SQL on the lakehouse — services/analyze.ts buildEvidence)
 *   open_quality_case        — the write-back: opens the quality case in Lakebase (only when asked)
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders, markSpFallback, spAuthHeaders, usesSpFallback } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import { getSignal, listSignals, openQualityCase, signalClaims } from '../db/queries/index.js';
import type { DataConfig } from '../db/sync.js';
import { buildEvidence } from '../services/analyze.js';
import { askDataTool } from './tools/genie.js';
import { resolvedBackends, type Backends } from '../services/resources.js';
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

/** Delta location, set once at boot from config/app.json (server.ts). The Genie agent id are
 *  resolved per turn via services/resources.ts (env first, else <catalog>.<schema>.demo_resources). */
const backends: { data?: DataConfig } = {};
export function configureWarrantyAgent(b: { data?: DataConfig }) {
  backends.data = b.data;
}

const money = (n: number | null | undefined) => (n == null ? null : Math.round(n));

async function resolveSignal(db: AppDb, ref: string) {
  const direct = await getSignal(db, ref);
  if (direct) return direct;
  const all = (await listSignals(db)) as Array<Record<string, unknown>>;
  const q = ref.toLowerCase();
  const hit = all.find((s) => [s.failure_mode, s.failure_mode_label, s.supplier_name, s.supplier_id, s.cohort_values]
    .some((v) => typeof v === 'string' && (v.toLowerCase().includes(q) || q.includes(v.toLowerCase().split(' ')[0]))));
  return hit ? getSignal(db, String(hit.id)) : (all[0] ? getSignal(db, String(all[0].id)) : null);
}

// Strict-mode tool schemas: every field required; use .nullable() not .optional().
function makeTools(ctx: AgentContext, b: Backends) {
  const tools = [];
  if (b.genieSpaceId) tools.push(askDataTool(ctx, b.genieSpaceId));
  tools.push(tool({
    name: 'list_warranty_signals',
    description: 'The live early-warning board (Lakebase): every flagged emerging failure signal with supplier, claims in the last 90 days, rate vs the prior-year baseline, suspect cohort (lots / firmware), bikes in scope, projected remaining-warranty cost, status and any quality case already opened.',
    parameters: z.object({}),
    execute: async () => {
      const rows = (await listSignals(ctx.db)) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        signal_id: r.id, failure_mode: r.failure_mode_label, supplier: r.supplier_name, chargeable_to_supplier: r.chargeable,
        claims_90d: r.claims_90d, rate_ratio_vs_prior_year: r.rate_ratio, suspect_cohort: `${r.cohort_dimension}: ${r.cohort_values}`,
        bikes_in_scope: r.affected_units, projected_remaining_warranty_cost: money(Number(r.projected_cost)), status: r.status, quality_case_id: r.quality_case_id,
      }));
    },
  }));
  tools.push(tool({
    name: 'get_root_cause_evidence',
    description: 'Assemble the root-cause case for ONE signal with live SQL on the lakehouse: how dealers coded the claims, the lot / firmware cohort that concentrates them (per 1,000 bike-years), alternative explanations tested (firmware update, same-line build weeks with the other supplier, wet vs dry climate), connected-bike telemetry early warning (bikes signalling the fault now), bikes in scope, projected remaining-warranty cost and PRICED containment options incl. the supplier chargeback. Takes ~20 s.',
    parameters: z.object({ signal: z.string().describe('Signal id (SIG-xxxxxx) or a description such as "Hanlin controller water ingress"') }),
    execute: async ({ signal }) =>
      mlflow.withSpan(async () => {
        if (!backends.data) return { error: 'data config missing' };
        const s = await resolveSignal(ctx.db, signal);
        if (!s) return { error: `no signal matches "${signal}"` };
        const cl = await signalClaims(ctx.db, s);
        const ev = await buildEvidence(s, cl.map((c) => ({ id: c.id, dealer_labor_code: c.dealerLaborCode, water_exposure: c.waterExposure, fault_code: c.faultCode, total_cost: c.totalCost, region: c.region, claim_status: c.claimStatus })), backends.data);
        return {
          signal_id: s.id, failure_mode: s.failureModeLabel, supplier: s.supplierName,
          findings: ev.findings.map((f) => ({ finding: f.title, verdict: f.verdict, detail: f.detail })),
          containment_scope_lots: ev.scopeLots, supplier_parts_at_plant_to_quarantine: ev.plantStock,
          telemetry: ev.telemetry, exposure: ev.exposure,
          containment_options: ev.options.map((o) => ({ key: o.key, option: o.label, recommended: o.recommended, units: o.units, cost: o.cost, recoverable_from_supplier: o.recoverable, detail: o.detail })),
          chargeback: ev.chargeback, quality_case_already_open: s.qualityCaseId,
        };
      }, { name: 'get_root_cause_evidence', spanType: mlflow.SpanType.TOOL, inputs: { signal } }),
  }));
  tools.push(tool({
    name: 'open_quality_case',
    description: 'WRITE-BACK: open the quality case for a signal in Lakebase (root cause, containment actions, projected exposure, campaign cost, supplier chargeback). Only call when the user explicitly asks to open / create / log the quality case. Uses the latest root-cause analysis of the signal; if the signal has not been analyzed yet, tell the user to run "Assemble root-cause case" in the signal workbench first.',
    parameters: z.object({
      signal: z.string().describe('Signal id or description'),
      actions: z.array(z.string()).describe('Containment option keys to include (stop_ship, campaign_full, campaign_wet, chargeback, do_nothing). Empty array = the recommended set.'),
      notes: z.string().nullable().describe('Optional note from the user'),
    }),
    execute: async ({ signal, actions, notes }) => {
      const s = await resolveSignal(ctx.db, signal);
      if (!s) return { error: `no signal matches "${signal}"` };
      if (!s.analysis) return { error: `Signal ${s.id} has no root-cause analysis yet — open it in the workbench and click "Assemble root-cause case" first.` };
      const r = await openQualityCase(ctx.db, { signalId: s.id, actions, notes, userEmail: getCurrentUserEmail(ctx.req), openedVia: 'copilot' });
      if ('error' in r) return r;
      const c = r.case;
      return { quality_case_id: c.id, already_existed: r.existing, title: c.title, supplier: c.supplierName, affected_lots: c.affectedLots, affected_units: c.affectedUnits, actions: (c.containmentActions ?? []).map((a) => a.label), campaign_cost: money(c.campaignCost), chargeback_amount: money(c.chargebackAmount), owner: c.owner, link: `/signals/${s.id}` };
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
  // root `warranty_copilot.turn` and per-tool `withSpan` wrappers.
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
    name: 'WarrantyCopilot',
    model: ctx.model,
    modelSettings: { reasoning: { effort: 'low', summary: 'auto' }, store: false },
    instructions: `
You are the Warranty Copilot for Brightwater Cycle Works, an e-bike maker (Reno, NV plant; ~44,000 bikes built since
Oct 2024; models Commuter C3, Cargo K2, Fold F1 on a rear hub motor with the Hanlin MC-48 controller, and the Trail T5
mid-drive with a Kessler MC-60 controller). Users: Priya Raman (warranty & field quality engineer) and Daniel Okafor
(VP Quality). Every bike carries a 24-month warranty; dealers file claims with a coarse labor code + free-text
technician notes, which AI Functions (ai_classify) turn into failure modes.

TOOLS
- ask_data: the Genie agent. (a) Any question about claims, claims per 1,000 bikes, warranty cost, cost per bike, failure
  modes, lots, regions, dealers, supplier recovery / chargebacks, trends — SQL over the governed gold tables. (b) PPAP / PCN
  status, what the supplier quality agreement says, what can be recovered, campaign procedure, from the documents —
  always quote the document + section it cites.
- list_warranty_signals: what the early-warning board shows right now.
- get_root_cause_evidence: to explain WHY a signal happens, assemble the root-cause case, or price containment.
- open_quality_case: ONLY when the user explicitly asks to open/log the case. Confirm what you opened (id, actions, amounts).

RULES
- "What is driving claims / cost / the jump?" → call ask_data with EXACTLY this question: "Which failure mode is driving
  the increase in warranty claims? Compare claims in the last 90 days with the prior-year 90-day average, by AI failure
  mode and supplier." Then answer with the top driver, its claims vs baseline and cost, and mention the #2 driver in one
  line. Use the last 90 days — never invent per-1,000 figures that Genie did not return.
- Lead with the answer and the key number in **bold** on line one. Be concise (≤ 10 lines unless asked); use a short
  bullet list for evidence.
- Numbers come from tools, never from memory. Say where each came from (Genie / lakehouse evidence / supplier docs).
- Root cause = the physical mechanism + where it entered the supply chain + the evidence that rules alternatives out.
- Distinguish claim cost to date from projected remaining-warranty exposure. Claim cost includes paid AND pending
  claims — call it "cost", never "paid".
- Never claim a quality case or chargeback exists unless a tool returned it.
`.trim(),
    tools: makeTools(ctx, b),
  });
}

export { run };

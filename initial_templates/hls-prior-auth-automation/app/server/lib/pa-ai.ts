import type { Request } from 'express';
import { authHeaders } from './auth.js';
import { callGenieAgent } from '../agent/tools/genie.js';

/**
 * Live AI helpers for the prior-auth workbench:
 *   • reviewCaseLive — the same criteria review the ai_query batch runs in
 *     Delta (src/deploy/build_ai_review.sql), invoked on demand for ONE case
 *     through the Foundation Model API (strict JSON schema output).
 *   • askPolicy — question → the Genie agent over the MedVault medical policy documents (Agent mode;
 *     the documents live in the policy_docs UC volume).
 */

export const REVIEW_MODEL = process.env.REVIEW_MODEL || 'databricks-gpt-5-4-mini';

export function workspaceHost(): string {
  const h = (process.env.DATABRICKS_HOST ?? '').replace(/\/$/, '');
  if (!h) return '';
  return h.startsWith('http') ? h : `https://${h}`;
}

const REVIEW_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'pa_review',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['criteria', 'recommendation', 'confidence', 'rationale', 'missing_information'],
      properties: {
        criteria: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['criterion_id', 'status', 'evidence', 'source_note_id'],
            properties: {
              criterion_id: { type: 'string' },
              status: { type: 'string', enum: ['Met', 'Not Met', 'Not Documented'] },
              evidence: { type: 'string' },
              source_note_id: { type: 'string' },
            },
          },
        },
        recommendation: { type: 'string', enum: ['APPROVE', 'PEND', 'REFER_MD'] },
        confidence: { type: 'number' },
        rationale: { type: 'string' },
        missing_information: { type: 'string' },
      },
    },
  },
};

export type LiveReview = {
  criteria: Array<{ criterion_id: string; status: string; evidence: string; source_note_id: string }>;
  recommendation: string;
  confidence: number;
  rationale: string;
  missing_information: string;
  model: string;
};

export async function reviewCaseLive(
  req: Request,
  c: {
    policyId: string;
    policyTitle: string | null;
    criteria: Array<{ criterionId: string; label: string | null; criterionText: string | null }>;
    notes: Array<{ noteId: string; noteType: string | null; noteText: string }>;
  },
): Promise<LiveReview> {
  const criteriaText = c.criteria.map((k) => `${k.criterionId} - ${k.label}: ${k.criterionText}`).join('\n');
  const notesText = c.notes.map((n) => `[${n.noteId} | ${n.noteType}]\n${n.noteText}`).join('\n\n');
  const prompt =
    `You are a utilization-management clinical reviewer at a health plan. Evaluate the clinical documentation against EVERY coverage criterion of medical policy ${c.policyId} (${c.policyTitle}).\n\nCRITERIA:\n${criteriaText}\n\nCLINICAL DOCUMENTATION:\n${notesText}\n\n` +
    'For each criterion return status Met (explicit supporting evidence), Not Met (the documentation contradicts it) or Not Documented (no evidence either way). Be strict: every criterion needs its OWN explicit sentence of evidence - never infer one criterion from another criterion, from the diagnosis, or from the document type. evidence = a short VERBATIM quote from the documentation, without surrounding quotation marks (empty string if Not Documented); source_note_id = the bracketed note id the quote comes from (empty if Not Documented). recommendation: APPROVE if every criterion is Met, PEND if any criterion is Not Documented and none is Not Met, REFER_MD if any criterion is Not Met (only a physician may deny). confidence between 0 and 1. rationale: 1-2 plain sentences for the nurse. missing_information: the specific item(s) to request from the provider (empty string if none).';

  const headers = await authHeaders(req);
  headers.set('Content-Type', 'application/json');
  const resp = await fetch(`${workspaceHost()}/serving-endpoints/${REVIEW_MODEL}/invocations`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], response_format: REVIEW_SCHEMA }),
  });
  if (!resp.ok) {
    throw new Error(`AI review failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
  }
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(content) as Omit<LiveReview, 'model'>;
  return { ...parsed, model: REVIEW_MODEL };
}

export async function askPolicy(req: Request, genieSpaceId: string, question: string) {
  if (!genieSpaceId) return { answer: 'Genie agent is not configured (GENIE_SPACE_ID).', trace_id: null };
  return callGenieAgent({ req, databricksHost: workspaceHost() }, genieSpaceId, `Answer from the MedVault medical policy documents, citing the policy id and section: ${question}`);
}

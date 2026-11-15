import type { Request } from 'express';
import { authedFetch } from './auth.js';
import { callGenieAgent } from '../agent/tools/genie.js';

/**
 * Thin helpers over the Genie agent and Databricks Model Serving, called with the viewer's OBO token
 * (falls back to the app SP locally — see lib/auth.ts).
 *
 *   askDocuments          — the Genie agent over the documents volume (Agent mode) → cited answer + source files
 *   chatJson              — Foundation Model chat completion that must return a JSON object
 */

function host(): string {
  return (process.env.DATABRICKS_HOST ?? '').replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
}

/** "osg_ch04_brand_safety.md" → "Standards Guide ch.4 — brand safety". */
function prettySource(t: string): string {
  const m = /osg_ch0?(\d+)_(.+?)(\.md)?$/i.exec(t);
  return m ? `Standards Guide ch.${m[1]} — ${m[2].replace(/_/g, ' ')}` : t;
}

/** Document Q&A: the Genie agent (Agent mode) searches the demo's documents volume and returns a cited markdown
 * answer; `sources` are the cited file names (from the volume deep links). */
export type DocAnswer = { answer: string; sources: string[] };

export async function askDocuments(req: Request, spaceId: string, question: string): Promise<DocAnswer> {
  const { answer } = await callGenieAgent({ req, databricksHost: host() }, spaceId, question);
  const sources = [...new Set([...answer.matchAll(/filePreviewPath=([^)&\s]+)/g)].map((m) => prettySource(decodeURIComponent(m[1]))))];
  return { answer, sources };
}

export async function chatJson<T>(req: Request, model: string, system: string, user: string): Promise<T> {
  const resp = await authedFetch(req, `${host()}/serving-endpoints/${model}/invocations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 2500,
      temperature: 0.2,
    }),
  });
  if (!resp.ok) throw new Error(`${model} → HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const body = (await resp.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  let content = body.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    content = content.map((p: { text?: string }) => p?.text ?? '').join('');
  }
  const text = String(content ?? '');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`${model} returned no JSON object: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]) as T;
}

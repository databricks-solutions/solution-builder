export type Json = Record<string, any>;

export async function getJson<T = Json>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `${r.status} ${url}`);
  return r.json();
}

export async function postJson<T = Json>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `${r.status} ${url}`);
  return j as T;
}

/** POST + read a Server-Sent-Events stream, calling onEvent for each `data:` payload. */
export async function streamSse(url: string, onEvent: (ev: Json) => void): Promise<void> {
  const r = await fetch(url, { method: 'POST' });
  if (!r.ok || !r.body) throw new Error(`${r.status} ${url}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

export const usd = (n: unknown, compact = false) =>
  Number(n ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: compact && Math.abs(Number(n ?? 0)) >= 1e6 ? 1 : 0, notation: compact ? 'compact' : 'standard' });
export const fmtDate = (s: unknown) => (s ? new Date(String(s)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
export const fmtDateTime = (s: unknown) => (s ? new Date(String(s)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const DECISION_LABEL: Record<string, string> = { file_sar: 'SAR filed', close_no_sar: 'Closed — no SAR', escalate: 'Escalated to BSA Officer' };

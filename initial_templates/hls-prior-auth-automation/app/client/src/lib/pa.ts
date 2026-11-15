import { okOrThrow } from '@/lib/api';
import type { ActivityEvent, CaseDetail, CaseRow, Summary } from '@/shared/types';

async function get<T>(url: string): Promise<T> {
  return (await okOrThrow(await fetch(url), url)).json();
}
async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await okOrThrow(res, url)).json();
}

export const fetchSummary = () => get<Summary>('/api/cases/summary');
export const fetchCases = (p: { lane?: string; urgency?: string; status?: string; q?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  return get<CaseRow[]>(`/api/cases${qs ? `?${qs}` : ''}`);
};
export const fetchCase = (id: string) => get<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`);
export const fetchAutoApprovable = () => get<CaseRow[]>('/api/cases/auto-approvable');
export const fetchActivity = (limit = 12) => get<ActivityEvent[]>(`/api/activity/recent?limit=${limit}`);
export const releaseAutoApprovals = () => post<{ approved: number; requestIds: string[] }>('/api/cases/auto-approve', {});
export const decideCase = (id: string, decision: 'approve' | 'pend' | 'refer_md', note?: string, providerLetter?: string) =>
  post<CaseDetail>(`/api/cases/${encodeURIComponent(id)}/decide`, { decision, note, providerLetter });
export const rerunReview = (id: string) => post<CaseDetail>(`/api/cases/${encodeURIComponent(id)}/review`);
export const askPolicy = (question: string) => post<{ answer: string }>('/api/policy/ask', { question });

export function fmtHours(h: number): string {
  const a = Math.abs(h);
  const s = a >= 48 ? `${Math.round(a / 24)}d ${Math.round(a % 24)}h` : `${Math.floor(a)}h ${Math.round((a % 1) * 60)}m`;
  return h < 0 ? `${s} overdue` : `${s} left`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

export function relTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

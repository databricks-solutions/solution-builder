/**
 * REST helpers for the operations domain (returns / lots / facilities /
 * customers / activity feed).
 *
 * REPURPOSING THE TEMPLATE: when you swap data models, rename this file
 * to match your domain (e.g. `lib/turbines.ts`, `lib/claims.ts`) and
 * update the imports that reference it. The TYPES live in
 * `shared/types.ts` — change those there, not here. This file should
 * only contain `fetch` calls.
 */
import type {
  CustomerOrder,
  Decision,
  FacilityLotRow,
  FacilityRow,
  LotRow,
  ReturnDetail,
  ReturnRow,
  ReturnStatus,
  ReturnsSummary,
  ActivityEvent,
} from '@/shared/types';

export async function fetchReturns(
  filters: { status?: ReturnStatus; lot?: string } = {},
): Promise<ReturnRow[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.lot) qs.set('lot', filters.lot);
  const res = await fetch(`/api/returns?${qs}`);
  if (!res.ok) throw new Error(`/api/returns: ${res.status}`);
  return res.json();
}

export async function fetchReturn(id: string): Promise<ReturnDetail> {
  const res = await fetch(`/api/returns/${id}`);
  if (!res.ok) throw new Error(`/api/returns/${id}: ${res.status}`);
  return res.json();
}

export async function fetchReturnsSummary(): Promise<ReturnsSummary[]> {
  const res = await fetch('/api/returns/summary');
  if (!res.ok) throw new Error(`/api/returns/summary: ${res.status}`);
  return res.json();
}

export async function fetchLotSummary(limit = 6): Promise<LotRow[]> {
  const res = await fetch(`/api/lots/summary?limit=${limit}`);
  if (!res.ok) throw new Error(`/api/lots/summary: ${res.status}`);
  return res.json();
}

export async function fetchFacilitySummary(): Promise<FacilityRow[]> {
  const res = await fetch('/api/facilities/summary');
  if (!res.ok) throw new Error(`/api/facilities/summary: ${res.status}`);
  return res.json();
}

export async function fetchFacilityLots(
  facility: string,
  limit = 5,
): Promise<FacilityLotRow[]> {
  const res = await fetch(
    `/api/facilities/${encodeURIComponent(facility)}/lots?limit=${limit}`,
  );
  if (!res.ok)
    throw new Error(`/api/facilities/.../lots: ${res.status}`);
  return res.json();
}

export async function fetchCustomerOrders(
  customerId: string,
  limit = 10,
): Promise<CustomerOrder[]> {
  const res = await fetch(
    `/api/customers/${encodeURIComponent(customerId)}/orders?limit=${limit}`,
  );
  if (!res.ok) throw new Error(`/api/customers/.../orders: ${res.status}`);
  return res.json();
}

export async function fetchActivity(limit = 20): Promise<ActivityEvent[]> {
  const res = await fetch(`/api/activity/recent?limit=${limit}`);
  if (!res.ok) throw new Error(`/api/activity/recent: ${res.status}`);
  return res.json();
}

export async function decideReturn(
  id: string,
  decision: Decision,
  notes?: string,
): Promise<void> {
  const res = await fetch(`/api/returns/${id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, notes }),
  });
  if (!res.ok) {
    const err = (await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error: string;
    };
    throw new Error(err.error);
  }
}

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
import { okOrThrow } from './api';
import type {
  CityBucket,
  CustomerOrder,
  Decision,
  FacilityLotRow,
  FacilityRow,
  ReturnDetail,
  ReturnRow,
  ReturnStatus,
  ReturnsSummary,
  ActivityEvent,
} from '@/shared/types';

export async function fetchReturns(
  filters: {
    status?: ReturnStatus;
    lot?: string;
    tier?: 'premium' | 'standard';
    country?: string;
    sort?: 'anger' | 'recent' | 'value';
  } = {},
): Promise<ReturnRow[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.lot) qs.set('lot', filters.lot);
  if (filters.tier) qs.set('tier', filters.tier);
  if (filters.country) qs.set('country', filters.country);
  if (filters.sort) qs.set('sort', filters.sort);
  const res = await okOrThrow(await fetch(`/api/returns?${qs}`), '/api/returns');
  return res.json();
}

export async function fetchReturn(id: string): Promise<ReturnDetail> {
  const res = await okOrThrow(
    await fetch(`/api/returns/${id}`),
    `/api/returns/${id}`,
  );
  return res.json();
}

export async function fetchReturnsSummary(): Promise<ReturnsSummary[]> {
  const res = await okOrThrow(
    await fetch('/api/returns/summary'),
    '/api/returns/summary',
  );
  return res.json();
}

export async function fetchCityBreakdown(
  filters: { status?: ReturnStatus; lot?: string } = {},
): Promise<CityBucket[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.lot) qs.set('lot', filters.lot);
  const res = await okOrThrow(
    await fetch(`/api/returns/by-city?${qs}`),
    '/api/returns/by-city',
  );
  return res.json();
}

export async function fetchFacilitySummary(): Promise<FacilityRow[]> {
  const res = await okOrThrow(
    await fetch('/api/facilities/summary'),
    '/api/facilities/summary',
  );
  return res.json();
}

export async function fetchFacilityLots(
  facility: string,
  limit = 5,
): Promise<FacilityLotRow[]> {
  const res = await okOrThrow(
    await fetch(
      `/api/facilities/${encodeURIComponent(facility)}/lots?limit=${limit}`,
    ),
    '/api/facilities/.../lots',
  );
  return res.json();
}

export async function fetchCustomerOrders(
  customerId: string,
  limit = 10,
): Promise<CustomerOrder[]> {
  const res = await okOrThrow(
    await fetch(
      `/api/customers/${encodeURIComponent(customerId)}/orders?limit=${limit}`,
    ),
    '/api/customers/.../orders',
  );
  return res.json();
}

export async function fetchActivity(limit = 20): Promise<ActivityEvent[]> {
  const res = await okOrThrow(
    await fetch(`/api/activity/recent?limit=${limit}`),
    '/api/activity/recent',
  );
  return res.json();
}

export async function decideReturn(
  id: string,
  decision: Decision,
  notes?: string,
): Promise<void> {
  await okOrThrow(
    await fetch(`/api/returns/${id}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, notes }),
    }),
    `/api/returns/${id}/decide`,
  );
}

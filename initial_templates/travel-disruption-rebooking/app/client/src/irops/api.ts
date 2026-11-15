/** IROPS desk API client + shared types (mirrors server/db/schema.ts shapes). */
import { okOrThrow } from '@/lib/api';

export type FlightRow = {
  id: string; flight_number: string; origin: string; destination: string; destination_city: string | null; sched_dep: string;
  aircraft: string | null; eu_uk_261: string | null; status: FlightStatus; plan_updated_at: string | null; committed_at: string | null;
  pax: number; special_assistance: number; umnr: number; onward: number; escalated: number; top_tier: number;
  ap_same_day: number; ap_ssr_overnight: number; ap_misconnects: number; plan_same_day: number | null;
  requires_approval: boolean | null; plan_partner_spend: number | null;
};
export type FlightStatus = 'unplanned' | 'plan_drafted' | 'awaiting_approval' | 'committed';

export type EventSummary = {
  flights_cancelled: number; pax: number; ap_same_day: number; ap_day_plus_2: number; special_assistance: number;
  ap_ssr_overnight: number; umnr: number; ap_umnr_overnight: number; onward: number; ap_misconnects: number; escalated: number;
  ap_split_bookings: number; desk_committed_pax: number; desk_same_day: number; current_same_day: number;
  committed: number; awaiting_approval: number; drafted: number; rooms_total: number; rooms_remaining: number;
};

export type Passenger = {
  id: string; pnr: string; flightId: string; firstName: string; lastName: string; age: number | null; tier: string;
  cabin: string | null; fareBrand: string | null; originType: string | null; awayFromHome: boolean; homeCity: string | null;
  finalDestination: string | null; onwardFlight: string | null; onwardDep: string | null; onwardLongHaul: boolean; ssr: string;
  partySize: number; language: string | null; channel: string | null; euUk261: string | null; apOptionId: string | null;
  apLabel: string | null; apArrive: string | null; apSameDay: boolean; apNights: number; apMisconnect: boolean; apSplit: boolean;
  pSameDay: number | null; pNextDay: number | null; pAutoprotect: number | null; message: string | null; messageEnglish: string | null;
  messageIntent: string | null; messageUrgency: string | null; messageSentiment: string | null; messageSummary: string | null;
  escalated: boolean; deskOptionId: string | null; deskLabel: string | null; deskHotelId: string | null; deskCommittedAt: string | null;
};
export type OptionRow = {
  id: string; flightId: string; rank: number; optionType: string; carrier: string; label: string; depart: string; arrive: string;
  arrivalAirport: string; seatsProtected: number; seatsRemaining: number; costPerSeat: number; isPartner: boolean; sameDay: boolean;
  nearbyAirport: boolean; acceptsUmnr: boolean; delayHours: number;
};
export type HotelRow = { id: string; airport: string; name: string; roomsTotal: number; roomsRemaining: number; accessibleRooms: number; rate: number; shuttleMinutes: number | null };

export type Priority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
export type Assignment = {
  pax_id: string; pnr: string; name: string; priority: Priority; priority_reason: string; option_id: string; label: string;
  depart: string; arrive: string; arrival_airport: string; same_day: boolean; nights: number; delay_hours: number; is_partner: boolean;
  partner_cost: number; hotel_id: string | null; hotel_name: string | null; meal_usd: number; misconnect: boolean; cost_usd: number;
  p_detractor: number | null; note: string | null; ap: { label: string | null; same_day: boolean; nights: number; misconnect: boolean; split: boolean };
};
export type PlanMetrics = {
  pax: number; same_day: number; overnight: number; day_plus_2: number; priority_pax: number; priority_same_day: number;
  special_assistance_overnight: number; umnr_overnight: number; onward_pax: number; misconnects: number; split_parties: number;
  partner_seats: number; partner_spend: number; hotel_rooms: number; hotel_cost: number; meal_cost: number; misconnect_cost: number;
  goodwill_cost: number; total_cost: number; cost_per_pax: number; predicted_detractor_rate: number | null;
};
export type GuardrailCheck = { rule_id: string; name: string; status: 'ok' | 'approval' | 'exempt' | 'exception'; detail: string };
export type Notification = { pnr: string; names: string; channel: string; language: string; text: string; personalized: boolean };
export type Plan = {
  plan_id: string; flight_id: string; flight_number: string; generated_at: string; drafted_by: string; assignments: Assignment[];
  metrics: PlanMetrics; autoprotect: PlanMetrics; guardrails: GuardrailCheck[]; requires_approval: boolean; approval_reasons: string[];
  released_seats: Array<{ option_id: string; label: string; seats: number; why: string }>;
  policy_guidance: { question: string; answer: string; sources: string[] } | null; summary: string; notifications: Notification[]; model: string;
};
export type AuditEntry = { at: string; by: string; action: string; notes?: string };
export type FlightDetail = {
  id: string; flightNumber: string; origin: string; destination: string; destinationCity: string | null; schedDep: string; schedArr: string;
  aircraft: string | null; seats: number | null; cancelReason: string | null; euUk261: string | null; status: FlightStatus; plan: Plan | null;
  planUpdatedAt: string | null; approvalNote: string | null; approvedBy: string | null; committedAt: string | null; auditTrail: AuditEntry[];
  passengers: Passenger[]; options: OptionRow[]; hotels: HotelRow[];
};
export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
export type ApprovalRow = {
  id: string; flight_number: string; destination: string; destination_city: string | null; status: FlightStatus; plan_updated_at: string;
  eu_uk_261: string | null; metrics: PlanMetrics; autoprotect: PlanMetrics; approval_reasons: string[]; summary: string; drafted_by: string;
  approved_by: string | null; committed_at: string | null; approval_note: string | null;
};
export type ActivityRow = { flight_id: string; flight_number: string; destination: string; at: string; by: string; action: string; notes: string | null };

const get = async <T,>(url: string, label: string): Promise<T> => (await okOrThrow(await fetch(url), label)).json();
const post = async <T,>(url: string, body: unknown, label: string): Promise<T> =>
  (await okOrThrow(await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }), label)).json();

export const fetchFlights = () => get<FlightRow[]>('/api/flights', 'flights');
export const fetchSummary = () => get<EventSummary>('/api/event/summary', 'summary');
export const fetchFlight = (id: string) => get<FlightDetail>(`/api/flights/${encodeURIComponent(id)}`, 'flight');
export const fetchApprovals = () => get<ApprovalRow[]>('/api/approvals', 'approvals');
export const fetchActivity = (limit = 10) => get<ActivityRow[]>(`/api/activity/recent?limit=${limit}`, 'activity');
export const submitPlan = (id: string, note?: string) =>
  post<{ status: FlightStatus; deltaWriteBack?: string; flight?: FlightDetail }>(`/api/flights/${encodeURIComponent(id)}/submit`, { note }, 'submit');
export const approvePlan = (id: string, note?: string) =>
  post<{ status: FlightStatus; deltaWriteBack?: string; flight?: FlightDetail }>(`/api/flights/${encodeURIComponent(id)}/approve`, { note }, 'approve');
export const sendBackPlan = (id: string, note?: string) =>
  post<{ status: FlightStatus }>(`/api/flights/${encodeURIComponent(id)}/send-back`, { note }, 'send-back');

/** POST /plan and parse the SSE stream (event: step | result | error). */
export async function runPlan(
  id: string,
  on: { step: (e: StepEvent) => void; result: (p: Plan) => void; error: (m: string) => void },
): Promise<void> {
  const resp = await fetch(`/api/flights/${encodeURIComponent(id)}/plan`, { method: 'POST' });
  if (!resp.ok || !resp.body) {
    on.error(`HTTP ${resp.status}`);
    return;
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (!ev || !data) continue;
      const parsed = JSON.parse(data);
      if (ev === 'step') on.step(parsed);
      else if (ev === 'result') on.result(parsed.plan);
      else if (ev === 'error') on.error(parsed.message);
    }
  }
}

export const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
export const pct = (n: number | null | undefined, d = 0) => (n == null ? '—' : `${(Number(n) * 100).toFixed(d)}%`);
/** "2026-02-13T14:20" → "14:20" (same day) or "Sat 07:05". */
export function clock(iso: string | null | undefined, refDay = '2026-02-13') {
  if (!iso) return '—';
  const t = iso.slice(11, 16);
  if (iso.slice(0, 10) === refDay) return t;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${d} ${t}`;
}
export const SSR_LABEL: Record<string, string> = {
  UMNR: 'Unaccompanied minor', WCHR: 'Wheelchair', WCHS: 'Wheelchair (stairs)', WCHC: 'Wheelchair (immobile)', BLND: 'Blind / low vision',
  DEAF: 'Deaf / HoH', MEDA: 'Medical', INFT: 'Lap infant', PETC: 'Pet in cabin',
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  P1: 'Special assistance', P2: 'Onward long-haul', P3: 'Urgent life event', P4: 'Top tier / premium', P5: 'Away from home', P6: 'Local resident',
};
export const STATUS_LABEL: Record<FlightStatus, string> = {
  unplanned: 'AutoProtect only', plan_drafted: 'Plan drafted', awaiting_approval: 'Awaiting Duty Manager', committed: 'Committed',
};

import { eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import { flights, guardrails, hotels, options, passengers, type AuditEntry, type ReaccomPlan } from '../schema.js';
import type { Flight, Guardrails, Hotel, Opt, Pax } from '../../services/reaccom.js';

/**
 * IROPS desk queries over the Lakebase mirror of Winter Storm Harlan.
 * "current" outcome = the desk's committed rebooking if any, else AutoProtect's hold.
 */
const SSR = `'UMNR|WCHR|WCHS|WCHC|BLND|DEAF|MEDA|INFT'`;

export async function listFlights(db: AppDb) {
  const r = await db.execute(sql.raw(`
    SELECT f.id, f.flight_number, f.origin, f.destination, f.destination_city, f.sched_dep, f.aircraft, f.eu_uk_261, f.status,
           f.plan_updated_at, f.committed_at,
           COUNT(p.id)::int AS pax,
           COUNT(*) FILTER (WHERE p.ssr ~ ${SSR})::int AS special_assistance,
           COUNT(*) FILTER (WHERE p.ssr LIKE '%UMNR%')::int AS umnr,
           COUNT(*) FILTER (WHERE p.onward_long_haul)::int AS onward,
           COUNT(*) FILTER (WHERE p.escalated)::int AS escalated,
           COUNT(*) FILTER (WHERE p.tier IN ('Platinum','Diamond'))::int AS top_tier,
           COUNT(*) FILTER (WHERE p.ap_same_day)::int AS ap_same_day,
           COUNT(*) FILTER (WHERE NOT p.ap_same_day AND p.ssr ~ ${SSR})::int AS ap_ssr_overnight,
           COUNT(*) FILTER (WHERE p.ap_misconnect)::int AS ap_misconnects,
           COALESCE((f.plan->'metrics'->>'same_day')::int, NULL) AS plan_same_day,
           (f.plan->>'requires_approval')::boolean AS requires_approval,
           (f.plan->'metrics'->>'partner_spend')::float AS plan_partner_spend
    FROM app.flights f LEFT JOIN app.passengers p ON p.flight_id = f.id
    GROUP BY f.id
    ORDER BY (COUNT(*) FILTER (WHERE NOT p.ap_same_day AND p.ssr ~ ${SSR}) + COUNT(*) FILTER (WHERE p.ap_misconnect)) DESC, COUNT(p.id) DESC`));
  return r.rows;
}

export async function eventSummary(db: AppDb) {
  const r = await db.execute(sql.raw(`
    SELECT COUNT(DISTINCT p.flight_id)::int AS flights_cancelled,
           COUNT(*)::int AS pax,
           COUNT(*) FILTER (WHERE p.ap_same_day)::int AS ap_same_day,
           COUNT(*) FILTER (WHERE p.ap_nights >= 2)::int AS ap_day_plus_2,
           COUNT(*) FILTER (WHERE p.ssr ~ ${SSR})::int AS special_assistance,
           COUNT(*) FILTER (WHERE NOT p.ap_same_day AND p.ssr ~ ${SSR})::int AS ap_ssr_overnight,
           COUNT(*) FILTER (WHERE p.ssr LIKE '%UMNR%')::int AS umnr,
           COUNT(*) FILTER (WHERE NOT p.ap_same_day AND p.ssr LIKE '%UMNR%')::int AS ap_umnr_overnight,
           COUNT(*) FILTER (WHERE p.onward_long_haul)::int AS onward,
           COUNT(*) FILTER (WHERE p.ap_misconnect)::int AS ap_misconnects,
           COUNT(*) FILTER (WHERE p.escalated)::int AS escalated,
           COUNT(DISTINCT p.pnr) FILTER (WHERE p.ap_split)::int AS ap_split_bookings,
           COUNT(*) FILTER (WHERE p.desk_committed_at IS NOT NULL)::int AS desk_committed_pax,
           COUNT(*) FILTER (WHERE p.desk_committed_at IS NOT NULL AND o.same_day)::int AS desk_same_day,
           COUNT(*) FILTER (WHERE (p.desk_committed_at IS NOT NULL AND o.same_day) OR (p.desk_committed_at IS NULL AND p.ap_same_day))::int AS current_same_day
    FROM app.passengers p LEFT JOIN app.options o ON o.id = p.desk_option_id`));
  const f = await db.execute(sql.raw(`
    SELECT COUNT(*) FILTER (WHERE status = 'committed')::int AS committed,
           COUNT(*) FILTER (WHERE status = 'awaiting_approval')::int AS awaiting_approval,
           COUNT(*) FILTER (WHERE status = 'plan_drafted')::int AS drafted
    FROM app.flights`));
  const h = await db.execute(sql.raw(`SELECT SUM(rooms_total)::int AS rooms_total, SUM(rooms_remaining)::int AS rooms_remaining FROM app.hotels WHERE airport = 'ORD'`));
  return { ...(r.rows[0] as Record<string, number>), ...(f.rows[0] as Record<string, number>), ...(h.rows[0] as Record<string, number>) };
}

export async function getFlight(db: AppDb, id: string) {
  const [f] = await db.select().from(flights).where(eq(flights.id, id));
  if (!f) return null;
  const pax = await db.select().from(passengers).where(eq(passengers.flightId, id)).orderBy(passengers.pnr);
  const opts = await db.select().from(options).where(eq(options.flightId, id)).orderBy(options.rank);
  const htl = await db.select().from(hotels).where(eq(hotels.airport, f.origin));
  return { ...f, passengers: pax, options: opts, hotels: htl };
}

export async function findFlight(db: AppDb, key: string) {
  const k = key.replace(/\s+/g, '').toUpperCase();
  const r = await db.execute(sql`SELECT id FROM app.flights WHERE UPPER(REPLACE(flight_number, ' ', '')) = ${k} OR UPPER(id) = ${k} LIMIT 1`);
  const id = (r.rows[0] as { id?: string } | undefined)?.id;
  return id ? getFlight(db, id) : null;
}

export async function loadGuardrails(db: AppDb): Promise<Guardrails> {
  const rows = await db.select().from(guardrails);
  return Object.fromEntries(rows.map((r) => [r.id, r.value]));
}

export function toEngine(f: NonNullable<Awaited<ReturnType<typeof getFlight>>>): { flight: Flight; pax: Pax[]; opts: Opt[]; hotels: Hotel[] } {
  return {
    flight: { id: f.id, flightNumber: f.flightNumber, origin: f.origin, destination: f.destination, destinationCity: f.destinationCity,
      schedDep: f.schedDep, schedArr: f.schedArr, cancelReason: f.cancelReason, euUk261: f.euUk261, seats: f.seats },
    pax: f.passengers.map((p) => ({ ...p, ssr: p.ssr ?? '' })) as Pax[],
    opts: f.options.map((o) => ({ ...o })) as Opt[],
    hotels: f.hotels.map((h) => ({ id: h.id, airport: h.airport, name: h.name, roomsRemaining: h.roomsRemaining, accessibleRooms: h.accessibleRooms, rate: h.rate })),
  };
}

function audit(by: string, action: AuditEntry['action'], notes?: string): AuditEntry {
  return { at: new Date().toISOString(), by, action, notes };
}

export async function savePlan(db: AppDb, id: string, plan: ReaccomPlan, by: string) {
  const e = audit('IROPS Copilot', 'plan_drafted', `${plan.metrics.same_day}/${plan.metrics.pax} same day (AutoProtect ${plan.autoprotect.same_day}) · requested by ${by}`);
  await db.update(flights).set({
    plan, planUpdatedAt: new Date(), status: 'plan_drafted', approvalNote: null, approvedBy: null, updatedAt: new Date(),
    auditTrail: sql`${flights.auditTrail} || ${JSON.stringify([e])}::jsonb`,
  }).where(eq(flights.id, id));
}

export async function setStatus(db: AppDb, id: string, status: 'plan_drafted' | 'awaiting_approval', by: string, action: AuditEntry['action'], note?: string) {
  await db.update(flights).set({
    status, approvalNote: note ?? null, updatedAt: new Date(),
    auditTrail: sql`${flights.auditTrail} || ${JSON.stringify([audit(by, action, note)])}::jsonb`,
  }).where(eq(flights.id, id));
}

/** Commit: write the desk's assignments to the passengers, decrement seats + rooms, mark the flight committed. */
export async function commitPlan(db: AppDb, id: string, by: string, note: string | null) {
  const [f] = await db.select().from(flights).where(eq(flights.id, id));
  if (!f?.plan) return null;
  const plan = f.plan;
  const seatUse: Record<string, number> = {};
  const roomUse: Record<string, number> = {};
  const roomPnr = new Set<string>();
  for (const a of plan.assignments) {
    seatUse[a.option_id] = (seatUse[a.option_id] ?? 0) + 1;
    if (a.hotel_id && !roomPnr.has(a.pnr)) {
      roomPnr.add(a.pnr);
      const n = plan.assignments.filter((x) => x.pnr === a.pnr).length;
      roomUse[a.hotel_id] = (roomUse[a.hotel_id] ?? 0) + Math.ceil(n / 3);
    }
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const a of plan.assignments) {
      await tx.update(passengers).set({ deskOptionId: a.option_id, deskLabel: a.label, deskHotelId: a.hotel_id, deskCommittedAt: now })
        .where(eq(passengers.id, a.pax_id));
    }
    for (const [opt, n] of Object.entries(seatUse)) {
      await tx.update(options).set({ seatsRemaining: sql`GREATEST(0, ${options.seatsRemaining} - ${n})` }).where(eq(options.id, opt));
    }
    for (const [h, n] of Object.entries(roomUse)) {
      await tx.update(hotels).set({ roomsRemaining: sql`GREATEST(0, ${hotels.roomsRemaining} - ${n})` }).where(eq(hotels.id, h));
    }
    await tx.update(flights).set({
      status: 'committed', approvedBy: by, approvalNote: note, committedAt: now, updatedAt: now,
      auditTrail: sql`${flights.auditTrail} || ${JSON.stringify([
        ...(plan.requires_approval ? [audit(by, 'approved', note ?? undefined)] : []),
        audit(by, 'committed', `${plan.assignments.length} rebookings ticketed · ${plan.metrics.hotel_rooms} hotel rooms · notifications queued`),
      ])}::jsonb`,
    }).where(eq(flights.id, id));
  });
  return getFlight(db, id);
}

export async function approvalQueue(db: AppDb) {
  const r = await db.execute(sql`
    SELECT id, flight_number, destination, destination_city, status, plan_updated_at, eu_uk_261,
           plan->'metrics' AS metrics, plan->'autoprotect' AS autoprotect, plan->'approval_reasons' AS approval_reasons,
           plan->>'summary' AS summary, plan->>'drafted_by' AS drafted_by, approved_by, committed_at, approval_note
    FROM app.flights WHERE status IN ('awaiting_approval', 'committed') ORDER BY (status = 'committed'), plan_updated_at DESC`);
  return r.rows;
}

export async function recentActivity(db: AppDb, limit: number) {
  const r = await db.execute(sql`
    SELECT f.id AS flight_id, f.flight_number, f.destination, e->>'at' AS at, e->>'by' AS by, e->>'action' AS action, e->>'notes' AS notes
    FROM app.flights f, jsonb_array_elements(f.audit_trail) e
    ORDER BY (e->>'at') DESC LIMIT ${limit}`);
  return r.rows;
}

/** For the chat agent: the priority passengers on a flight with needs, AutoProtect outcome and message. */
export async function priorityPassengers(db: AppDb, flightId: string, limit: number) {
  const r = await db.execute(sql.raw(`
    SELECT p.pnr, p.first_name || ' ' || p.last_name AS name, p.age, p.tier, p.cabin, p.ssr, p.onward_flight, p.onward_dep,
           p.origin_type, p.language, p.ap_label AS autoprotect_flight, p.ap_nights AS autoprotect_nights, p.ap_misconnect,
           p.message_summary, p.message_urgency, p.escalated, ROUND((p.p_next_day - p.p_same_day)::numeric, 2) AS overnight_harm
    FROM app.passengers p
    WHERE p.flight_id = '${flightId.replace(/'/g, "''")}'
      AND (p.ssr ~ ${SSR} OR p.onward_long_haul OR p.escalated OR p.tier IN ('Platinum','Diamond'))
    ORDER BY (p.ssr ~ ${SSR}) DESC, p.onward_long_haul DESC, p.escalated DESC, p.tier DESC
    LIMIT ${Math.max(1, Math.min(40, limit))}`));
  return r.rows;
}

export async function paxByIds(db: AppDb, ids: string[]) {
  return ids.length ? db.select().from(passengers).where(inArray(passengers.id, ids)) : [];
}

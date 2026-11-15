import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { flights, guardrails, hotels, options, passengers } from './schema.js';

/**
 * One-shot Delta → Lakebase sync of the Winter Storm Harlan disruption.
 *
 * Delta (<catalog>.<schema>) holds the cancelled flights, the protected alternate
 * options, every disrupted passenger (+ what AutoProtect held for them, the ML
 * detractor-risk scores and the AI-Functions reading of their latest message),
 * the hotel blocks and the guardrails. The desk works on this OLTP copy; seats +
 * rooms decrement as plans are committed. Idempotent: skips when app.flights has
 * rows, unless `forceIfAnyEmpty` (the "Reset demo" button).
 */

export type DataConfig = { catalog: string; schema: string };

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 'true';
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** Delta TIMESTAMP_NTZ comes back as "2026-02-13T09:55:00.000" or "2026-02-13 09:55:00" — normalise to "YYYY-MM-DDTHH:MM". */
const ts = (v: unknown): string | null => (v == null ? null : String(v).replace(' ', 'T').slice(0, 16));

export async function syncFromDelta(db: AppDb, cfg: DataConfig, opts: { forceIfAnyEmpty?: boolean } = {}): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.flights`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }
  console.log('[sync] Starting Delta → Lakebase sync of Winter Storm Harlan…');
  const t0 = Date.now();
  const s = `${cfg.catalog}.${cfg.schema}`;
  const [fRows, oRows, pRows, hRows, gRows] = await Promise.all([
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT f.flight_id, f.flight_number, f.origin, f.destination, a.city AS destination_city,
             CAST(f.sched_dep_local AS STRING) dep, CAST(f.sched_arr_local AS STRING) arr, f.aircraft_type, f.seats,
             f.cancel_reason, f.eu_uk_261
      FROM ${s}.flights f JOIN ${s}.airports a ON a.airport_code = f.destination WHERE f.status = 'CANCELLED'`),
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT option_id, disrupted_flight_id, option_rank, option_type, carrier_code, flight_label,
             CAST(depart_local AS STRING) dep, CAST(arrive_local AS STRING) arr, arrival_airport, seats_protected,
             cost_per_seat_usd, is_partner, same_day, nearby_airport, accepts_umnr, arrival_delay_hours
      FROM ${s}.alternate_options`),
    execSql<Record<string, unknown>>(warehouseId, `
      SELECT p.*, CAST(p.onward_dep_local AS STRING) onward_dep, r.option_id ap_option_id, r.new_flight_label ap_label,
             CAST(r.arrive_local AS STRING) ap_arrive, r.same_day ap_same_day, r.nights ap_nights, r.misconnect ap_misconnect,
             r.party_split ap_split, k.p_same_day, k.p_next_day, k.p_autoprotect,
             mi.message_text, mi.message_english, mi.intent, mi.urgency, mi.sentiment, mi.summary, mi.escalate
      FROM ${s}.passengers p
      JOIN ${s}.autoprotect_rebookings r ON r.pax_id = p.pax_id
      LEFT JOIN ${s}.pax_detractor_risk k ON k.pax_id = p.pax_id
      LEFT JOIN (SELECT * FROM ${s}.message_insights
                 QUALIFY ROW_NUMBER() OVER (PARTITION BY pax_id ORDER BY escalate DESC, received_ts DESC) = 1) mi
             ON mi.pax_id = p.pax_id`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${s}.hotel_blocks`),
    execSql<Record<string, unknown>>(warehouseId, `SELECT * FROM ${s}.guardrails`),
  ]);
  console.log(`[sync] fetched ${fRows.length} flights, ${oRows.length} options, ${pRows.length} passengers in ${Date.now() - t0}ms`);

  await db.insert(flights).values(fRows.map((r) => ({
    id: String(r.flight_id), flightNumber: String(r.flight_number), origin: String(r.origin), destination: String(r.destination),
    destinationCity: str(r.destination_city), schedDep: ts(r.dep)!, schedArr: ts(r.arr)!, aircraft: str(r.aircraft_type),
    seats: num(r.seats), cancelReason: str(r.cancel_reason), euUk261: str(r.eu_uk_261),
  }))).onConflictDoNothing();
  await chunkInsert(oRows, 500, (chunk) => db.insert(options).values(chunk.map((r) => ({
    id: String(r.option_id), flightId: String(r.disrupted_flight_id), rank: num(r.option_rank) ?? 0, optionType: String(r.option_type),
    carrier: String(r.carrier_code), label: String(r.flight_label), depart: ts(r.dep)!, arrive: ts(r.arr)!,
    arrivalAirport: String(r.arrival_airport), seatsProtected: num(r.seats_protected) ?? 0, seatsRemaining: num(r.seats_protected) ?? 0,
    costPerSeat: num(r.cost_per_seat_usd) ?? 0, isPartner: bool(r.is_partner), sameDay: bool(r.same_day),
    nearbyAirport: bool(r.nearby_airport), acceptsUmnr: bool(r.accepts_umnr), delayHours: num(r.arrival_delay_hours) ?? 0,
  }))).onConflictDoNothing());
  await chunkInsert(pRows, 500, (chunk) => db.insert(passengers).values(chunk.map((r) => ({
    id: String(r.pax_id), pnr: String(r.pnr), flightId: String(r.disrupted_flight_id), firstName: String(r.first_name),
    lastName: String(r.last_name), age: num(r.age), tier: String(r.loyalty_tier), cabin: str(r.cabin), fareBrand: str(r.fare_brand),
    originType: str(r.origin_type), awayFromHome: bool(r.away_from_home), homeCity: str(r.home_city),
    finalDestination: str(r.final_destination), onwardFlight: str(r.onward_flight), onwardDep: ts(r.onward_dep),
    onwardLongHaul: bool(r.onward_long_haul), ssr: str(r.ssr_codes) ?? '', partySize: num(r.party_size) ?? 1,
    language: str(r.preferred_language), channel: str(r.contact_channel), euUk261: str(r.eu_uk_261),
    apOptionId: str(r.ap_option_id), apLabel: str(r.ap_label), apArrive: ts(r.ap_arrive), apSameDay: bool(r.ap_same_day),
    apNights: num(r.ap_nights) ?? 0, apMisconnect: bool(r.ap_misconnect), apSplit: bool(r.ap_split),
    pSameDay: num(r.p_same_day), pNextDay: num(r.p_next_day), pAutoprotect: num(r.p_autoprotect),
    message: str(r.message_text), messageEnglish: str(r.message_english), messageIntent: str(r.intent),
    messageUrgency: str(r.urgency), messageSentiment: str(r.sentiment), messageSummary: str(r.summary), escalated: bool(r.escalate),
  }))).onConflictDoNothing());
  await db.insert(hotels).values(hRows.map((r) => ({
    id: String(r.hotel_id), airport: String(r.airport_code), name: String(r.hotel_name), roomsTotal: num(r.rooms_available) ?? 0,
    roomsRemaining: num(r.rooms_available) ?? 0, accessibleRooms: num(r.accessible_rooms) ?? 0, rate: num(r.rate_usd) ?? 0,
    shuttleMinutes: num(r.shuttle_minutes),
  }))).onConflictDoNothing();
  await db.insert(guardrails).values(gRows.map((r) => ({
    id: String(r.rule_id), name: String(r.rule_name), value: num(r.value) ?? 0, unit: str(r.unit), description: str(r.description),
  }))).onConflictDoNothing();
  console.log(`[sync] done in ${Date.now() - t0}ms`);
}

export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.passengers, app.options, app.flights, app.hotels, app.guardrails RESTART IDENTITY CASCADE`);
  });
}

export async function execSql<T>(
  warehouseId: string,
  statement: string,
): Promise<T[]> {
  const { client } = getExecutionContext();
  type StmtResp = {
    statement_id: string;
    status: { state: string; error?: { message: string } };
    manifest?: {
      schema: { columns: Array<{ name: string }> };
      chunks?: Array<{ chunk_index: number; row_count: number }>;
    };
    result?: {
      chunk_index: number;
      row_count: number;
      data_array?: Array<Array<unknown>>;
      next_chunk_index?: number;
    };
  };

  const initial = (await client.apiClient.request({
    method: 'POST',
    path: '/api/2.0/sql/statements',
    payload: {
      statement,
      warehouse_id: warehouseId,
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    },
    headers: new Headers(),
    raw: false,
    query: {},
  })) as StmtResp;

  // Cap total polling at 10 minutes. The warehouse can take a couple of
  // minutes to spin from idle + scan, but a state stuck in RUNNING beyond
  // 10 min is broken — fail loud instead of silently blocking boot forever.
  const POLL_DEADLINE_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  let cur = initial;
  while (
    cur.status.state !== 'SUCCEEDED' &&
    cur.status.state !== 'FAILED' &&
    cur.status.state !== 'CANCELED'
  ) {
    if (Date.now() - startedAt > POLL_DEADLINE_MS) {
      throw new Error(
        `[sync] SQL still ${cur.status.state} after 10 minutes — aborting (statement_id=${cur.statement_id})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp;
  }
  if (cur.status.state !== 'SUCCEEDED') {
    throw new Error(
      `[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`,
    );
  }

  const cols = cur.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows: T[] = [];
  let chunk = cur.result;
  while (chunk) {
    for (const row of chunk.data_array ?? []) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      rows.push(obj as T);
    }
    if (chunk.next_chunk_index === undefined || chunk.next_chunk_index === null) break;
    chunk = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp['result'];
  }
  return rows;
}

async function chunkInsert<T>(
  rows: T[],
  size: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}

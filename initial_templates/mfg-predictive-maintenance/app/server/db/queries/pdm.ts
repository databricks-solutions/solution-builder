import { sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import type { AuditEntry, WorkOrderPart } from '../schema.js';

/**
 * Domain queries for the TechRobotics control room (Lakebase mirror).
 * Read side: fleet, asset detail, parts, windows, work orders, activity.
 * Write side: bookWorkOrder (transactional: work order + part reservations +
 * window booking + asset status + audit trail) and setWorkOrderStatus.
 */

type Row = Record<string, unknown>;
const rows = (r: { rows: unknown[] }) => r.rows as Row[];
const LABOR_RATE_USD = 60;

export async function listFleet(db: AppDb, f: { line?: string; tier?: string } = {}) {
  return rows(await db.execute(sql`
    SELECT id, name, asset_type, manufacturer, model, line, cell, criticality, is_bottleneck,
           downtime_cost_per_hour, risk_score, risk_tier, failure_prob_7d, predicted_failure_mode,
           est_days_to_failure, downtime_cost_at_risk_usd, top_driver_1, top_driver_2, vib_ratio,
           temp_delta_c, pressure_ratio, last_pm_at, last_pm_vendor, last_pm_lubricant,
           vibration_24h, temperature_24h, pressure_24h, status, open_work_order_id
    FROM app.assets
    WHERE (${f.line ?? null}::text IS NULL OR line = ${f.line ?? null})
      AND (${f.tier ?? null}::text IS NULL OR risk_tier = ${f.tier ?? null})
    ORDER BY risk_score DESC, downtime_cost_per_hour DESC`));
}

export async function fleetSummary(db: AppDb) {
  const [s] = rows(await db.execute(sql`
    SELECT count(*)::int AS assets,
           count(*) FILTER (WHERE risk_tier = 'Critical')::int AS critical,
           count(*) FILTER (WHERE risk_tier = 'High')::int AS high,
           count(*) FILTER (WHERE risk_tier = 'Watch')::int AS watch,
           count(*) FILTER (WHERE risk_tier = 'Healthy')::int AS healthy,
           coalesce(sum(downtime_cost_at_risk_usd) FILTER (WHERE status = 'monitoring'), 0)::float AS cost_at_risk_usd,
           count(*) FILTER (WHERE status = 'work_order_booked')::int AS protected_assets
    FROM app.assets`));
  const [w] = rows(await db.execute(sql`
    SELECT count(*)::int AS work_orders,
           coalesce(sum(unplanned_cost_avoided_usd), 0)::float AS cost_avoided_usd,
           coalesce(sum(net_savings_usd), 0)::float AS net_savings_usd
    FROM app.work_orders WHERE status <> 'cancelled'`));
  const byLine = rows(await db.execute(sql`
    SELECT line, count(*)::int AS assets, max(risk_score)::int AS max_risk,
           count(*) FILTER (WHERE risk_tier IN ('Critical','High'))::int AS at_risk
    FROM app.assets GROUP BY line ORDER BY line`));
  return { ...s, ...w, by_line: byLine };
}

export async function getAsset(db: AppDb, id: string) {
  const [asset] = rows(await db.execute(sql`SELECT * FROM app.assets WHERE id = ${id}`));
  if (!asset) return null;
  const trend = rows(await db.execute(sql`
    SELECT day::text AS day, vibration, vibration_baseline, temperature, temperature_baseline, pressure
    FROM app.asset_trend WHERE asset_id = ${id} ORDER BY day`));
  const history = rows(await db.execute(sql`
    SELECT id, work_type, scheduled_at, vendor, technician, description, lubricant_used, parts_used, notes, failure_id
    FROM app.maintenance_history WHERE asset_id = ${id} ORDER BY scheduled_at DESC LIMIT 12`));
  const fails = rows(await db.execute(sql`
    SELECT id, failure_at, failure_mode, component, downtime_hours, total_cost_usd, root_cause
    FROM app.failures WHERE asset_id = ${id} ORDER BY failure_at DESC`));
  const workOrders = rows(await db.execute(sql`
    SELECT * FROM app.work_orders WHERE asset_id = ${id} ORDER BY created_at DESC`));
  return { asset, trend, history, failures: fails, work_orders: workOrders };
}

/** Assets that received a PM with a given lubricant / vendor in the last N days — the
 *  "is this one machine or one maintenance event?" query. */
export async function recentPmBatch(db: AppDb, f: { lubricant_contains?: string | null; vendor?: string | null; days: number }) {
  return rows(await db.execute(sql`
    SELECT h.asset_id, a.name, a.model, a.risk_score, a.risk_tier, h.id AS work_order_id,
           h.scheduled_at, h.vendor, h.lubricant_used, h.notes
    FROM app.maintenance_history h JOIN app.assets a ON a.id = h.asset_id
    WHERE h.work_type = 'Preventive'
      AND h.scheduled_at >= now() - make_interval(days => ${f.days})
      AND (${f.lubricant_contains ?? null}::text IS NULL OR h.lubricant_used ILIKE '%' || ${f.lubricant_contains ?? null} || '%')
      AND (${f.vendor ?? null}::text IS NULL OR h.vendor ILIKE '%' || ${f.vendor ?? null} || '%')
    ORDER BY a.risk_score DESC`));
}

export async function findParts(db: AppDb, f: { model?: string | null; query?: string | null }) {
  return rows(await db.execute(sql`
    SELECT part_number, description, compatible_models, plant_on_hand, reserved_qty,
           (plant_on_hand - reserved_qty) AS available_at_plant, regional_dc_qty, unit_cost_usd,
           lead_time_days, part_class
    FROM app.spare_parts
    WHERE (${f.model ?? null}::text IS NULL OR compatible_models ILIKE '%' || ${f.model ?? null} || '%' OR compatible_models = 'All')
      AND (${f.query ?? null}::text IS NULL OR description ILIKE '%' || ${f.query ?? null} || '%' OR part_number ILIKE '%' || ${f.query ?? null} || '%')
    ORDER BY part_class, part_number`));
}

export async function listParts(db: AppDb) {
  return findParts(db, {});
}

export async function listWindows(db: AppDb, line?: string | null) {
  return rows(await db.execute(sql`
    SELECT id, line, start_at, end_at, capacity_hours, booked_hours,
           (capacity_hours - booked_hours) AS free_hours
    FROM app.maintenance_windows
    WHERE (${line ?? null}::text IS NULL OR line = ${line ?? null})
    ORDER BY start_at`));
}

export async function listWorkOrders(db: AppDb) {
  return rows(await db.execute(sql`
    SELECT w.*, a.name AS asset_name, a.line FROM app.work_orders w
    JOIN app.assets a ON a.id = w.asset_id ORDER BY w.unplanned_cost_avoided_usd DESC, w.created_at DESC`));
}

export type BookWorkOrderInput = {
  asset_id: string;
  priority: string;
  title: string;
  root_cause: string;
  tasks: string[];
  window_id: string;
  duration_hours: number;
  technicians: string;
  technician_count: number;
  parts: Array<{ part_number: string; qty: number }>;
  userEmail: string;
  source: 'agent' | 'manual';
};

export async function bookWorkOrder(db: AppDb, input: BookWorkOrderInput) {
  return db.transaction(async (tx) => {
    const [asset] = rows(await tx.execute(sql`SELECT * FROM app.assets WHERE id = ${input.asset_id} FOR UPDATE`));
    if (!asset) throw new Error(`Unknown asset ${input.asset_id}`);
    if (asset.open_work_order_id) {
      throw new Error(`Asset ${input.asset_id} already has open work order ${String(asset.open_work_order_id)}`);
    }
    const [win] = rows(await tx.execute(sql`SELECT * FROM app.maintenance_windows WHERE id = ${input.window_id} FOR UPDATE`));
    if (!win) throw new Error(`Unknown maintenance window ${input.window_id}`);
    if (win.line !== asset.line) throw new Error(`Window ${input.window_id} is for ${String(win.line)}, asset is on ${String(asset.line)}`);
    const free = Number(win.capacity_hours) - Number(win.booked_hours);
    if (input.duration_hours > free + 1e-6) {
      throw new Error(`Window ${input.window_id} has only ${free}h free (needs ${input.duration_hours}h)`);
    }

    const now = new Date().toISOString();
    const parts: WorkOrderPart[] = [];
    let partsCost = 0;
    for (const p of input.parts) {
      const [sp] = rows(await tx.execute(sql`SELECT * FROM app.spare_parts WHERE part_number = ${p.part_number} FOR UPDATE`));
      if (!sp) throw new Error(`Unknown part ${p.part_number}`);
      const avail = Number(sp.plant_on_hand) - Number(sp.reserved_qty);
      let source: WorkOrderPart['source'] = 'plant_crib';
      if (avail >= p.qty) {
        await tx.execute(sql`UPDATE app.spare_parts SET reserved_qty = reserved_qty + ${p.qty} WHERE part_number = ${p.part_number}`);
      } else if (Number(sp.regional_dc_qty) >= p.qty) {
        source = 'regional_dc_transfer';
        await tx.execute(sql`UPDATE app.spare_parts SET regional_dc_qty = regional_dc_qty - ${p.qty} WHERE part_number = ${p.part_number}`);
      } else {
        throw new Error(`Part ${p.part_number} unavailable: plant ${avail}, regional DC ${String(sp.regional_dc_qty)}, need ${p.qty}`);
      }
      const unit = Number(sp.unit_cost_usd);
      partsCost += unit * p.qty;
      parts.push({ part_number: p.part_number, description: String(sp.description), qty: p.qty, unit_cost_usd: unit, source });
    }
    const labor = input.duration_hours * Math.max(1, input.technician_count) * LABOR_RATE_USD;
    const prob = Number(asset.failure_prob_7d ?? 0);
    const unplanned = Number(asset.unplanned_failure_cost_usd ?? 0);
    const avoided = Math.round(prob * unplanned);
    const net = Math.round(avoided - partsCost - labor);
    const [{ n }] = rows(await tx.execute(sql`SELECT count(*)::int AS n FROM app.work_orders`)) as Array<{ n: number }>;
    const id = `WO-PDM-${String(31000 + Number(n) + 1)}`;
    const audit: AuditEntry[] = [
      { at: now, by: input.userEmail, action: 'work_order_booked', tool: input.source === 'agent' ? 'book_work_order' : 'ui',
        notes: `${input.priority} · ${input.title} · window ${input.window_id} · risk ${String(asset.risk_score)} at booking` },
      ...parts.map((p) => ({ at: now, by: input.userEmail, action: 'parts_reserved' as const, tool: 'book_work_order',
        notes: `${p.qty} × ${p.part_number} (${p.description}) — ${p.source === 'plant_crib' ? 'reserved at Greenville crib' : 'transfer from Charlotte DC (1 day)'}` })),
      { at: now, by: input.userEmail, action: 'window_reserved', tool: 'book_work_order',
        notes: `${input.duration_hours}h of ${String(win.line)} window ${input.window_id}` },
    ];
    await tx.execute(sql`
      INSERT INTO app.work_orders (id, asset_id, priority, title, tasks, window_id, scheduled_start, duration_hours,
        technicians, parts, parts_cost_usd, labor_cost_usd, unplanned_cost_avoided_usd, net_savings_usd,
        risk_score_at_booking, root_cause, status, created_by, source, ai_audit_trail)
      VALUES (${id}, ${input.asset_id}, ${input.priority}, ${input.title}, ${JSON.stringify(input.tasks)}::jsonb,
        ${input.window_id}, ${win.start_at as string}, ${input.duration_hours}, ${input.technicians},
        ${JSON.stringify(parts)}::jsonb, ${partsCost}, ${labor}, ${avoided}, ${net}, ${Number(asset.risk_score)},
        ${input.root_cause}, 'scheduled', ${input.userEmail}, ${input.source}, ${JSON.stringify(audit)}::jsonb)`);
    await tx.execute(sql`UPDATE app.maintenance_windows SET booked_hours = booked_hours + ${input.duration_hours} WHERE id = ${input.window_id}`);
    await tx.execute(sql`UPDATE app.assets SET status = 'work_order_booked', open_work_order_id = ${id} WHERE id = ${input.asset_id}`);
    return {
      work_order_id: id, asset_id: input.asset_id, window_id: input.window_id, scheduled_start: win.start_at,
      duration_hours: input.duration_hours, parts, parts_cost_usd: partsCost, labor_cost_usd: labor,
      failure_prob_7d: prob, unplanned_failure_cost_usd: unplanned, risk_weighted_cost_avoided_usd: avoided,
      net_savings_usd: net, window_free_hours_after: free - input.duration_hours,
    };
  });
}

export async function setWorkOrderStatus(db: AppDb, id: string, status: 'in_progress' | 'completed' | 'cancelled', userEmail: string) {
  return db.transaction(async (tx) => {
    const [wo] = rows(await tx.execute(sql`SELECT * FROM app.work_orders WHERE id = ${id} FOR UPDATE`));
    if (!wo) throw new Error(`Unknown work order ${id}`);
    const entry: AuditEntry = { at: new Date().toISOString(), by: userEmail, action: 'status_change', tool: 'ui', notes: `${String(wo.status)} → ${status}` };
    await tx.execute(sql`UPDATE app.work_orders SET status = ${status},
      ai_audit_trail = ai_audit_trail || ${JSON.stringify([entry])}::jsonb WHERE id = ${id}`);
    if (status === 'cancelled') {
      for (const p of (wo.parts as WorkOrderPart[]) ?? []) {
        if (p.source === 'plant_crib') {
          await tx.execute(sql`UPDATE app.spare_parts SET reserved_qty = greatest(reserved_qty - ${p.qty}, 0) WHERE part_number = ${p.part_number}`);
        } else {
          await tx.execute(sql`UPDATE app.spare_parts SET regional_dc_qty = regional_dc_qty + ${p.qty} WHERE part_number = ${p.part_number}`);
        }
      }
      await tx.execute(sql`UPDATE app.maintenance_windows SET booked_hours = greatest(booked_hours - ${Number(wo.duration_hours)}, 0) WHERE id = ${wo.window_id as string}`);
      await tx.execute(sql`UPDATE app.assets SET status = 'monitoring', open_work_order_id = NULL WHERE id = ${wo.asset_id as string}`);
    }
    return { id, status };
  });
}

export type ActivityEvent = {
  kind: 'audit';
  work_order_id: string;
  asset_id: string;
  at: string;
  by: string;
  action: string;
  notes: string | null;
  tool: string | null;
};

export async function recentActivity(db: AppDb, limit = 20): Promise<ActivityEvent[]> {
  const r = rows(await db.execute(sql`
    SELECT w.id AS work_order_id, w.asset_id, (a->>'at') AS at, (a->>'by') AS by_email,
           (a->>'action') AS action, (a->>'notes') AS notes, (a->>'tool') AS tool
    FROM app.work_orders w, jsonb_array_elements(w.ai_audit_trail) AS a
    ORDER BY at DESC NULLS LAST LIMIT ${limit}`));
  return r.map((x) => ({
    kind: 'audit', work_order_id: String(x.work_order_id), asset_id: String(x.asset_id), at: String(x.at),
    by: String(x.by_email ?? ''), action: String(x.action ?? ''), notes: (x.notes as string) ?? null, tool: (x.tool as string) ?? null,
  }));
}

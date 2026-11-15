"""
Planning layer: AI_FORECAST demand → BOM explosion → projected inventory → stock-out exposures,
plus inventory health (excess & obsolete), fill rate, supplier performance and a UC metric view.

Runs every statement on a SQL warehouse through the Statement Execution API (AI_FORECAST is a
warehouse feature), so it works the same from a job and from a laptop:

    python build_gold.py --catalog manufacturing --schema supply_planning_copilot --warehouse-id <id>

  demand_forecast             AI_FORECAST of weekly units per active SKU x plant, 13 weeks (W0..W12)
  gold_demand_weekly          last 26 weeks actual + 13 weeks forecast (for charts)
  component_requirements      forecast exploded through the BOM: component units needed per plant x week
  inventory_projection        component x plant x week: requirement, receipts (open POs at REVISED ETA),
                              projected balance, balance if POs had arrived as PROMISED, safety stock
  stockout_exposures          one row per component x plant that goes below safety stock or negative:
                              first stock-out week, peak units short, revenue at risk, delayed POs
  gold_inventory_health       component x plant: value, weeks of cover, days of supply, E&O category + value
  gold_fill_rate_weekly       weekly fill rate per SKU x plant (demand_history + product/plant names)
  gold_supplier_performance_monthly  received POs per supplier x month: on-time %, avg days late
  gold_open_purchase_orders   open/in-transit POs with supplier + component names and delay flags
  mv_supply_performance       metric view: fill rate, ordered/shipped units + value by week/plant/family/SKU
"""
from __future__ import annotations

import argparse
import time

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

HORIZON_WEEKS = 13


def runner(w: WorkspaceClient, warehouse_id: str):
    def run(stmt: str):
        r = w.statement_execution.execute_statement(statement=stmt, warehouse_id=warehouse_id, wait_timeout="50s")
        while r.status.state in (StatementState.PENDING, StatementState.RUNNING):
            time.sleep(2)
            r = w.statement_execution.get_statement(r.statement_id)
        if r.status.state != StatementState.SUCCEEDED:
            raise RuntimeError(f"{r.status.error.message if r.status.error else r.status.state}\n--- SQL ---\n{stmt[:1500]}")
        return r.result.data_array if r.result and r.result.data_array else []
    return run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="manufacturing")
    ap.add_argument("--schema", default="supply_planning_copilot")
    ap.add_argument("--warehouse-id", "--warehouse_id", dest="warehouse_id", required=True)
    ap.add_argument("--profile", default=None)
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    w = WorkspaceClient(profile=args.profile) if args.profile else WorkspaceClient()
    run = runner(w, args.warehouse_id)

    as_of = run(f"SELECT CAST(max(snapshot_date) AS STRING) FROM {s}.inventory_on_hand")[0][0]
    horizon_end = run(f"SELECT CAST(date_add(DATE'{as_of}', {7 * (HORIZON_WEEKS - 1)}) AS STRING)")[0][0]
    forecast_until = run(f"SELECT CAST(date_add(DATE'{as_of}', {7 * HORIZON_WEEKS}) AS STRING)")[0][0]  # AI_FORECAST horizon is exclusive
    print(f"as_of={as_of} horizon_end={horizon_end}")

    # ── 1. Demand forecast (AI_FORECAST) ──────────────────────────────────────
    run(f"""
      CREATE OR REPLACE TABLE {s}.demand_forecast
      COMMENT 'AI_FORECAST of weekly customer demand (units) per active SKU x plant for the next 13 weeks (week_start = Monday; week_index 0 = current week).'
      AS WITH hist AS (
        SELECT d.week_start AS ds, concat(d.sku, '|', d.plant_id) AS series, CAST(d.units_ordered AS DOUBLE) AS y
        FROM {s}.demand_history d JOIN {s}.products p ON p.sku = d.sku
        WHERE p.lifecycle_status = 'Active'
      ),
      fc AS (
        SELECT * FROM AI_FORECAST(TABLE(hist), horizon => '{forecast_until}', time_col => 'ds', value_col => 'y', group_col => 'series')
      )
      SELECT split(series, '[|]')[0] AS sku, split(series, '[|]')[1] AS plant_id, CAST(ds AS DATE) AS week_start,
             CAST(datediff(CAST(ds AS DATE), DATE'{as_of}') / 7 AS INT) AS week_index,
             CAST(greatest(0, round(y_forecast)) AS INT) AS forecast_units,
             CAST(greatest(0, round(y_lower)) AS INT) AS forecast_lower, CAST(greatest(0, round(y_upper)) AS INT) AS forecast_upper,
             'AI_FORECAST' AS forecast_method, current_timestamp() AS forecasted_at
      FROM fc WHERE CAST(ds AS DATE) BETWEEN DATE'{as_of}' AND DATE'{horizon_end}'
    """)

    run(f"""
      CREATE OR REPLACE TABLE {s}.gold_demand_weekly
      COMMENT 'Weekly demand per SKU x plant: last 26 weeks of actual orders + the 13-week AI_FORECAST (series = Actual | Forecast).'
      AS SELECT d.sku, p.product_name, p.product_family, d.plant_id, pl.plant_name, d.week_start, 'Actual' AS series,
                d.units_ordered AS units, CAST(NULL AS INT) AS units_lower, CAST(NULL AS INT) AS units_upper
         FROM {s}.demand_history d JOIN {s}.products p USING (sku) JOIN {s}.plants pl USING (plant_id)
         WHERE d.week_start >= date_sub(DATE'{as_of}', 182)
         UNION ALL
         SELECT f.sku, p.product_name, p.product_family, f.plant_id, pl.plant_name, f.week_start, 'Forecast',
                f.forecast_units, f.forecast_lower, f.forecast_upper
         FROM {s}.demand_forecast f JOIN {s}.products p USING (sku) JOIN {s}.plants pl USING (plant_id)
    """)

    # ── 2. BOM explosion ───────────────────────────────────────────────────────
    run(f"""
      CREATE OR REPLACE TABLE {s}.component_requirements
      COMMENT 'Forecast demand exploded through the bill of materials: component units required per plant x week, with the revenue those finished units carry.'
      AS SELECT f.plant_id, b.component_id, f.week_start, f.week_index,
                CAST(sum(f.forecast_units * b.qty_per) AS INT) AS required_units,
                round(sum(f.forecast_units * p.list_price), 2) AS finished_revenue,
                array_sort(collect_set(f.sku)) AS driving_skus
         FROM {s}.demand_forecast f JOIN {s}.bom b ON b.sku = f.sku JOIN {s}.products p ON p.sku = f.sku
         GROUP BY f.plant_id, b.component_id, f.week_start, f.week_index
    """)

    # ── 3. Projected inventory ─────────────────────────────────────────────────
    run(f"""
      CREATE OR REPLACE TABLE {s}.inventory_projection
      COMMENT 'Projected component inventory per plant x week for 13 weeks. projected_balance uses open POs at their REVISED ETA; balance_if_on_time uses the PROMISED date (what the plan looked like before the disruption). Negative = stock-out (units short, cumulative).'
      AS WITH weeks AS (
        SELECT explode(sequence(DATE'{as_of}', DATE'{horizon_end}', INTERVAL 7 DAYS)) AS week_start
      ),
      grid AS (
        SELECT i.plant_id, i.component_id, i.on_hand_units, i.safety_stock_units, w.week_start,
               CAST(datediff(w.week_start, DATE'{as_of}') / 7 AS INT) AS week_index
        FROM {s}.inventory_on_hand i CROSS JOIN weeks w
      ),
      rcv AS (
        SELECT plant_id, component_id, date_trunc('WEEK', revised_eta)::DATE AS week_start, sum(quantity) AS receipts,
               array_join(collect_list(po_number), ', ') AS receipt_pos
        FROM {s}.purchase_orders WHERE status IN ('OPEN', 'IN_TRANSIT') GROUP BY ALL
      ),
      rcv_orig AS (
        SELECT plant_id, component_id, date_trunc('WEEK', promised_date)::DATE AS week_start, sum(quantity) AS receipts_on_time
        FROM {s}.purchase_orders WHERE status IN ('OPEN', 'IN_TRANSIT') GROUP BY ALL
      ),
      j AS (
        SELECT g.*, coalesce(r.required_units, 0) AS required_units, coalesce(rc.receipts, 0) AS receipts, rc.receipt_pos,
               coalesce(ro.receipts_on_time, 0) AS receipts_on_time
        FROM grid g
        LEFT JOIN {s}.component_requirements r USING (plant_id, component_id, week_start)
        LEFT JOIN rcv rc USING (plant_id, component_id, week_start)
        LEFT JOIN rcv_orig ro USING (plant_id, component_id, week_start)
      )
      SELECT plant_id, component_id, week_start, week_index, on_hand_units, safety_stock_units, required_units, receipts, receipt_pos,
             CAST(on_hand_units + sum(receipts - required_units) OVER (PARTITION BY plant_id, component_id ORDER BY week_start) AS INT) AS projected_balance,
             CAST(on_hand_units + sum(receipts_on_time - required_units) OVER (PARTITION BY plant_id, component_id ORDER BY week_start) AS INT) AS balance_if_on_time
      FROM j
    """)

    # ── 4. Stock-out exposures ─────────────────────────────────────────────────
    run(f"""
      CREATE OR REPLACE TABLE {s}.stockout_exposures
      COMMENT 'Components projected below safety stock (BELOW_SAFETY_STOCK) or negative (STOCKOUT) in the 13-week horizon, per plant. revenue_at_risk = peak units short x revenue carried per component unit by the SKUs that consume it. Ranked by revenue at risk.'
      AS WITH p AS (
        SELECT plant_id, component_id,
               min(projected_balance) AS min_balance, min(balance_if_on_time) AS min_balance_if_on_time,
               min(CASE WHEN projected_balance < 0 THEN week_start END) AS first_stockout_week,
               min(CASE WHEN projected_balance < safety_stock_units THEN week_start END) AS first_below_ss_week,
               count_if(projected_balance < 0) AS weeks_short, count_if(projected_balance < safety_stock_units) AS weeks_below_ss,
               max(on_hand_units) AS on_hand_units, max(safety_stock_units) AS safety_stock_units,
               avg(CASE WHEN week_index < 4 THEN required_units END) AS avg_weekly_req_4w
        FROM {s}.inventory_projection GROUP BY ALL
      ),
      rev AS (
        SELECT plant_id, component_id, sum(finished_revenue) / nullif(sum(required_units), 0) AS revenue_per_unit,
               array_sort(array_distinct(flatten(collect_list(driving_skus)))) AS affected_skus
        FROM {s}.component_requirements GROUP BY ALL
      ),
      po AS (
        SELECT plant_id, component_id, count_if(delay_days > 0) AS delayed_po_count, max(delay_days) AS max_delay_days,
               sum(CASE WHEN delay_days > 0 THEN quantity ELSE 0 END) AS delayed_units,
               coalesce(max_by(CASE WHEN delay_days > 0 THEN delay_reason END, delay_days), max(delay_reason)) AS delay_reason,
               count_if(delay_reason ILIKE '%allocation%') AS allocation_cut_pos
        FROM {s}.purchase_orders WHERE status IN ('OPEN', 'IN_TRANSIT') GROUP BY ALL
      ),
      src AS (
        SELECT sr.plant_id, sr.component_id, su.supplier_name AS primary_supplier
        FROM {s}.sourcing sr JOIN {s}.suppliers su USING (supplier_id) WHERE sr.role = 'primary'
      )
      SELECT concat('EXP-', p.component_id, '-', p.plant_id) AS exposure_id, p.plant_id, pl.plant_name, p.component_id, c.component_name,
             CASE WHEN p.min_balance < 0 THEN 'STOCKOUT' ELSE 'BELOW_SAFETY_STOCK' END AS exposure_type,
             p.first_stockout_week, p.first_below_ss_week,
             CAST(datediff(p.first_stockout_week, DATE'{as_of}') AS INT) AS days_to_stockout,
             p.weeks_short, p.weeks_below_ss, p.on_hand_units, p.safety_stock_units,
             round(p.on_hand_units / nullif(p.avg_weekly_req_4w / 7, 0), 1) AS days_of_supply_now,
             CAST(greatest(0, -p.min_balance) AS INT) AS peak_units_short,
             CAST(greatest(0, -p.min_balance_if_on_time) AS INT) AS peak_units_short_if_on_time,
             round(r.revenue_per_unit, 2) AS revenue_per_unit,
             round(greatest(0, -p.min_balance) * r.revenue_per_unit, 0) AS revenue_at_risk,
             r.affected_skus, src.primary_supplier,
             coalesce(po.delayed_po_count, 0) AS delayed_po_count, po.max_delay_days, po.delayed_units, po.delay_reason,
             CASE WHEN coalesce(po.allocation_cut_pos, 0) > 0 THEN 'Supplier allocation cut'
                  WHEN coalesce(po.delayed_po_count, 0) > 0 AND p.min_balance_if_on_time >= 0 THEN 'Inbound supply delay'
                  WHEN coalesce(po.delayed_po_count, 0) > 0 THEN 'Supply delay + demand above plan'
                  ELSE 'Demand above plan / reduced supply' END AS root_cause,
             DATE'{as_of}' AS as_of_date
      FROM p JOIN {s}.plants pl USING (plant_id) JOIN {s}.components c USING (component_id)
      LEFT JOIN rev r USING (plant_id, component_id) LEFT JOIN po USING (plant_id, component_id) LEFT JOIN src USING (plant_id, component_id)
      WHERE p.min_balance < p.safety_stock_units
    """)

    # ── 5. Inventory health / excess & obsolete ────────────────────────────────
    run(f"""
      CREATE OR REPLACE TABLE {s}.gold_inventory_health
      COMMENT 'Component inventory health per plant: value, forward weekly requirement (13-week forecast), weeks of cover, days of supply, and excess & obsolete (E&O). eo_category Obsolete = no forward requirement and no issue in 90+ days; Excess = more than 26 weeks of cover (excess units above 26 weeks).'
      AS WITH r AS (SELECT plant_id, component_id, sum(required_units) / {HORIZON_WEEKS} AS avg_weekly_req FROM {s}.component_requirements GROUP BY ALL)
      SELECT i.plant_id, pl.plant_name, i.component_id, c.component_name, c.category, c.abc_class, i.on_hand_units, i.unit_cost,
             i.inventory_value, i.safety_stock_units, round(coalesce(r.avg_weekly_req, 0), 1) AS avg_weekly_requirement,
             round(i.on_hand_units / nullif(r.avg_weekly_req, 0), 1) AS weeks_of_cover,
             round(i.on_hand_units / nullif(r.avg_weekly_req / 7, 0), 0) AS days_of_supply,
             datediff(i.snapshot_date, i.last_issue_date) AS days_since_last_issue,
             CASE WHEN coalesce(r.avg_weekly_req, 0) = 0 AND datediff(i.snapshot_date, i.last_issue_date) > 90 THEN 'Obsolete'
                  WHEN i.on_hand_units > 26 * r.avg_weekly_req THEN 'Excess'
                  WHEN i.on_hand_units < i.safety_stock_units THEN 'Below safety stock'
                  ELSE 'Healthy' END AS eo_category,
             CAST(CASE WHEN coalesce(r.avg_weekly_req, 0) = 0 THEN i.on_hand_units
                       WHEN i.on_hand_units > 26 * r.avg_weekly_req THEN i.on_hand_units - 26 * r.avg_weekly_req ELSE 0 END AS INT) AS eo_units,
             round(CASE WHEN coalesce(r.avg_weekly_req, 0) = 0 THEN i.on_hand_units
                        WHEN i.on_hand_units > 26 * r.avg_weekly_req THEN i.on_hand_units - 26 * r.avg_weekly_req ELSE 0 END * i.unit_cost, 2) AS eo_value,
             i.snapshot_date
      FROM {s}.inventory_on_hand i JOIN {s}.plants pl USING (plant_id) JOIN {s}.components c USING (component_id)
      LEFT JOIN r USING (plant_id, component_id)
    """)

    # ── 6. Fill rate, supplier performance, open POs ───────────────────────────
    run(f"""
      CREATE OR REPLACE TABLE {s}.gold_fill_rate_weekly
      COMMENT 'Weekly customer service per SKU x plant. fill_rate = units_shipped / units_ordered; line_fill_rate = order lines shipped complete / order lines.'
      AS SELECT d.week_start, d.plant_id, pl.plant_name, d.sku, p.product_name, p.product_family, p.lifecycle_status,
                d.units_ordered, d.units_shipped, d.units_ordered - d.units_shipped AS units_short,
                d.order_value, d.shipped_value, d.order_value - d.shipped_value AS revenue_unshipped,
                d.order_lines, d.lines_shipped_complete,
                round(d.units_shipped / nullif(d.units_ordered, 0), 4) AS fill_rate,
                round(d.lines_shipped_complete / nullif(d.order_lines, 0), 4) AS line_fill_rate
         FROM {s}.demand_history d JOIN {s}.products p USING (sku) JOIN {s}.plants pl USING (plant_id)
    """)
    run(f"""
      CREATE OR REPLACE TABLE {s}.gold_supplier_performance_monthly
      COMMENT 'Supplier delivery performance per month of receipt: received POs, on-time % (received on or before the promised date), average days late, average actual lead time.'
      AS SELECT po.supplier_id, su.supplier_name, su.country, date_trunc('MONTH', po.received_date)::DATE AS month,
                count(*) AS pos_received, count_if(po.delay_days <= 0) AS pos_on_time,
                round(100 * count_if(po.delay_days <= 0) / count(*), 1) AS on_time_pct,
                round(avg(greatest(po.delay_days, 0)), 1) AS avg_days_late,
                round(avg(datediff(po.received_date, po.order_date)), 1) AS avg_lead_time_days,
                sum(po.po_value) AS value_received
         FROM {s}.purchase_orders po JOIN {s}.suppliers su USING (supplier_id)
         WHERE po.status = 'RECEIVED' GROUP BY ALL
    """)
    run(f"""
      CREATE OR REPLACE TABLE {s}.gold_open_purchase_orders
      COMMENT 'Open and in-transit purchase orders with supplier/component/plant names. is_delayed = revised ETA later than promised.'
      AS SELECT po.po_number, po.supplier_id, su.supplier_name, po.component_id, c.component_name, po.plant_id, pl.plant_name,
                po.quantity, po.po_value, po.order_date, po.promised_date, po.revised_eta, po.delay_days, po.delay_days > 0 AS is_delayed,
                po.delay_reason, po.status, po.ship_mode, po.lane, po.vessel
         FROM {s}.purchase_orders po JOIN {s}.suppliers su USING (supplier_id) JOIN {s}.components c USING (component_id)
         JOIN {s}.plants pl USING (plant_id)
         WHERE po.status IN ('OPEN', 'IN_TRANSIT')
    """)

    # ── 7. Metric view ─────────────────────────────────────────────────────────
    run(f"""
      CREATE OR REPLACE VIEW {s}.mv_supply_performance
      WITH METRICS LANGUAGE YAML
      COMMENT 'Governed customer-service KPIs for S&OP: fill rate, ordered/shipped units and value by week, plant, product family and SKU.'
      AS $$
      version: 1.1
      source: {s}.gold_fill_rate_weekly
      dimensions:
        - name: week_start
          expr: week_start
        - name: month
          expr: date_trunc('MONTH', week_start)
        - name: plant_name
          expr: plant_name
        - name: product_family
          expr: product_family
        - name: sku
          expr: sku
      measures:
        - name: fill_rate
          expr: SUM(units_shipped) / NULLIF(SUM(units_ordered), 0)
          comment: Units shipped / units ordered
        - name: line_fill_rate
          expr: SUM(lines_shipped_complete) / NULLIF(SUM(order_lines), 0)
        - name: units_ordered
          expr: SUM(units_ordered)
        - name: units_shipped
          expr: SUM(units_shipped)
        - name: order_value
          expr: SUM(order_value)
        - name: revenue_unshipped
          expr: SUM(revenue_unshipped)
      $$
    """)

    for t in ["demand_forecast", "component_requirements", "inventory_projection", "stockout_exposures", "gold_inventory_health",
              "gold_fill_rate_weekly", "gold_supplier_performance_monthly", "gold_open_purchase_orders"]:
        print(f"  {t}: {run(f'SELECT count(*) FROM {s}.{t}')[0][0]} rows")
    for r in run(f"SELECT exposure_id, exposure_type, first_stockout_week, peak_units_short, revenue_at_risk FROM {s}.stockout_exposures ORDER BY revenue_at_risk DESC"):
        print("   ", r)


if __name__ == "__main__":
    main()

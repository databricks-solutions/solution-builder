"""
Gold layer + Unity Catalog metric view for the ad-sales yield desk (dashboard, Genie and the app).

  gold_inventory_daily     product x day: avails, sold (guaranteed / PMP / open auction), unsold, revenue,
                           sell-through, blended + programmatic eCPM, rate card, floor + inventory group in force
  gold_monthly_yield       month x platform x tier: revenue, sold impressions, sell-through, eCPM
  gold_line_pacing         live IO lines: booked vs delivered vs expected, 14-day run-rate, projected delivery,
                           shortfall, and how the product's avails moved since the flight started
  gold_campaign_pacing     live + booked campaigns: pacing %, projected delivery %, shortfall, make-good
                           liability at the booked CPM, at-risk flag (< 95% projected), the line driving the risk
  gold_spare_avails        product x future day: ai_forecast avails, committed guaranteed run-rate,
                           spare avails, and the programmatic eCPM those spare impressions earn today
  gold_yield_opportunities programmatic products, last 28 days: eCPM vs rate card vs open-auction clearing,
                           inventory group in force vs the rate card's, revenue gap, recommended floor
  gold_make_goods          make-goods issued (advertiser, value, resolution)
  mv_ad_yield              metric view — governed yield KPIs over gold_inventory_daily

Needs gold_avails_forecast (src/forecast/forecast_avails.py) for gold_spare_avails.

    python build_gold.py --catalog media_advertising --schema ad_yield_optimization
"""
from __future__ import annotations

import argparse

from pyspark.sql import SparkSession

GROUP_FLOOR = "CASE {c} WHEN 'PREMIUM-SPORTS' THEN 30.0 WHEN 'PREMIUM-ENT' THEN 22.0 WHEN 'STANDARD' THEN 14.0 WHEN 'RON-DEFAULT' THEN 9.0 END"


def get_spark() -> SparkSession:
    try:
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    try:
        from databricks.connect import DatabricksSession  # type: ignore
        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        return SparkSession.builder.getOrCreate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="media_advertising")
    ap.add_argument("--schema", default="ad_yield_optimization")
    args, _ = ap.parse_known_args()
    s = f"{args.catalog}.{args.schema}"
    spark = get_spark()

    def run(name: str, sql: str, comment: str):
        spark.sql(f"CREATE OR REPLACE TABLE {s}.{name} COMMENT '{comment.replace(chr(39), chr(39) * 2)}' AS {sql}")
        n = spark.sql(f"SELECT COUNT(*) AS n FROM {s}.{name}").collect()[0].n
        print(f"  {name}: {n} rows")

    run("gold_inventory_daily", f"""
      SELECT i.inventory_date, date_trunc('WEEK', i.inventory_date) AS week_start, date_trunc('MONTH', i.inventory_date) AS month_start,
             i.product_id, p.product_name, p.platform, p.content_category, p.daypart, p.tier, p.rate_card_cpm,
             p.rate_card_inventory_group, i.inventory_group, i.floor_cpm,
             i.avails, i.guaranteed_impressions, i.pmp_impressions, i.open_auction_impressions, i.unsold_impressions,
             i.guaranteed_impressions + i.pmp_impressions + i.open_auction_impressions AS sold_impressions,
             i.pmp_impressions + i.open_auction_impressions AS programmatic_impressions,
             i.guaranteed_revenue, i.pmp_revenue, i.open_auction_revenue,
             i.guaranteed_revenue + i.pmp_revenue + i.open_auction_revenue AS revenue,
             i.pmp_revenue + i.open_auction_revenue AS programmatic_revenue,
             ROUND((i.guaranteed_impressions + i.pmp_impressions + i.open_auction_impressions) / i.avails, 4) AS sell_through,
             ROUND(1000 * (i.guaranteed_revenue + i.pmp_revenue + i.open_auction_revenue)
                   / NULLIF(i.guaranteed_impressions + i.pmp_impressions + i.open_auction_impressions, 0), 2) AS ecpm,
             ROUND(1000 * (i.pmp_revenue + i.open_auction_revenue) / NULLIF(i.pmp_impressions + i.open_auction_impressions, 0), 2) AS programmatic_ecpm,
             i.open_clearing_cpm, i.p50_open_bid_cpm, i.p90_open_bid_cpm, i.avg_bids_per_request
      FROM {s}.inventory_daily i JOIN {s}.ad_products p USING (product_id)
    """, "One row per inventory product per day with sell-through (sold / avails), eCPM (revenue / sold x 1000) and programmatic eCPM. Sold = guaranteed IO delivery + PMP + open auction.")

    run("gold_monthly_yield", f"""
      SELECT month_start, platform, tier,
             SUM(avails) AS avails, SUM(sold_impressions) AS sold_impressions, SUM(revenue) AS revenue,
             SUM(guaranteed_revenue) AS guaranteed_revenue, SUM(programmatic_revenue) AS programmatic_revenue,
             ROUND(SUM(sold_impressions) / SUM(avails), 4) AS sell_through,
             ROUND(1000 * SUM(revenue) / NULLIF(SUM(sold_impressions), 0), 2) AS ecpm
      FROM {s}.gold_inventory_daily GROUP BY ALL
    """, "Monthly yield by platform x tier: avails, sold impressions, revenue, sell-through, eCPM.")

    run("gold_line_pacing", f"""
      WITH d AS (
        SELECT line_id, SUM(impressions) AS delivered, SUM(revenue) AS delivered_revenue,
               SUM(CASE WHEN delivery_date >= date_sub(current_date(), 14) THEN impressions ELSE 0 END) AS last14
        FROM {s}.delivery_daily GROUP BY line_id),
      l AS (
        SELECT li.*, c.status, c.advertiser_id, c.target_segment_id,
               datediff(li.flight_end, li.flight_start) + 1 AS flight_days,
               LEAST(datediff(li.flight_end, li.flight_start) + 1, GREATEST(0, datediff(current_date(), li.flight_start))) AS elapsed_days,
               COALESCE(d.delivered, 0) AS delivered, COALESCE(d.delivered_revenue, 0) AS delivered_revenue, COALESCE(d.last14, 0) AS last14
        FROM {s}.line_items li JOIN {s}.campaigns c USING (campaign_id) LEFT JOIN d USING (line_id)
        WHERE c.status IN ('Live', 'Booked')),
      av AS (
        SELECT l.line_id,
               AVG(CASE WHEN i.inventory_date >= date_sub(current_date(), 28) THEN i.avails END) AS avails_last28,
               AVG(CASE WHEN i.inventory_date BETWEEN l.flight_start AND date_add(l.flight_start, 6) THEN i.avails END) AS avails_flight_week1
        FROM l JOIN {s}.inventory_daily i ON i.product_id = l.product_id AND i.inventory_date >= l.flight_start
        GROUP BY l.line_id)
      SELECT l.line_id, l.campaign_id, l.product_id, p.product_name, p.platform, p.tier, l.status, l.target_segment_id,
             l.flight_start, l.flight_end, l.flight_days, l.elapsed_days, l.flight_days - l.elapsed_days AS remaining_days,
             l.booked_impressions, l.cpm, l.delivered,
             CAST(ROUND(l.booked_impressions * l.elapsed_days / l.flight_days) AS BIGINT) AS expected_to_date,
             ROUND(l.delivered / NULLIF(l.booked_impressions * l.elapsed_days / l.flight_days, 0), 4) AS pacing,
             CAST(ROUND(l.last14 / NULLIF(LEAST(14, l.elapsed_days), 0)) AS BIGINT) AS run_rate_daily,
             CAST(ROUND(l.booked_impressions / l.flight_days) AS BIGINT) AS planned_daily,
             CAST(LEAST(l.booked_impressions, l.delivered + COALESCE(l.last14 / NULLIF(LEAST(14, l.elapsed_days), 0), l.booked_impressions / l.flight_days)
                   * (l.flight_days - l.elapsed_days)) AS BIGINT) AS projected_delivery,
             ROUND(av.avails_last28 / NULLIF(av.avails_flight_week1, 0) - 1, 4) AS avails_change_since_start
      FROM l JOIN {s}.ad_products p USING (product_id) LEFT JOIN av USING (line_id)
    """, "Pacing of every line of a live or booked campaign: booked vs delivered vs expected-to-date (linear plan), 14-day run-rate, projected delivery at flight end (delivered + run-rate x remaining days), and how the product's avails moved since the flight started (avails_change_since_start).")

    run("gold_campaign_pacing", f"""
      WITH lp AS (
        SELECT campaign_id, SUM(delivered) AS delivered, SUM(expected_to_date) AS expected_to_date,
               SUM(projected_delivery) AS projected_delivery, SUM(run_rate_daily) AS run_rate_daily,
               MAX_BY(line_id, booked_impressions - projected_delivery) AS risk_line_id,
               MAX_BY(product_id, booked_impressions - projected_delivery) AS risk_product_id,
               MAX_BY(product_name, booked_impressions - projected_delivery) AS risk_product_name,
               MAX_BY(avails_change_since_start, booked_impressions - projected_delivery) AS risk_product_avails_change
        FROM {s}.gold_line_pacing GROUP BY campaign_id)
      SELECT c.campaign_id, c.io_number, c.campaign_name, c.advertiser_id, a.advertiser_name, a.category AS advertiser_category, a.agency,
             c.deal_type, c.target_segment_id, sg.segment_name AS target_segment, c.flight_start, c.flight_end, c.status, c.sales_owner,
             c.make_good_terms, c.booked_impressions, c.booked_revenue,
             ROUND(1000 * c.booked_revenue / c.booked_impressions, 2) AS booked_cpm,
             datediff(c.flight_end, c.flight_start) + 1 AS flight_days,
             GREATEST(0, datediff(c.flight_end, current_date()) + 1) AS days_remaining,
             lp.delivered, lp.expected_to_date,
             ROUND(lp.delivered / NULLIF(lp.expected_to_date, 0), 4) AS pacing,
             lp.run_rate_daily, lp.projected_delivery,
             ROUND(lp.projected_delivery / c.booked_impressions, 4) AS projected_delivery_pct,
             GREATEST(0, c.booked_impressions - lp.projected_delivery) AS projected_shortfall,
             ROUND(GREATEST(0, c.booked_impressions - lp.projected_delivery) * c.booked_revenue / c.booked_impressions, 2) AS make_good_liability,
             (c.status = 'Live' AND lp.projected_delivery < 0.95 * c.booked_impressions) AS at_risk,
             lp.risk_line_id, lp.risk_product_id, lp.risk_product_name, lp.risk_product_avails_change
      FROM {s}.campaigns c JOIN lp USING (campaign_id)
      JOIN {s}.advertisers a USING (advertiser_id) JOIN {s}.audience_segments sg ON sg.segment_id = c.target_segment_id
    """, "Live and booked campaigns (IOs) with pacing (delivered / expected to date), projected delivery at flight end, projected shortfall and make-good liability (shortfall x booked CPM). at_risk = live and projected to deliver < 95% of the guarantee (the make-good threshold). risk_* = the line driving the shortfall and how its product's avails changed since the flight started.")

    run("gold_spare_avails", f"""
      WITH committed AS (
        SELECT f.product_id, f.forecast_date,
               SUM(CASE WHEN f.forecast_date BETWEEN GREATEST(lp.flight_start, current_date()) AND lp.flight_end
                        THEN GREATEST(0, lp.booked_impressions - lp.delivered) / GREATEST(1, datediff(lp.flight_end, GREATEST(lp.flight_start, current_date())) + 1)
                        ELSE 0 END) AS committed
        FROM {s}.gold_avails_forecast f LEFT JOIN {s}.gold_line_pacing lp ON lp.product_id = f.product_id
        GROUP BY f.product_id, f.forecast_date),
      prog AS (
        SELECT product_id,
               ROUND(1000 * SUM(programmatic_revenue) / NULLIF(SUM(programmatic_impressions), 0), 2) AS programmatic_ecpm_28d,
               ROUND(SUM(programmatic_impressions) / NULLIF(SUM(avails - guaranteed_impressions), 0), 4) AS programmatic_fill_28d
        FROM {s}.gold_inventory_daily WHERE inventory_date >= date_sub(current_date(), 28) GROUP BY product_id)
      SELECT f.product_id, p.product_name, p.platform, p.tier, p.content_category, f.forecast_date,
             f.avails_forecast, f.avails_lower, CAST(ROUND(c.committed) AS BIGINT) AS committed_guaranteed,
             CAST(GREATEST(0, f.avails_forecast * 0.95 - c.committed) AS BIGINT) AS spare_avails,
             pr.programmatic_ecpm_28d, pr.programmatic_fill_28d
      FROM {s}.gold_avails_forecast f JOIN committed c USING (product_id, forecast_date)
      JOIN {s}.ad_products p USING (product_id) LEFT JOIN prog pr USING (product_id)
    """, "Future avails per product per day: the avails forecast (ai_forecast clamped to the trailing same-weekday baseline), the guaranteed run-rate already committed to live/booked lines, and spare avails (95% of forecast minus committed) that can absorb a make-good. Spare impressions on programmatic products are sold today at programmatic_ecpm_28d — the revenue displaced if a guarantee uses them. In-target spare = spare_avails x product_audience_mix.audience_share.")

    gf = GROUP_FLOOR.format(c="p.rate_card_inventory_group")
    run("gold_yield_opportunities", f"""
      WITH cur AS (SELECT product_id, inventory_group, floor_cpm, rule_id, effective_from, changed_by, change_ticket, change_note
                   FROM {s}.floor_price_rules WHERE effective_to IS NULL),
      w AS (
        SELECT product_id, SUM(avails) AS avails, SUM(sold_impressions) AS sold, SUM(revenue) AS revenue,
               SUM(guaranteed_impressions) AS g_imps, SUM(pmp_impressions) AS pmp_imps, SUM(open_auction_impressions) AS open_imps,
               SUM(pmp_revenue) AS pmp_rev, SUM(open_auction_revenue) AS open_rev, SUM(programmatic_revenue) AS prog_rev,
               SUM(programmatic_impressions) AS prog_imps, AVG(p50_open_bid_cpm) AS p50_bid, AVG(p90_open_bid_cpm) AS p90_bid,
               AVG(avg_bids_per_request) AS bids_per_request
        FROM {s}.gold_inventory_daily WHERE inventory_date >= date_sub(current_date(), 28) GROUP BY product_id),
      before AS (
        SELECT g.product_id, ROUND(1000 * SUM(g.programmatic_revenue) / NULLIF(SUM(g.programmatic_impressions), 0), 2) AS prog_ecpm_before
        FROM {s}.gold_inventory_daily g JOIN cur ON cur.product_id = g.product_id
        WHERE g.inventory_date BETWEEN date_sub(cur.effective_from, 28) AND date_sub(cur.effective_from, 1) GROUP BY g.product_id),
      since AS (
        SELECT g.product_id, SUM(g.pmp_impressions) AS pmp_imps_since, SUM(g.pmp_revenue) AS pmp_rev_since,
               SUM(g.open_auction_revenue) AS open_rev_since, SUM(g.open_auction_impressions) AS open_imps_since,
               AVG(g.avg_bids_per_request) AS bpr_since
        FROM {s}.gold_inventory_daily g JOIN cur ON cur.product_id = g.product_id
        WHERE g.inventory_date >= cur.effective_from GROUP BY g.product_id),
      x AS (
        SELECT p.product_id, p.product_name, p.platform, p.content_category, p.tier, p.rate_card_cpm,
               p.rate_card_inventory_group, {gf} AS rate_card_group_floor,
               cur.inventory_group AS current_inventory_group, cur.floor_cpm AS current_floor_cpm, cur.rule_id AS current_rule_id,
               cur.effective_from AS current_rule_since, cur.changed_by AS current_rule_changed_by, cur.change_ticket, cur.change_note,
               w.avails AS avails_28d, w.sold AS sold_28d, ROUND(w.sold / w.avails, 4) AS sell_through_28d,
               ROUND(w.g_imps / w.avails, 4) AS guaranteed_share_28d, ROUND(w.pmp_imps / w.avails, 4) AS pmp_share_28d,
               ROUND(w.open_imps / w.avails, 4) AS open_auction_share_28d,
               ROUND(1000 * w.revenue / w.sold, 2) AS ecpm_28d, ROUND(1000 * w.prog_rev / NULLIF(w.prog_imps, 0), 2) AS programmatic_ecpm_28d,
               ROUND(1000 * w.pmp_rev / NULLIF(w.pmp_imps, 0), 2) AS pmp_ecpm_28d,
               ROUND(1000 * w.open_rev / NULLIF(w.open_imps, 0), 2) AS open_clearing_cpm_28d,
               ROUND(w.p50_bid, 2) AS p50_open_bid_cpm_28d, ROUND(w.p90_bid, 2) AS p90_open_bid_cpm_28d,
               ROUND(w.bids_per_request, 2) AS bids_per_request_28d,
               ROUND(LEAST(0.9, 1 - POW(0.5, w.bids_per_request)), 3) AS fill_retention,
               w.pmp_imps AS pmp_impressions_28d, b.prog_ecpm_before AS programmatic_ecpm_before_rule,
               (cur.inventory_group <> p.rate_card_inventory_group) AS group_mismatch,
               si.pmp_imps_since, si.pmp_rev_since, ROUND(1000 * si.open_rev_since / NULLIF(si.open_imps_since, 0), 2) AS open_clearing_since,
               ROUND(LEAST(0.9, 1 - POW(0.5, si.bpr_since)), 3) AS fill_retention_since
        FROM {s}.ad_products p JOIN cur USING (product_id) JOIN w USING (product_id)
        LEFT JOIN before b USING (product_id) LEFT JOIN since si USING (product_id)
        WHERE p.programmatic_enabled)
      SELECT x.*,
             ROUND(CASE WHEN group_mismatch THEN pmp_impressions_28d * GREATEST(0, open_clearing_cpm_28d * fill_retention - pmp_ecpm_28d) / 1000 ELSE 0 END, 2) AS revenue_gap_28d,
             ROUND(CASE WHEN group_mismatch THEN pmp_impressions_28d * GREATEST(0, open_clearing_cpm_28d * fill_retention - pmp_ecpm_28d) / 1000 * 365 / 28 ELSE 0 END, 2) AS revenue_gap_annualized,
             ROUND(CASE WHEN group_mismatch THEN pmp_imps_since * GREATEST(0, open_clearing_since * fill_retention_since - 1000 * pmp_rev_since / NULLIF(pmp_imps_since, 0)) / 1000 ELSE 0 END, 2) AS revenue_gap_since_rule,
             CASE WHEN group_mismatch THEN rate_card_inventory_group ELSE current_inventory_group END AS recommended_inventory_group,
             CASE WHEN group_mismatch THEN rate_card_group_floor ELSE current_floor_cpm END AS recommended_floor_cpm,
             (group_mismatch OR programmatic_ecpm_28d < 0.4 * rate_card_cpm AND tier = 'Premium') AS is_leak
      FROM x
    """, "Programmatic products over the last 28 days: sell-through, eCPM vs rate card vs open-auction clearing price, the inventory group / floor the ad server has in force vs the one the rate card assigns. group_mismatch = the product is priced in the wrong floor group. revenue_gap_28d = PMP impressions x (open clearing x fill retention - PMP eCPM): revenue left on the table vs pricing them at the open-auction level. fill_retention = 1 - 0.5^bids_per_request (share of requests still filled at a floor near the median bid), capped at 90%.")

    run("gold_make_goods", f"""
      SELECT m.*, c.campaign_name, c.io_number, c.deal_type, a.advertiser_name, a.category AS advertiser_category,
             date_trunc('MONTH', m.issued_date) AS issued_month
      FROM {s}.make_goods m JOIN {s}.campaigns c USING (campaign_id) JOIN {s}.advertisers a USING (advertiser_id)
    """, "Make-goods issued on completed campaigns (value at the booked CPM, ADUs or cash credit).")

    spark.sql(f"""
      CREATE OR REPLACE VIEW {s}.mv_ad_yield
      WITH METRICS
      LANGUAGE YAML
      COMMENT 'Governed ad-yield KPIs over gold_inventory_daily: revenue, sold impressions, avails, sell-through, eCPM, programmatic eCPM, revenue by channel.'
      AS $$
      version: 1.1
      source: {s}.gold_inventory_daily
      dimensions:
        - name: inventory_date
          expr: inventory_date
        - name: week_start
          expr: week_start
        - name: month_start
          expr: month_start
        - name: product_name
          expr: product_name
        - name: platform
          expr: platform
        - name: tier
          expr: tier
        - name: content_category
          expr: content_category
        - name: daypart
          expr: daypart
        - name: inventory_group
          expr: inventory_group
      measures:
        - name: revenue
          expr: SUM(revenue)
        - name: sold_impressions
          expr: SUM(sold_impressions)
        - name: avails
          expr: SUM(avails)
        - name: sell_through
          expr: SUM(sold_impressions) / SUM(avails)
        - name: ecpm
          expr: 1000 * SUM(revenue) / SUM(sold_impressions)
        - name: programmatic_ecpm
          expr: 1000 * SUM(programmatic_revenue) / SUM(programmatic_impressions)
        - name: guaranteed_revenue
          expr: SUM(guaranteed_revenue)
        - name: pmp_revenue
          expr: SUM(pmp_revenue)
        - name: open_auction_revenue
          expr: SUM(open_auction_revenue)
        - name: unsold_impressions
          expr: SUM(unsold_impressions)
      $$
    """)
    print("  mv_ad_yield: metric view created")
    print("done.")


if __name__ == "__main__":
    main()

"""
Gold layer for the Tidewell underwriting copilot.

  gold_portfolio_quarterly   loss ratio by quarter x portfolio cell (segment, hail-belt habitational split out) x roof band
                             — the table that shows hail-belt habitational with old roofs going from ~60% to ~165%
  gold_broker_performance    trailing-12-month submissions, quotes, binds, hit ratio and bound premium per broker
  gold_submission_queue      one row per submission in today's queue: what the application says vs what the SOV and loss
                             runs show, the discrepancies, the appetite / authority rules hit (with document refs), the ML
                             risk scores (as submitted vs verified), a triage lane and a priority score
  v_uw_decisions_latest      VIEW: the latest decision the desk issued per submission (write-back from the app)

    python build_gold.py --catalog financial_services --schema commercial_underwriting_copilot
"""
import argparse

from pyspark.sql import SparkSession


def get_spark() -> SparkSession:
    active = SparkSession.getActiveSession()
    if active is not None:
        return active
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="financial_services")
    ap.add_argument("--schema", default="commercial_underwriting_copilot")
    a, _ = ap.parse_known_args()
    s = f"{a.catalog}.{a.schema}"
    spark = get_spark()

    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.gold_portfolio_quarterly
    COMMENT 'Accident-quarter loss ratio by portfolio cell and roof band, 2024-Q3 to 2026-Q2 (latest complete quarter = 2026-Q2). portfolio_cell splits Habitational into Hail belt (TX OK KS NE CO) vs Other states. loss_ratio = incurred / earned premium.'
    AS
    WITH pol AS (
      SELECT policy_id, segment, hail_belt,
             CASE WHEN segment_code = 'HAB' AND hail_belt THEN 'Habitational · Hail belt'
                  WHEN segment_code = 'HAB' THEN 'Habitational · Other states' ELSE segment END AS portfolio_cell,
             CASE WHEN roof_age_years > 15 THEN 'Roof > 15 yrs' ELSE 'Roof <= 15 yrs' END AS roof_band
      FROM {s}.policies
    ), ep AS (
      SELECT pq.quarter, pol.portfolio_cell, pol.segment, pol.hail_belt, pol.roof_band,
             COUNT(DISTINCT pq.policy_id) AS policies_earning, SUM(pq.earned_premium) AS earned_premium
      FROM {s}.policy_quarters pq JOIN pol USING (policy_id) GROUP BY ALL
    ), inc AS (
      SELECT c.accident_quarter AS quarter, pol.portfolio_cell, pol.segment, pol.hail_belt, pol.roof_band,
             COUNT(*) AS claim_count, SUM(c.incurred_amount) AS incurred,
             SUM(CASE WHEN c.peril IN ('Hail', 'Wind') THEN c.incurred_amount ELSE 0 END) AS wind_hail_incurred
      FROM {s}.claims c JOIN pol USING (policy_id) GROUP BY ALL
    )
    SELECT ep.quarter, ep.portfolio_cell, ep.segment, ep.hail_belt, ep.roof_band, ep.policies_earning,
           ROUND(ep.earned_premium, 2) AS earned_premium, COALESCE(inc.claim_count, 0) AS claim_count,
           ROUND(COALESCE(inc.incurred, 0), 2) AS incurred, ROUND(COALESCE(inc.wind_hail_incurred, 0), 2) AS wind_hail_incurred,
           ROUND(COALESCE(inc.incurred, 0) / ep.earned_premium, 4) AS loss_ratio
    FROM ep LEFT JOIN inc USING (quarter, portfolio_cell, segment, hail_belt, roof_band)
    """)

    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.gold_broker_performance
    COMMENT 'Trailing 12 months (received 2025-09-28 to 2026-09-27) per broker: submissions, quoted, bound, hit ratio (bound / quoted), bound premium, and the loss ratio of the broker''s in-force book (2024-Q3..2026-Q2).'
    AS
    WITH sub AS (
      SELECT broker_id, COUNT(*) submissions,
             SUM(CAST(outcome IN ('BOUND', 'QUOTED_NOT_BOUND') AS INT)) quoted,
             SUM(CAST(outcome = 'BOUND' AS INT)) bound, SUM(COALESCE(bound_premium, 0)) bound_premium,
             SUM(CAST(outcome = 'DECLINED' AS INT)) declined
      FROM {s}.submission_history WHERE received_date >= DATE'2025-09-28' GROUP BY broker_id
    ), book AS (
      SELECT p.broker_id, SUM(pq.earned_premium) ep FROM {s}.policy_quarters pq JOIN {s}.policies p USING (policy_id) GROUP BY p.broker_id
    ), loss AS (
      SELECT p.broker_id, SUM(c.incurred_amount) inc FROM {s}.claims c JOIN {s}.policies p USING (policy_id) GROUP BY p.broker_id
    )
    SELECT b.broker_id, b.broker_name, b.tier, b.state, COALESCE(sub.submissions, 0) submissions, COALESCE(sub.quoted, 0) quoted,
           COALESCE(sub.bound, 0) bound, COALESCE(sub.declined, 0) declined,
           ROUND(COALESCE(sub.bound, 0) / NULLIF(sub.quoted, 0), 4) hit_ratio, ROUND(COALESCE(sub.bound_premium, 0), 2) bound_premium,
           ROUND(COALESCE(loss.inc, 0) / NULLIF(book.ep, 0), 4) book_loss_ratio
    FROM {s}.brokers b LEFT JOIN sub USING (broker_id) LEFT JOIN book USING (broker_id) LEFT JOIN loss USING (broker_id)
    """)

    spark.sql(f"""
    CREATE OR REPLACE TABLE {s}.gold_submission_queue
    COMMENT 'Today''s underwriting queue (Mon 28 Sep 2026): per submission the application (as stated) vs the SOV + loss runs (as verified, AI-extracted), discrepancies, appetite / authority rules hit with document references, ML risk (as submitted vs verified), triage lane and priority score (0-100).'
    AS
    WITH sov AS (
      SELECT submission_id, COUNT(*) sov_locations, SUM(tiv) sov_tiv, MIN(roof_year) oldest_roof_year, MAX(roof_age_years) max_roof_age,
             MIN(year_built) oldest_year_built, MAX(protection_class) worst_protection_class,
             SUM(CAST(lower(construction) LIKE '%frame%' AS INT)) frame_locations,
             SUM(CAST(NOT sprinklered AS INT)) unsprinklered_locations, MAX(CAST(coastal_tier1 AS INT)) = 1 coastal_tier1,
             SUM(CASE WHEN roof_age_years > 15 THEN tiv ELSE 0 END) old_roof_tiv,
             concat_ws(', ', collect_list(CASE WHEN roof_age_years > 15 THEN concat('Loc ', loc_no, ' ', building_name) END)) old_roof_locations,
             SUM(CAST(lower(construction) LIKE '%frame%' AND year_built < 1990 AND NOT sprinklered AS INT)) old_frame_unsprinklered
      FROM {s}.sov_locations GROUP BY submission_id
    ), lr AS (
      SELECT s.submission_id, s.valuation_date, s.years_covered, s.carrier AS loss_run_carrier,
             COUNT(c.claim_number) lr_claims, COALESCE(SUM(c.total_incurred), 0) lr_incurred, COALESCE(SUM(CAST(c.wind_hail AS INT)), 0) lr_wind_hail,
             COALESCE(SUM(CAST(c.status = 'Open' AS INT)), 0) lr_open
      FROM {s}.loss_run_summary s LEFT JOIN {s}.loss_run_claims c USING (submission_id) GROUP BY ALL
    ), base AS (
      SELECT i.submission_id, i.received_ts, i.broker_contact, br.broker_name, br.tier broker_tier, a.insured_name, a.business_description,
             a.segment_code, CASE a.segment_code WHEN 'HAB' THEN 'Habitational' WHEN 'RET' THEN 'Retail & Restaurants'
               WHEN 'MFG' THEN 'Light Manufacturing' WHEN 'WHS' THEN 'Warehouse & Distribution' WHEN 'OFF' THEN 'Office & Professional'
               WHEN 'HOS' THEN 'Hospitality' END segment,
             a.premises_state state, array_contains(array('TX', 'OK', 'KS', 'NE', 'CO'), a.premises_state) hail_belt,
             a.effective_date, datediff(a.effective_date, DATE'2026-09-28') days_to_effective, a.locations_count app_locations,
             a.total_tiv app_tiv, a.construction app_construction, a.year_built app_year_built, a.roof_year app_roof_year,
             a.sprinklered app_sprinklered, a.protection_class app_protection_class, a.stated_loss_count app_loss_count,
             a.stated_loss_amount app_loss_amount, a.target_premium, a.expiring_premium, a.annual_revenue, a.prior_carrier, a.remarks,
             sov.* EXCEPT (submission_id), lr.valuation_date loss_run_valued, lr.years_covered loss_run_years, lr.loss_run_carrier, lr.lr_claims, lr.lr_incurred,
             lr.lr_wind_hail, lr.lr_open,
             r.p_as_submitted, r.band_as_submitted, r.p_verified, r.band_verified, r.drivers risk_drivers
      FROM {s}.submission_inbox i
      JOIN {s}.brokers br ON br.broker_id = i.broker_id
      JOIN {s}.application_extract a ON a.submission_id = i.submission_id
      JOIN sov ON sov.submission_id = i.submission_id
      JOIN lr ON lr.submission_id = i.submission_id
      LEFT JOIN {s}.submission_risk_scores r ON r.submission_id = i.submission_id
    ), flags AS (
      SELECT b.*,
        filter(array(
          CASE WHEN abs(sov_tiv - app_tiv) / app_tiv > 0.02 THEN concat('TIV: application $', format_number(app_tiv, 0), ' vs SOV $', format_number(sov_tiv, 0)) END,
          CASE WHEN oldest_roof_year < app_roof_year THEN concat('Roof: application says ', app_roof_year, '; SOV oldest roof ', oldest_roof_year, ' (', old_roof_locations, ')') END,
          CASE WHEN lower(app_construction) NOT LIKE '%frame%' AND frame_locations > 0 THEN concat('Construction: application says ', app_construction, '; SOV has ', frame_locations, ' frame building(s)') END,
          CASE WHEN app_sprinklered AND unsprinklered_locations > 0 THEN concat('Sprinklers: application says yes; SOV shows ', unsprinklered_locations, ' unsprinklered building(s)') END,
          CASE WHEN lr_claims > app_loss_count OR lr_incurred > app_loss_amount * 1.05 + 1000 THEN concat('Losses: application says ', app_loss_count, ' / $', format_number(app_loss_amount, 0), '; loss run shows ', lr_claims, ' / $', format_number(lr_incurred, 0)) END
        ), x -> x IS NOT NULL) AS discrepancies,
        filter(array(
          CASE WHEN segment_code = 'HAB' AND hail_belt AND max_roof_age > 15 THEN 'AP-HAB-HAIL-ROOF' END,
          CASE WHEN segment_code = 'HAB' AND old_frame_unsprinklered > 0 THEN 'AP-HAB-FRAME-OLD' END,
          CASE WHEN coastal_tier1 THEN 'AP-FL-COASTAL' END,
          CASE WHEN worst_protection_class >= 9 THEN 'AP-PROTECTION' END,
          CASE WHEN loss_run_valued < DATE'2026-09-28' - INTERVAL 90 DAYS OR loss_run_years < 5 THEN 'AP-DOCS-LOSSRUN' END,
          CASE WHEN sov_tiv > 25000000 THEN 'AUTH-TIV-SENIOR' END
        ), x -> x IS NOT NULL) AS rules_hit
      FROM base b
    )
    SELECT f.*, size(discrepancies) AS discrepancy_count,
      CASE WHEN array_contains(rules_hit, 'AP-FL-COASTAL') THEN 'Decline - out of appetite'
           WHEN array_contains(rules_hit, 'AP-DOCS-LOSSRUN') THEN 'Request information'
           WHEN size(discrepancies) > 0 THEN 'Documents disagree'
           WHEN array_contains(rules_hit, 'AP-HAB-HAIL-ROOF') OR array_contains(rules_hit, 'AP-HAB-FRAME-OLD') OR array_contains(rules_hit, 'AP-PROTECTION') THEN 'Appetite referral'
           WHEN array_contains(rules_hit, 'AUTH-TIV-SENIOR') THEN 'CUO authority referral'
           WHEN band_verified = 'Low' AND sov_tiv <= 15000000 THEN 'Fast track'
           ELSE 'Underwriter review' END AS triage_lane,
      ROUND(LEAST(100, 45 * LEAST(1.0, sov_tiv * 0.0026 / 120000)
                       + CASE broker_tier WHEN 'Premier' THEN 20 WHEN 'Preferred' THEN 12 ELSE 6 END
                       + 25 * GREATEST(0.0, 1 - GREATEST(days_to_effective - 14, 0) / 60.0)
                       + 10 * LEAST(1.0, size(discrepancies) / 2.0)), 0) AS priority_score,
      ROUND(sov_tiv * 0.0026, -2) AS premium_potential
    FROM flags f
    """)

    spark.sql(f"""
    CREATE OR REPLACE VIEW {s}.v_uw_decisions_latest
    COMMENT 'Latest decision issued by the underwriting desk per submission (write-back from the Underwriting Copilot app).'
    AS SELECT * FROM {s}.uw_decisions QUALIFY ROW_NUMBER() OVER (PARTITION BY submission_id ORDER BY decided_at DESC) = 1
    """)

    for r in spark.sql(f"""SELECT quarter, portfolio_cell, ROUND(SUM(incurred) / SUM(earned_premium), 3) lr FROM {s}.gold_portfolio_quarterly
                           WHERE portfolio_cell LIKE 'Habitational%' GROUP BY ALL ORDER BY portfolio_cell, quarter""").collect():
        print(r)
    for r in spark.sql(f"""SELECT submission_id, insured_name, triage_lane, priority_score, discrepancy_count, rules_hit, band_as_submitted, band_verified
                           FROM {s}.gold_submission_queue ORDER BY priority_score DESC""").collect():
        print(r)


if __name__ == "__main__":
    main()

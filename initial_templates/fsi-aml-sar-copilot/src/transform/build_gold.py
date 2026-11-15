#!/usr/bin/env python
"""
Gold layer for the AML / SAR Copilot.

  gold_network_edges      customer<->customer links: shared address / phone / device + fund transfers
  gold_customer_network   customer -> network cluster (connected components over the edges)
  gold_network_clusters   one row per multi-party cluster: size, members, 60-day cash in, high-risk wires out
  gold_alert_features     one row per alert: 30-day behavioural + KYC + network features (the ML feature set)
  case_decisions / case_audit_log / sar_drafts   write-back tables used by the investigator app
                                                 (created IF NOT EXISTS — never overwritten)

Run: python build_gold.py --catalog demo_generator --schema aml_sar_copilot
"""
import argparse

import pandas as pd


def get_spark():
    try:
        from databricks.connect import DatabricksSession
        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        from pyspark.sql import SparkSession
        return SparkSession.builder.getOrCreate()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--catalog", default="demo_generator")
    p.add_argument("--schema", default="aml_sar_copilot")
    a, _ = p.parse_known_args()
    spark = get_spark()
    fq = f"{a.catalog}.{a.schema}"

    # ---- 1. network edges -------------------------------------------------
    spark.sql(f"""
    CREATE OR REPLACE TABLE {fq}.gold_network_edges
    COMMENT 'Customer-to-customer links: shared identity attributes (address/phone/device) and internal/P2P fund transfers.' AS
    WITH attr AS (
      SELECT a.customer_id AS src, b.customer_id AS dst, concat('shared_', a.attr_type) AS edge_type,
             a.attr_value AS detail, CAST(NULL AS DOUBLE) AS amount, CAST(NULL AS BIGINT) AS txn_count
      FROM {fq}.customer_attributes a JOIN {fq}.customer_attributes b
        ON a.attr_type = b.attr_type AND a.attr_value = b.attr_value AND a.customer_id < b.customer_id
    ), flows AS (
      SELECT customer_id AS src, counterparty_customer_id AS dst, 'funds_transfer' AS edge_type,
             concat(count(*), ' transfers') AS detail, round(sum(amount), 2) AS amount, count(*) AS txn_count
      FROM {fq}.transactions
      WHERE counterparty_customer_id IS NOT NULL AND direction = 'debit'
      GROUP BY customer_id, counterparty_customer_id
    )
    SELECT * FROM attr UNION ALL SELECT * FROM flows
    """)

    # ---- 2. connected components (union-find, small graph -> driver) --------
    edges = spark.table(f"{fq}.gold_network_edges").select("src", "dst").toPandas()
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for s, d in edges.itertuples(index=False):
        rs, rd = find(s), find(d)
        if rs != rd:
            parent[max(rs, rd)] = min(rs, rd)
    custs = spark.table(f"{fq}.customers").select("customer_id").toPandas().customer_id
    comp = pd.DataFrame({"customer_id": custs})
    comp["root"] = comp.customer_id.map(find)
    deg = pd.concat([edges.src, edges.dst]).value_counts()
    comp["degree"] = comp.customer_id.map(deg).fillna(0).astype(int)
    size = comp.groupby("root").customer_id.transform("count")
    comp["cluster_size"] = size.astype(int)
    comp["cluster_id"] = "NET-" + comp.root.str[1:]
    spark.createDataFrame(comp[["customer_id", "cluster_id", "cluster_size", "degree"]]) \
        .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.gold_customer_network")
    spark.sql(f"COMMENT ON TABLE {fq}.gold_customer_network IS 'Customer -> entity-resolution network cluster (connected components over gold_network_edges).'")

    spark.sql(f"""
    CREATE OR REPLACE TABLE {fq}.gold_network_clusters
    COMMENT 'Multi-party networks (size >= 3): members, 60-day cash deposited, sub-CTR deposits, wires to high-risk jurisdictions and open alerts.' AS
    WITH m AS (
      SELECT n.cluster_id, n.cluster_size, c.customer_id, c.customer_name
      FROM {fq}.gold_customer_network n JOIN {fq}.customers c USING (customer_id) WHERE n.cluster_size >= 3
    ), t AS (
      SELECT m.cluster_id,
             sum(CASE WHEN t.txn_type = 'cash_deposit' THEN t.amount END) AS cash_in_60d,
             sum(CASE WHEN t.cash_below_ctr THEN 1 ELSE 0 END) AS sub_ctr_deposits_60d,
             count(DISTINCT CASE WHEN t.txn_type = 'cash_deposit' THEN t.branch_id END) AS cash_branches_60d,
             sum(CASE WHEN t.txn_type = 'wire_out' AND t.high_risk_country THEN t.amount END) AS high_risk_wires_60d
      FROM m JOIN {fq}.transactions t ON t.customer_id = m.customer_id
      WHERE t.txn_ts >= (SELECT max(txn_ts) FROM {fq}.transactions) - INTERVAL 60 DAYS
      GROUP BY m.cluster_id
    ), al AS (
      SELECT m.cluster_id, count(*) AS open_alerts
      FROM m JOIN {fq}.alerts a ON a.customer_id = m.customer_id WHERE a.status IN ('open', 'in_review')
      GROUP BY m.cluster_id
    )
    SELECT m.cluster_id, first(m.cluster_size) AS cluster_size,
           collect_list(m.customer_name) AS member_names, collect_list(m.customer_id) AS member_ids,
           round(coalesce(first(t.cash_in_60d), 0), 2) AS cash_in_60d,
           coalesce(first(t.sub_ctr_deposits_60d), 0) AS sub_ctr_deposits_60d,
           coalesce(first(t.cash_branches_60d), 0) AS cash_branches_60d,
           round(coalesce(first(t.high_risk_wires_60d), 0), 2) AS high_risk_wires_60d,
           coalesce(first(al.open_alerts), 0) AS open_alerts
    FROM m LEFT JOIN t USING (cluster_id) LEFT JOIN al USING (cluster_id)
    GROUP BY m.cluster_id
    """)

    # ---- 3. alert features -------------------------------------------------
    spark.sql(f"""
    CREATE OR REPLACE TABLE {fq}.gold_alert_features
    COMMENT 'One row per TMS alert: 30-day behavioural, KYC and network features (the ML feature set) + label (sar_filed).' AS
    WITH a AS (
      SELECT al.*, CAST(al.lookback_end AS TIMESTAMP) + INTERVAL 1 DAY AS win_end,
             CAST(al.lookback_end AS TIMESTAMP) - INTERVAL 29 DAYS AS win_start
      FROM {fq}.alerts al
    ), tx AS (
      SELECT a.alert_id,
        sum(CASE WHEN t.cash_below_ctr THEN 1 ELSE 0 END) AS sub_ctr_cnt_30d,
        coalesce(sum(CASE WHEN t.cash_below_ctr THEN t.amount END), 0) AS sub_ctr_amt_30d,
        coalesce(sum(CASE WHEN t.txn_type = 'cash_deposit' THEN t.amount END), 0) AS cash_in_30d,
        count(DISTINCT CASE WHEN t.txn_type = 'cash_deposit' THEN t.branch_id END) AS cash_branches_30d,
        coalesce(sum(CASE WHEN t.txn_type = 'wire_out' AND t.high_risk_country THEN t.amount END), 0) AS hr_wire_out_30d,
        coalesce(sum(CASE WHEN t.txn_type IN ('cash_deposit','wire_in','internal_in','p2p_in') THEN t.amount END), 0) AS funds_in_30d,
        coalesce(sum(CASE WHEN t.txn_type IN ('wire_out','internal_out','p2p_out') THEN t.amount END), 0) AS funds_out_30d,
        count(*) AS txn_cnt_30d
      FROM a JOIN {fq}.transactions t ON t.customer_id = a.customer_id AND t.txn_ts >= a.win_start AND t.txn_ts < a.win_end
      GROUP BY a.alert_id
    ), prior AS (
      SELECT a.alert_id, count(p.alert_id) AS prior_alerts_90d
      FROM a LEFT JOIN {fq}.alerts p ON p.customer_id = a.customer_id AND p.alert_ts < a.alert_ts
            AND p.alert_ts >= a.alert_ts - INTERVAL 90 DAYS
      GROUP BY a.alert_id
    ), netal AS (  -- other parties of the same network with an alert in the prior 30 days
      SELECT a.alert_id, count(DISTINCT o.customer_id) AS network_parties_alerted_30d
      FROM a JOIN {fq}.gold_customer_network n ON n.customer_id = a.customer_id
             JOIN {fq}.gold_customer_network n2 ON n2.cluster_id = n.cluster_id AND n2.customer_id <> a.customer_id
             JOIN {fq}.alerts o ON o.customer_id = n2.customer_id AND o.alert_ts <= a.alert_ts AND o.alert_ts >= a.alert_ts - INTERVAL 30 DAYS
      GROUP BY a.alert_id
    )
    SELECT a.alert_id, a.customer_id, a.alert_ts, a.scenario, a.rule_score, a.status,
           CASE WHEN a.status = 'sar_filed' THEN 1 WHEN a.status = 'closed_no_sar' THEN 0 END AS label,
           coalesce(tx.sub_ctr_cnt_30d, 0) AS sub_ctr_cnt_30d, round(coalesce(tx.sub_ctr_amt_30d, 0), 2) AS sub_ctr_amt_30d,
           round(coalesce(tx.cash_in_30d, 0), 2) AS cash_in_30d, coalesce(tx.cash_branches_30d, 0) AS cash_branches_30d,
           round(coalesce(tx.hr_wire_out_30d, 0), 2) AS hr_wire_out_30d,
           round(coalesce(tx.funds_in_30d, 0), 2) AS funds_in_30d, round(coalesce(tx.funds_out_30d, 0), 2) AS funds_out_30d,
           round(coalesce(tx.funds_out_30d, 0) / greatest(coalesce(tx.funds_in_30d, 0), 1000), 3) AS pass_through_ratio,
           round(coalesce(tx.cash_in_30d, 0) / greatest(c.expected_monthly_cash, 500), 2) AS cash_vs_expected,
           datediff(a.alert_ts, c.onboarding_date) AS account_age_days,
           CASE c.kyc_risk_rating WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END AS kyc_risk_level,
           CAST(c.pep_flag AS INT) AS pep_flag, CAST(c.customer_type = 'business' AS INT) AS is_business,
           n.cluster_size AS network_size, n.degree AS network_degree,
           coalesce(netal.network_parties_alerted_30d, 0) AS network_parties_alerted_30d,
           coalesce(prior.prior_alerts_90d, 0) AS prior_alerts_90d
    FROM a JOIN {fq}.customers c ON c.customer_id = a.customer_id
    JOIN {fq}.gold_customer_network n ON n.customer_id = a.customer_id
    LEFT JOIN tx ON tx.alert_id = a.alert_id
    LEFT JOIN prior ON prior.alert_id = a.alert_id
    LEFT JOIN netal ON netal.alert_id = a.alert_id
    """)

    # ---- 4. app write-back tables (never overwritten) ------------------------
    spark.sql(f"""CREATE TABLE IF NOT EXISTS {fq}.case_decisions (
        decision_id STRING, alert_id STRING, customer_id STRING, cluster_id STRING, related_alert_ids ARRAY<STRING>,
        decision STRING COMMENT 'file_sar | close_no_sar | escalate', rationale STRING, sar_narrative STRING,
        amount_involved DOUBLE, bsa_filing_ref STRING, decided_by STRING, decided_ts TIMESTAMP, detection_ts TIMESTAMP,
        days_to_decision INT)
      COMMENT 'Investigator decisions written back by the AML Copilot app (file SAR / close / escalate).'""")
    spark.sql(f"""CREATE TABLE IF NOT EXISTS {fq}.case_audit_log (
        event_id STRING, alert_id STRING, event_type STRING, actor STRING, detail STRING, event_ts TIMESTAMP)
      COMMENT 'Immutable audit trail of every investigator / agent action in the AML Copilot app.'""")
    spark.sql(f"""CREATE TABLE IF NOT EXISTS {fq}.sar_drafts (
        draft_id STRING, alert_id STRING, narrative STRING, recommendation STRING, red_flags ARRAY<STRING>,
        model STRING, tool_calls INT, created_by STRING, created_ts TIMESTAMP)
      COMMENT 'SAR narrative drafts generated by the investigator copilot agent.'""")
    for t in ["gold_network_edges", "gold_customer_network", "gold_network_clusters", "gold_alert_features"]:
        print(t, spark.table(f"{fq}.{t}").count())


if __name__ == "__main__":
    main()

"""
UEBA — user & host behaviour anomaly scoring (Isolation Forest, registered in Unity Catalog).

  1. Feature engineering in SQL: one row per user-day / host-day over the 90-day window
     (sign-in failures, MFA denials, sign-ins from unfamiliar ASNs / countries, off-hours activity,
     unmanaged-device VPN, RDP to hosts the user doesn't own, discovery commands, file-read volume;
     for hosts: high-entropy DNS, rare-domain lookups, inbound RDP from VPN, archive/staging events).
  2. Train an IsolationForest per entity type on the full population, log to MLflow, register
     <catalog>.<schema>.ueba_user_model / ueba_host_model with alias @champion.
  3. Score every entity-day → risk_score 0-100 + the top contributing factors (z-score vs the
     population that day) → ueba_user_daily, ueba_host_daily.
  4. Raise the open investigation queue → investigation_leads (the entities whose 7-day peak risk
     is highest; lead ids assigned in risk order, L-1042 = the top user).

    python train_ueba.py --catalog cybersecurity --schema threat_hunting_copilot \
        --experiment "/Shared/pubsec-cyber-threat-hunting/ueba_experiment"
"""
from __future__ import annotations

import argparse

import mlflow
import numpy as np
import pandas as pd
from mlflow.models import infer_signature
from sklearn.ensemble import IsolationForest
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer

from pyspark.sql import SparkSession


def get_spark() -> SparkSession:
    try:
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    from databricks.connect import DatabricksSession  # type: ignore

    return DatabricksSession.builder.serverless(True).getOrCreate()


USER_FEATURES = {  # feature -> human label for "top factors"
    "failed_signins": "failed sign-ins",
    "mfa_denied": "MFA pushes denied / timed out",
    "unfamiliar_asn_success": "successful sign-ins from an unfamiliar network (hosting / foreign ASN)",
    "foreign_country_success": "successful sign-ins from outside the US",
    "offhours_success": "successful sign-ins between 22:00 and 06:00",
    "new_mfa_device": "new authenticator device registered",
    "vpn_unmanaged_min": "VPN minutes from an unmanaged device",
    "rdp_nonowned_hosts": "RDP logons to hosts the user does not own",
    "discovery_cmds": "domain discovery commands (net / nltest / whoami)",
    "files_read": "files read on file servers",
}
HOST_FEATURES = {
    "high_entropy_dns": "DNS lookups with high-entropy labels (possible tunneling)",
    "txt_queries": "DNS TXT lookups",
    "rare_domains": "lookups of domains no other host resolves",
    "vpn_rdp_in": "inbound RDP from VPN address space",
    "staging_writes": "large archive / executable writes in user-writable folders",
}


def user_features_sql(fqs: str) -> str:
    return f"""
    WITH days AS (SELECT explode(sequence(date_sub(max(date(event_ts)), 89), max(date(event_ts)))) AS d FROM {fqs}.auth_logs),
    grid AS (SELECT u.user_id, days.d FROM {fqs}.identities u CROSS JOIN days),
    a AS (SELECT user_id, date(event_ts) d,
            sum(IF(failure_reason = 'invalid_password', 1, 0)) failed_signins,
            sum(IF(mfa_result IN ('denied', 'timeout'), 1, 0)) mfa_denied,
            sum(IF(result = 'success' AND asn NOT IN ('AS64496', 'AS64497'), 1, 0)) unfamiliar_asn_success,
            sum(IF(result = 'success' AND geo_country <> 'US', 1, 0)) foreign_country_success,
            sum(IF(result = 'success' AND (hour(event_ts) >= 22 OR hour(event_ts) < 6), 1, 0)) offhours_success,
            sum(IF(application = 'Authenticator device registration', 1, 0)) new_mfa_device
          FROM {fqs}.auth_logs GROUP BY ALL),
    v AS (SELECT user_id, date(session_start) d,
            sum(IF(NOT device_managed, (unix_timestamp(session_end) - unix_timestamp(session_start)) / 60, 0)) vpn_unmanaged_min
          FROM {fqs}.vpn_sessions GROUP BY ALL),
    e AS (SELECT e.user_id, date(e.event_ts) d,
            count(DISTINCT IF(e.event_type = 'logon' AND e.logon_type = 10 AND coalesce(s.owner_user_id, '') <> e.user_id
                              AND e.host_id <> 'SRV-MGMT-01', e.host_id, NULL)) rdp_nonowned_hosts,
            sum(IF(e.process_name IN ('net.exe', 'nltest.exe', 'whoami.exe'), 1, 0)) discovery_cmds,
            sum(IF(e.event_type = 'file_read' AND e.user_id NOT LIKE 'svc_%', e.file_count, 0)) files_read
          FROM {fqs}.endpoint_events e LEFT JOIN {fqs}.assets s ON s.host_id = e.host_id GROUP BY ALL)
    SELECT g.user_id, g.d AS score_date,
      {", ".join(f"coalesce({c}, 0) AS {c}" for c in USER_FEATURES)}
    FROM grid g LEFT JOIN a USING (user_id, d) LEFT JOIN v USING (user_id, d) LEFT JOIN e USING (user_id, d)"""


def host_features_sql(fqs: str) -> str:
    return f"""
    WITH days AS (SELECT explode(sequence(date_sub(max(date(event_ts)), 89), max(date(event_ts)))) AS d FROM {fqs}.dns_logs),
    grid AS (SELECT h.host_id, days.d FROM {fqs}.assets h CROSS JOIN days),
    dom AS (SELECT regexp_extract(query, '([a-z0-9-]+\\\\.[a-z]+)$', 1) AS domain, count(DISTINCT host_id) hosts
            FROM {fqs}.dns_logs GROUP BY 1),
    n AS (SELECT l.host_id, date(l.event_ts) d,
            sum(IF(l.label_entropy > 3.5 AND length(split(l.query, '\\\\.')[0]) >= 12, 1, 0)) high_entropy_dns,
            sum(IF(l.query_type = 'TXT', 1, 0)) txt_queries,
            count(DISTINCT IF(dom.hosts = 1, dom.domain, NULL)) rare_domains
          FROM {fqs}.dns_logs l LEFT JOIN dom ON dom.domain = regexp_extract(l.query, '([a-z0-9-]+\\\\.[a-z]+)$', 1) GROUP BY ALL),
    e AS (SELECT host_id, date(event_ts) d,
            sum(IF(event_type = 'logon' AND logon_type = 10 AND src_ip LIKE '10.200.%', 1, 0)) vpn_rdp_in,
            sum(IF(event_type = 'file_write' AND file_path LIKE 'C:\\\\\\\\Users\\\\\\\\Public%', 1, 0)) staging_writes
          FROM {fqs}.endpoint_events GROUP BY ALL)
    SELECT g.host_id, g.d AS score_date,
      {", ".join(f"coalesce({c}, 0) AS {c}" for c in HOST_FEATURES)}
    FROM grid g LEFT JOIN n USING (host_id, d) LEFT JOIN e USING (host_id, d)"""


def train_and_score(pdf: pd.DataFrame, feats: dict, key: str, model_name: str, exp: str):
    X = pdf[list(feats)].astype(float)
    pipe = Pipeline([("log1p", FunctionTransformer(np.log1p)),
                     ("iforest", IsolationForest(n_estimators=300, max_samples=4096, random_state=42))])
    mlflow.set_experiment(exp)
    with mlflow.start_run(run_name=f"{model_name.split('.')[-1]}"):
        pipe.fit(X)
        raw = -pipe.score_samples(X)  # higher = more anomalous
        mlflow.log_params({"model": "IsolationForest", "n_estimators": 300, "features": ",".join(feats), "rows": len(X)})
        sig = infer_signature(X.head(50), pipe.score_samples(X.head(50)))
        kw = dict(name="model", signature=sig, registered_model_name=model_name, input_example=X.head(3))
        try:  # mlflow >= 3.x serializes sklearn with skops and asks us to trust the tree node storage
            mlflow.sklearn.log_model(pipe, skops_trusted_types=["sklearn.tree._tree.Tree", "numpy.log1p"], **kw)
        except TypeError:
            mlflow.sklearn.log_model(pipe, **kw)
    pdf["anomaly_score"] = raw.round(4)
    # top factors: z-score of each feature vs the population on the same day
    z = pd.DataFrame(index=pdf.index)
    for f in feats:
        g = pdf.groupby("score_date")[f]
        z[f] = (pdf[f] - g.transform("mean")) / (g.transform("std").replace(0, np.nan))
    z = z.fillna(0)

    def factors(i):
        zs = z.loc[i].sort_values(ascending=False)
        out = []
        for f, v in zs.items():
            if v < 3 or pdf.at[i, f] <= 0 or len(out) == 3:
                continue
            val = pdf.at[i, f]
            out.append(f"{int(round(val)):,} {feats[f]}")
        return out

    # Risk 0-100 = breadth (how many behaviours deviate > 3 sigma from the population that day), scaled
    # by the Isolation Forest percentile (how isolated the whole day is). A single odd behaviour (one
    # failed sign-in, one admin command) caps near 50; several deviating at once is what scores high.
    n_dev = ((z >= 3) & (pdf[list(feats)] > 0)).sum(axis=1)
    pct = pd.Series(raw).rank(pct=True).values
    pdf["deviating_behaviours"] = n_dev.astype(int)
    pdf["risk_score"] = (100 * (1 - 0.5 ** n_dev) * (0.6 + 0.4 * pct)).round(1)
    pdf["top_factors"] = [factors(i) if pdf.at[i, "risk_score"] >= 40 else [] for i in pdf.index]
    return pdf


def set_champion(model_name: str):
    from mlflow import MlflowClient

    c = MlflowClient()
    v = max(int(m.version) for m in c.search_model_versions(f"name='{model_name}'"))
    c.set_registered_model_alias(model_name, "champion", str(v))
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="cybersecurity")
    ap.add_argument("--schema", default="threat_hunting_copilot")
    ap.add_argument("--experiment", default="/Shared/pubsec-cyber-threat-hunting/ueba_experiment")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    mlflow.set_registry_uri("databricks-uc")
    try:
        mlflow.set_tracking_uri("databricks")
    except Exception:
        pass

    users = spark.sql(user_features_sql(fqs)).toPandas()
    hosts = spark.sql(host_features_sql(fqs)).toPandas()
    print(f"features: {len(users):,} user-days, {len(hosts):,} host-days")
    users = train_and_score(users, USER_FEATURES, "user_id", f"{fqs}.ueba_user_model", args.experiment)
    hosts = train_and_score(hosts, HOST_FEATURES, "host_id", f"{fqs}.ueba_host_model", args.experiment)
    print("champion versions:", set_champion(f"{fqs}.ueba_user_model"), set_champion(f"{fqs}.ueba_host_model"))

    for name, pdf, comment in [
        ("ueba_user_daily", users, "UEBA per user per day: behaviour features, Isolation Forest anomaly_score, risk_score 0-100 and top contributing factors (model ueba_user_model@champion)."),
        ("ueba_host_daily", hosts, "UEBA per host per day: DNS / endpoint features, anomaly_score, risk_score 0-100 and top factors (model ueba_host_model@champion)."),
    ]:
        sdf = spark.createDataFrame(pdf)
        sdf.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fqs}.{name}")
        spark.sql(f"COMMENT ON TABLE {fqs}.{name} IS '{comment}'")
        print(f"  wrote {fqs}.{name}")

    # ── investigation leads: highest 7-day peak risk (users + hosts) ──
    spark.sql(f"""
    CREATE OR REPLACE TABLE {fqs}.investigation_leads COMMENT 'Open threat-hunting leads raised by UEBA (7-day peak risk >= 55): one row per entity. Mirrored into the app (Lakebase) as the analyst queue.' AS
    WITH mx AS (SELECT max(score_date) m FROM {fqs}.ueba_user_daily),
    u AS (SELECT 'user' entity_type, d.user_id entity_id, i.display_name, i.department, i.title AS role,
                 max(d.risk_score) risk_7d_max, max_by(d.top_factors, struct(d.risk_score, d.score_date)) top_factors,
                 min(IF(d.risk_score >= 55, d.score_date, NULL)) first_flagged,
                 transform(sort_array(collect_list(struct(d.score_date, d.risk_score))), x -> x.risk_score) risk_trend
          FROM {fqs}.ueba_user_daily d JOIN {fqs}.identities i USING (user_id), mx
          WHERE d.score_date > date_sub(mx.m, 14) GROUP BY ALL),
    h AS (SELECT 'host' entity_type, d.host_id entity_id, d.host_id display_name, a.location department, a.description AS role,
                 max(d.risk_score) risk_7d_max, max_by(d.top_factors, struct(d.risk_score, d.score_date)) top_factors,
                 min(IF(d.risk_score >= 55, d.score_date, NULL)) first_flagged,
                 transform(sort_array(collect_list(struct(d.score_date, d.risk_score))), x -> x.risk_score) risk_trend
          FROM {fqs}.ueba_host_daily d JOIN {fqs}.assets a USING (host_id), mx
          WHERE d.score_date > date_sub(mx.m, 14) GROUP BY ALL),
    peak7 AS (SELECT entity_type, entity_id, max(risk_score) p FROM (
                SELECT 'user' entity_type, user_id entity_id, risk_score, score_date FROM {fqs}.ueba_user_daily
                UNION ALL SELECT 'host', host_id, risk_score, score_date FROM {fqs}.ueba_host_daily), mx
              WHERE score_date > date_sub(mx.m, 7) GROUP BY ALL),
    al AS (SELECT coalesce(entity_user, entity_host) entity_id, count(*) linked_alerts,
                  sum(IF(disposition = 'false_positive', 1, 0)) alerts_closed_fp
           FROM {fqs}.siem_alerts, mx WHERE date(created_ts) > date_sub(mx.m, 14) GROUP BY ALL),
    all_ AS (SELECT x.*, p.p AS risk_score FROM (SELECT * FROM u UNION ALL SELECT * FROM h) x
             JOIN peak7 p USING (entity_type, entity_id) WHERE p.p >= 55)
    SELECT concat('L-', CAST(1041 + row_number() OVER (ORDER BY risk_score DESC, entity_id) AS STRING)) lead_id,
           entity_type, entity_id, display_name, department, role, risk_score, top_factors, first_flagged, risk_trend,
           coalesce(al.linked_alerts, 0) linked_alerts, coalesce(al.alerts_closed_fp, 0) alerts_closed_fp,
           CASE WHEN risk_score >= 85 THEN 'critical' WHEN risk_score >= 70 THEN 'high' ELSE 'medium' END priority,
           'open' status
    FROM all_ LEFT JOIN al USING (entity_id)""")
    for r in spark.sql(f"SELECT lead_id, entity_type, entity_id, risk_score, top_factors FROM {fqs}.investigation_leads ORDER BY lead_id").collect():
        print(" ", r.lead_id, r.entity_type, r.entity_id, r.risk_score, r.top_factors[:2] if r.top_factors else [])


if __name__ == "__main__":
    main()

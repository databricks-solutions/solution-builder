# 03 — Live-ops dashboard + Genie

## AI/BI dashboard `Hollowspire - Season 7 Live-Ops & Player Retention` (`dashboard/liveops_retention.lvdash.json`)
Schema-less datasets (rebound by the DAB `dataset_catalog` / `dataset_schema`), embedded credentials, region filter.
KPIs: D7 Season 6 vs 7, ARPDAU, LTV at risk, players at risk, interventions scheduled. Charts: D7 by install week (season
colour), DAU, ARPDAU by region, 14-day churn by cohort (new vs veteran), Season 7 stage clear rate, ranked queue wait by
region, LTV at risk by driver × region, moderation queue by AI label, holdout lift by intervention; tables: live-ops
calendar (scheduled + past measured runs), at-risk segments.

## Genie space `Hollowspire - Season 7 Live-Ops and Player Retention` (`genie/genie_space.json`, serialized v2)
17 tables (sorted), text instructions (metric definitions: cohort rates = SUM/SUM over mature rows, ARPDAU = SUM(revenue)/
SUM(dau) over steady-state windows, queue-weighted waits, AI labels, model outputs), 8 sample questions each with a
verified example SQL (answers listed in the README).

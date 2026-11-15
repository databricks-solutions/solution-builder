# 04 — AI/BI dashboard, Genie agent (tables + NOC runbooks)

## Dashboard "Halcyon NOC - Network Operations" (`dashboard/noc_network_ops.lvdash.json`, schema-less datasets)
Counters (sites down, subscribers on down sites, % sites in service, alarms 24 h, open incidents, silent degradations) · alarms per hour 48 h by market · sites down per hour · sites down by aggregation router · incident queue table · anomaly-model table · slow-burn line (dropped-call rate per sector of the most degraded site) · MTTR by ticket category · % outages with an ignored early warning (ai_classify) · duplicate per-site tickets per month.

## Genie agent "Halcyon NOC - Network Operations" (`src/genie/genie_space.json`, serialized v2)
15 tables; instructions define "now" = latest data (gold_site_status / max timestamps), down = `is_down`, dropped-call rate, thresholds. Sample questions (with example SQL): which router has the most sites down; subscribers + enterprise accounts on down sites; biggest dropped-call increase over 3 weeks; MTTR by category; share of outages with an ignored early warning; alarms in 24 h by severity.

## Documents — the agent's `noc_runbooks` volume (`src/noc_runbooks/*.md`, answered in Agent mode)
RB-1 priority/SLAs/notification · RB-2 alarm storms · RB-3 transport (optical thresholds, fiber cut vs optic, dual-path restoration) · RB-4 power/generator · RB-5 KPI degradation (VSWR, interference, congestion) · RB-6 closing as explained · RB-7 action catalog A-01..A-10 + dispatch.

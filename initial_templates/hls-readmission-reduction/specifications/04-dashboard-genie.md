# 04 — AI/BI dashboard + Genie space

**Dashboard** "Larkspur Health - Readmissions & HRRP Exposure" (`dashboard/readmissions_hrrp.lvdash.json`, schema-less datasets,
`dataset_catalog`/`dataset_schema` injected by the bundle, embedded credentials):
1. *Readmissions overview* — 4 West HF rate last 26 wk vs before, weekend follow-up %, system rate, HRRP penalty (12 mo and HF run
   rate); monthly HF trend 4 West vs rest; HF change by unit; 4 West follow-up % and readmission % by weekday (before vs last 26 wk);
   follow-up effect by condition; note-only social risks (AI Functions).
2. *HRRP exposure* — penalty by hospital, ERR by hospital × condition (12 mo / 6 mo), detail table.
3. *Worklist* — open discharges ranked by risk.

**Genie space** "Larkspur Health - Readmissions & Care Transitions" (`src/genie/genie_space.json`, serialized v2, tables sorted):
12 tables incl. gold_discharges, hrrp_performance, hrrp_penalty_estimate, transition_worklist, unit_events; text instructions
(rate definition on closed windows, weekend = Fri-Sun, 4 West = LRMC-4W, ERR caveat); 7 sample questions; 8 verified example SQLs.

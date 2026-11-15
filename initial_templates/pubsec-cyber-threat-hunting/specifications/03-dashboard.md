# 03 — AI/BI dashboard "Cascadia SOC - Threat Hunting & Detection Performance"

`dashboard/soc_threat_hunting.lvdash.json` (schema-less datasets, rebound by `dataset_catalog/dataset_schema`), 18 widgets.

**Page 1 — SOC performance (CISO):** counters (MTTD all incidents h, MTTD identity & data days, MTTR h, alerts 90 d,
TP rate %, playbook techniques without detection), MTTD by month (identity & data vs other), MTTD by category,
weekly alert volume vs true positives, detection-rule efficacy table, ATT&CK coverage by tactic.

**Page 2 — Threat hunting:** accounts hit daily by failed passwords from hosting networks (max 1/account/day), failed
passwords by network, open UEBA leads table, UEBA daily risk for the top user leads, hosts with high-entropy DNS.

Published with embedded credentials; `check_dash.py` → 11 datasets OK, 0 faults.

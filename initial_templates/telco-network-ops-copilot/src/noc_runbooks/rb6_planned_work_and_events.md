# Halcyon Wireless NOC Runbook — Chapter RB-6: Planned work, events and weather — closing as explained

An incident may be **closed as explained** (action A-10, no dispatch) only when ALL of the following hold:
1. A matching record exists in planned_activity (maintenance window with change number, local event, weather advisory) covering the site/node AND the alarm time.
2. The alarms have **cleared** (or the KPIs are back to baseline) — record the clear time.
3. No customer-affecting residue: availability back above 99% and no new alarms after the window.
4. The change number / event id / advisory id is written on the closure notes.

Typical explained patterns:
- **Maintenance window**: cell unavailable during an approved software upgrade that ended inside the window.
- **Local event**: congestion (PRB > 90%, RRC setup success down) at a stadium during a concert, with a cell on wheels (COW) deployed.
- **Weather**: microwave RSL low / link down during a severe-weather advisory that recovered without intervention (rain fade). If the same link fades more than 3 times in 30 days, open a P3 to review the link budget.

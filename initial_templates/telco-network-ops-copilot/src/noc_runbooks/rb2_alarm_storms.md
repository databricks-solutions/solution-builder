# Halcyon Wireless NOC Runbook — Chapter RB-2: Alarm storms and correlation

## RB-2.1 What an alarm storm is
An alarm storm is 10 or more cell sites alarming within 15 minutes under the **same parent** (aggregation router, microwave hub, or power feed). The per-site alarms (S1 link down, X2 link down, PTP sync loss, cell unavailable, cell-site-router BFD down) are **symptoms**; the cause is almost always upstream of the site.

## RB-2.2 Procedure
1. Identify the common parent from topology (cell_sites.agg_router_id). If every alarming site shares one aggregation router, work the router first — do NOT dispatch to individual cell sites.
2. Check which sites under the parent stayed UP. Sites that survive usually have a diverse backup path (e.g. microwave). Survivors confirm the fault is on the router's uplinks, not on the router's site-facing side.
3. Read the router's own transport alarms in time order. The earliest transport alarm is the trigger; later ones are consequences.
4. Open **one parent trouble ticket** for the root cause and **suppress the child alarms** under it (action A-01). Historically, storms handled site by site opened one ticket per site, sent technicians to healthy sites and added hours to restoration.
5. Declare priority per RB-1.1 (a router isolation with 20+ sites is P1).

## RB-2.3 Child-alarm suppression
Child alarms stay visible under the parent ticket; they are suppressed from the tier-1 queue only. When the parent is restored, verify every child site returns (availability > 99% for 15 minutes) before closing.

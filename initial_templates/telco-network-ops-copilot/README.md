# NOC Copilot — alarm correlation, KPI anomaly detection & agentic triage (Telecom)

**Customer (fictional):** Halcyon Wireless — Mountain-West regional carrier, 500 cell sites / 1,500 cells in Denver Metro,
Boulder, Fort Collins, Colorado Springs and Pueblo, 14 aggregation routers backhauled to two core routers.

## The story
At **05:55** the Denver NOC gets **457 alarms from 64 cell sites in eight minutes** — S1 down, X2 down, PTP sync loss, cells
unavailable. About **99,748 subscribers** are off air, including a hospital campus and a backup 911 center (both platinum SLA,
4-hour restore, 30-minute notification). Worked the old way, that is 64 tickets and 64 truck rolls to healthy sites.

- A **Lakeflow Spark Declarative Pipeline** streams hourly RAN KPIs, alarm events and 15-minute optical counters from a volume
  landing zone (Auto Loader) → bronze → silver (expectations, topology join) → gold (cell KPIs, site status, alarm windows).
- **Topology correlation** turns the storm into **one incident**: every down site hangs off aggregation router **AGG-DEN-04**;
  the 4 sites that stayed up have a microwave backup path.
- The **triage agent** walks the topology and finds **two failures**: an 811 boring crew cut the **primary fiber** (LOS on both
  ends of LNK-0407 at 05:55:12), and the **backup optic** (LNK-0408) had been losing light for 12 days (−7.8 → −21.6 dBm) behind
  four "Rx power low" warnings that were auto-acknowledged and never ticketed. Under failover load it threw 184k CRC errors and
  dropped at 05:57:40. The **NOC runbook** (searched by the Genie agent) says to restore the fastest path first: a transport tech cleans or
  replaces the backup optic (~1 h) while the splice crew heads to the cut (~5 h).
- Meanwhile a **KPI anomaly model** (Isolation Forest, registered in Unity Catalog) flags **BLD-047-B** in Boulder: dropped-call
  rate crept from 0.6% to 2.6% over three weeks while VSWR climbed to 1.84, under the 2.0 alarm threshold. No alarm ever fired.
- The engineer opens **one parent trouble ticket** (457 child alarms suppressed) with the dispatch, written back to **Lakebase**.
  Leadership sees availability, alarm volume, MTTR and "outages with an ignored early warning" (**ai_classify** on 12 months of
  ticket notes) in an **AI/BI dashboard** and **Genie**.

**Personas:** Dana Whitfield (NOC shift lead, drives the app) · Marcus Reyes (VP Network Operations, dashboard + Genie).

## Demo script (~12 minutes) — every answer below is what the deployed app returned
**Before you start:** click **Reset the demo** in the header (clears tickets, triages and chats, re-syncs the queue).

1. **Home** — the NOC wall. The red banner names the storm (**64 / 500 sites down**, **457 alarms since 05:55**); the vitals row shows **99,748 subscribers off air**, **586 alarms in 24 h** correlated into **7 incidents**. The map plots every cell site on OpenStreetMap, the timeline shows the storm against the rest of the network, and the topology panel shows why (primary fiber LOS, secondary optic degrading).
2. **Ask the NOC Copilot** (dock, first suggestion): *"Which aggregation router has the most cell sites down right now, and how
   many subscribers are affected?"* → **"AGG-DEN-04 — 64 sites down, 99,748 subscribers affected."** (Genie, latest data 08:00).
3. Second chip: *"Which enterprise accounts are on the sites that are down, and how fast does the runbook say we must notify
   them?"* → 5 accounts (Front Range Regional Hospital and Jefferson Emergency Communications **platinum**, Mile High Metro
   Transit and Summit Logistics Park **gold**, Wheat Ridge Unified Schools **silver**); notify **platinum within 30 min, gold within
   60 min, silver within 4 h** (Genie + NOC runbook).
4. **Incident queue** — *"This is not a list of alarms, it's a list of root-cause candidates."* P1 **INC-24417 Alarm storm: 64 cell
   sites down under AGG-DEN-04** (457 alarms, 5 enterprise accounts, Hospital + 911 PSAP), plus a P2 site on battery, three KPI
   anomalies with **no alarm** and two cleared incidents.
5. Open **INC-24417**. The **blast radius**: 64 red tiles, 4 green (*MW backup*: DEN-133/147/162/179); DEN-150 (hospital) and
   DEN-166 (911) ringed. Click **Triage this incident** — the steps stream (~70 s, ~13 governed SQL / runbook calls): correlated
   incident → topology → alarm history (4 auto-acknowledged optical warnings) → optics on AGG-DEN-04 and CORE-DEN-01 → customer
   impact → 811 notices → runbook ×3 → field technicians.
   **Result:** *Root cause identified, P1* — "Fiber cut on LNK-0407 primary path to AGG-DEN-04; secondary path failed under load
   due to degraded optics; 64 sites down, 99,748 subscribers impacted." Root cause **LNK-0407 primary fiber span (W 38th Ave &
   Sheridan Blvd)** — 811 ticket **CO811-262710455**; restore **~1 h** (secondary optic replacement) / splice ~5 h. Timeline with the
   ignored warnings from 3 days ago, action plan **A-01** (one parent ticket, suppress child alarms), **A-06** (major-incident
   bridge), **A-03** (transport tech to Wheat Ridge Hut), **A-02** (splice crew to the cut), **A-05** (notify platinum accounts);
   dispatch **Priya Natarajan** (transport, 25 min), **Ray Delgado** and **Marisol Vega** (OSP splicing, 25 min).
6. Click **Open trouble ticket & dispatch 3 technicians** → green banner *"Trouble ticket TT-2026-41318 opened (P1) · 3 technicians
   dispatched · 457 child alarms suppressed — written to Lakebase"*. Show **Tickets & dispatch**.
7. Back to the queue → **INC-24411 BLD-047-B Table Mesa / US-36: KPI anomaly, no alarm** (Home, *Silent degradation* panel). Left:
   sector B's dropped-call rate climbs across the 2.0% line while A and C stay flat; VSWR rises to 1.84 under the 2.0 alarm.
   **Triage** (~60 s) → *Root cause identified, P2* (raised from P3 per RB-5.2: >2% drop on a >2,500-subscriber sector with a gold
   account) — sector B antenna jumper/feeder, water ingress or loose connector; 3,400 subscribers incl. **Flatirons University
   (gold)**; care complaints doubled; dispatch tower crew **Cole Brennan + Nadia Farouk** (20 min), restore ~3–4 h. Open the ticket.
8. Optional benign case: **INC-24413 DEN-205 (3 cells) Stadium District** → Triage → *Explained — P3*: concert **EVT-2291**
   (55,000 attendees), KPIs back to baseline the next day → **Close as explained** (evidence written to Lakebase).
9. **Network analytics** — the storm as one 10-minute spike (457 alarms), the slow-burn sector chart, and the ai_classify table:
   **61.5% of optics-degradation outages and ~45% of RF-hardware outages had an early warning that was ignored.**
10. **Ops dashboard** (embedded AI/BI) and the Genie space for Marcus: *"What share of outages had an early warning that was
    ignored, by category?"* → optics_degradation 61.5% (56 of 91), rf_hardware 45.3%, power 27.8%.

**Genie sample questions** (all answered correctly via the conversation API): router with the most sites down (AGG-DEN-04, 64 of
68, 99,748 subscribers) · subscribers + enterprise accounts on down sites · biggest dropped-call increase over 3 weeks (BLD-047-B
0.7% → 2.5%) · MTTR by category (interference 33.3 h, rf_hardware 10.9 h, fiber_cut 6.6 h…) · ignored early warnings by category.

## What's in this folder
`data_generation/` synthetic data + raw telemetry · `src/pipeline/` SDP SQL · `src/ml/` anomaly model · `src/correlation/` incident
queue + ai_classify · `src/noc_runbooks/` runbook documents · `src/genie/`, `src/deploy/` setup notebooks ·
`dashboard/` · `app/` NOC Copilot (see `app/README.md`) · `specifications/` · `architecture.md` · `databricks.yml` · `dab_instructions.md`.

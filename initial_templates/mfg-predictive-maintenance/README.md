# TechRobotics Industries — Predictive Maintenance Control Room

> **The model says *when* a machine will fail. The copilot says *why*, and *who else*, then books the fix.**

TechRobotics Industries (fictional) makes precision servo actuators in its Greenville, SC Plant 2. The plant runs 48 assets on three lines. Line 2, robotic assembly, is paced by one robot, **RA-207**, and every hour RA-207 is down costs **$12,800**.

This demo is the reliability engineer's control room. It is built on Databricks and brings together:

- sensor telemetry
- a failure-risk model trained on a year of history and registered in Unity Catalog, which scores the whole fleet
- the CMMS maintenance history
- the plant's own manuals (engineering standards, CAPA reports and the contractor scope of work), searched by the Genie agent

An agent uses all of this to explain *why* an asset is at risk. It then **writes the fix back**: work orders, reserved parts and booked maintenance-window hours in Lakebase, with the downtime cost avoided. The plant manager watches OEE, unplanned downtime and MTBF in an AI/BI dashboard and asks follow-up questions in Genie.

**How this differs from the other demos in this set.** The dbdemos *IOT wind-turbine predictive maintenance* dashboards and the *lakehouse-iot-platform* notebooks stop at "the model flags a turbine". This demo goes past the score:

- **root cause**, from sensor drift plus maintenance history plus the manuals
- **fleet scoping**, which finds the robots the model can't see yet
- **transactional write-back**: work order, parts and window booking
- **cost avoided**, calculated the way the plant's standard defines it (MPS-004)

## The story (planted in the data)

- **Line 2 OEE fell from ~79% to ~73% in two weeks.** RA-207 is running slower and producing more scrap, and because it paces the line, every station behind it is starved.
- **`failure_risk_model@champion` scores RA-207 at 94.** That is the Critical tier, with about 3.5 days to failure. The drivers:
  - J3 vibration at **2.6× its own baseline** (3.96 vs 1.53 mm/s)
  - temperature **+11 °C**
  - still rising
- **The why.** The drift started right after RA-207's quarterly grease PM (WO-20273). A contractor, Carolina Industrial Services, did that PM and **substituted Mobilgrease XHP 222 (EP2)** because the OEM grease, Vigo RE0, was backordered.
  - The plant standard **ES-ROB-014** says "Vigo RE0 ONLY" and describes exactly these symptoms.
  - **CAPA-0117** records that **RA-203 seized the same way 6 months ago**, with 14.2 hours of unplanned downtime.
- **Who else.** The same contractor visit greased **RA-211**, which is drifting on the same curve about two weeks behind (Watch 38), and **RA-214**, greased 5 days ago. RA-214 shows no drift yet, so **the model rates it Healthy (1)**. Only the maintenance history exposes it.
- **The fix.** All three jobs fit Saturday's Line 2 planned window (16 crew-hours):
  - an 8-hour J3 reducer replacement on RA-207
  - two 3-hour RE0 grease purges, on RA-211 and RA-214
  - Parts: the reducer and seal kit come from the plant crib. The RE0 grease comes by 1-day transfer from the Charlotte DC, because the crib has none.
  - **Result: ~$210K risk-weighted unplanned cost avoided, ~$186–189K net.**

## Personas

| Persona | Role | Surface |
|---|---|---|
| **Marcus Chen**, Plant Reliability Engineer | owns asset uptime and the maintenance plan | PdM Control Room app + copilot |
| **Dana Ortiz**, Plant Manager | OEE, downtime cost, MTBF | AI/BI dashboard + Genie |
| Maintenance planner / technicians | execute the work orders | Work orders page (Start / Complete / Cancel) |

## Demo script (≈ 8 minutes). These are the exact clicks.

**Before you start:** click **Reset the demo with Lakebase Branching** in the app header. This clears the work orders and re-syncs from Delta.

1. **Open the app.** The **Control room** (plant-floor HMI) shows:
   - the status strip: 1 Critical, 2 Watch, ~$224K downtime at risk, $0 avoided
   - the **priority-asset** panel for RA-207 (J3 reducer bearing wear, ~4 days on the RUL gauge)
   - the **production-line schematic**, where RA-207's red machine tile carries a BN (bottleneck) badge
2. **Click the RA-207 tile.** The asset drawer opens.
   - **Condition trend**: vibration and temperature break away from their baselines about 10 days ago.
   - **Maintenance** tab: the last PM is highlighted in red. It was done by Carolina Industrial Services with "Mobilgrease XHP 222 (EP2, substitute)", and the technician's note reads "Vigo RE0 backordered … substituted".
3. **Click the hero chip "Which machine should I worry about this week, and why?"** The copilot calls `get_fleet_risk`, then `get_asset_details`, then `ask_data` (the Genie agent over the manuals). You can follow each step in the Thinking panel. Its answer:
   - RA-207: risk 94, ~3.5 days, $156K at risk
   - the sensor drift, with numbers
   - WO-20273 and the substitute grease
   - ES-ROB-014 (RE0 only; +8–15 °C, 2–3× vibration) and CAPA-0117 (RA-203)
   - recommendation: replace the J3 reducer and purge with RE0
4. **Ask "Is it just RA-207? Check which other robots got the same PM."** The copilot runs `find_pm_batch` and returns a table of RA-207, RA-211 and RA-214:
   - RA-211 is drifting early.
   - **RA-214 is the trap: the model says Healthy, but it got the same grease.** The copilot recommends a campaign across all three.
5. **Ask "Plan the fix in Saturday's Line 2 window: work orders, technicians and parts for all exposed robots, with the downtime cost avoided."** The copilot calls `list_windows`, `check_parts` and `ask_data`, then returns a plan table:
   - RA-207: 8 h with 2 FANUC-certified technicians; reducer A97L-0218-0412#J3 and seal kit A290-7221-X521 from the plant crib
   - RA-211 and RA-214: 3 h each, 1 technician each, RE0 grease A98L-0040-0174 by 1-day transfer from the Charlotte DC (the crib has none)
   - the load is 14 of 16 hours
   - cost avoided per asset, about $210K in total
   - It then **stops and asks for approval**.
6. **Type "Book it."** The copilot calls `book_work_order` three times. Each call is one Lakebase transaction that reserves the parts, consumes window hours and flips the asset to protected. It returns WO-PDM-31001/2/3, the parts reserved (crib or DC transfer), cost avoided and net savings.
7. **Open Work orders** in the sidebar. You'll see the three work orders with root cause, tasks, crew, window, reserved parts and cost avoided. The window bar reads 14/16 h, and the reducer's *Reserved* column shows 1. You can **Start**, **Complete** or **Cancel** a work order; Cancel releases the parts and the window hours. Back on the Control room, the hero shows "Cost avoided (booked)" of about $210K, 3 protected assets, and a check mark on the three tiles.
8. **Plant manager view.** Open **Dashboard** (the embedded AI/BI dashboard).
   - Page 1: Line 2 OEE for the last 7 days vs its baseline, weekly OEE by line (Line 2 breaks away), MTBF by asset type, breakdown cost by failure mode, and the fleet-risk table.
   - Page 2 (**Reliability — root cause**): 60-day vibration for RA-201/203/207/211/214, and a table of robot PMs by lubricant.
9. **Genie** (TechRobotics Plant Reliability Genie). Ask:
   - "How has Line 2 OEE trended over the last 8 weeks?" Answer: steady at ~79%, then 75.9% → 72.6% over the last two weeks.
   - "Which robots got a non-OEM substitute grease at their last PM?" Answer: RA-207 (94 Critical), RA-211 (38 Watch), RA-214 (1 Healthy).
   - "What is MTBF by asset type?"
   - "Which assets are most likely to fail in the next 7 days, and why?"

**Talk track, in one line:** *one governed platform gets you from a vibration sensor to a booked work order with a dollar figure: Zerobus + Lakeflow → UC-registered model → Genie agent over your tables and manuals → Genie → an agent that writes back into Lakebase, with every step traced in MLflow.*

## Files

```
manifest.json · README.md · resources.json · architecture.md · databricks.yml · dab_instructions.md
data_generation/generate_data.py      synthetic plant (seeded, relative to "now", --catalog/--schema)
src/ml/train_score_model.py           features → GBT → UC registry (@champion) → fleet scoring
src/pipeline/{gold.sql,build_gold.py} OEE / reliability / fleet-health views + UC metric view
src/documents/{md,pdf,render_pdfs.py} the 8 plant manuals (source markdown + rendered PDFs)
src/deploy/{upload_manuals,deploy_genie,finalize_app}.py
genie/genie_space.json                serialized-v2 Genie space (tables sorted)
dashboard/plant_reliability.lvdash.json (+ build_dashboard.py)   schema-less datasets
app/                                  the PdM Control Room (fork of the Solution Builder app template)
specifications/01..04-*.md
```

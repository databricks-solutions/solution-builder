# Supply Planning Copilot — S&OP supply planning & inventory optimization

**Customer (fictional):** Corvane Motion Systems — an industrial motion-components maker (servo gearmotors, planetary
gearboxes, linear actuators, motion controllers) with plants in Dayton OH, Monterrey MX and Wroclaw PL.
**Industry:** Manufacturing

## The story
Two things happened at once. **Demand:** SG-400 servo gearmotor orders at Dayton are up ~46% since June (warehouse-
automation wins such as Atlas Warehouse Robotics). **Supply:** a typhoon berth closure at the **Port of Yantian** rolled
the three containers of HX-220 gear-housing castings that Nanhai Precision Castings — Dayton's sole source — had on the
water: **+25, +18 and +18 days**. Nanhai's on-time delivery fell from 100% (Jun–Aug) to 33% in September.

Every Dayton servo (SG-250 / SG-400 / SG-600) needs one HX-220. AI_FORECAST × the bill of materials against on-hand
stock and the POs at their revised ETA shows Dayton's HX-220 balance going **negative in the week of Oct 12**, peaking at
**1,054 housings short** — **$2.04M** of servo revenue, 10 firm customer orders ($2.1M, Tier-A Atlas, Orbital and
Northgate among them). Had the POs arrived on time, there would be no shortage at all.

**The aha (inventory optimization):** Monterrey is sitting on **2,600 HX-220 housings** left over from the SG-300 line
it sunset in May — no demand, 150 days without an issue, flagged **obsolete** in the E&O report ($369K). A 5-day bonded
truck transfer of ~2,400 costs **~$14K** and closes the gap completely, never dipping below safety stock. The obvious
fixes are worse: Nanhai's air-freight offer costs **$74K** (VP approval) and still leaves 54 units short; the qualified
alternate foundry (Ridgeline, 21 days) costs **$55.7K** and arrives a week too late on its own.

A smaller second exposure — Kessler's 70% allocation on the EN-17 encoder leaves Wroclaw 222 units short from Nov 23
($301K) — is again coverable from Monterrey's obsolete SG-300 encoders.

**Personas**
- **Elena Ruiz** — Dayton supply planner (app user; books the plan).
- **Tom Becker** — VP Supply Chain (dashboard + Genie; approves anything over $50K).

## Demo script (≈10 minutes)
1. **Home** (`/`). The planning grid shows the Dayton HX-220 projection running red (stock-out) from Oct 12; the headline numbers are *"Dayton runs out of HX-220 gear housings on Oct 12 — $2.04M of servo orders at risk."*
   Tiles: **$2.34M** revenue at risk (13 weeks), **2** projected stock-outs (3 exposures), fill rate **96.7%**
   (Dayton **94.4%** vs the 97% target), E&O **$956K**, **9** inbound POs delayed. The exposure board lists HX-220 @ Dayton
   (Oct 12, 1,054 short, $2.04M, *Inbound supply delay +25 d*), EN-17 @ Wroclaw (Nov 23, 222, $301K, *Supplier allocation
   cut*) and HX-310 @ Monterrey (below safety stock only — Monterrey's cover absorbs the same Yantian delay). Point at the
   SG-400 demand chart (actual → AI_FORECAST ~370–400/week) and the supply-signal feed read by ai_extract.
2. **Ask the Copilot** chip 1: **"What is going to run out first in the next 13 weeks, and how much revenue is at risk?"**
   → `list_exposures`: HX-220 at Dayton first (week of Oct 12, 1,054 units, $2.04M), then EN-17 at Wroclaw (Nov 23,
   222 units, $301K) — $2.34M in total.
3. Suggested next **"Why?"** — *"Why is Dayton short of HX-220 gear housings? Show me the supplier delay and how
   Nanhai's on-time delivery has trended."* → `get_exposure` + Genie: PO-48528 / 48531 / 48534 rolled at Yantian (+25 /
   +18 / +18 days, MV Jade Horizon, Pearl Meridian, Coral Tide); with the POs on time there would be **0** units short;
   Nanhai on-time 100% Jun–Aug → **33.3%** in September; SG-400 demand growth on top. (Answers are phrased freshly each
   run; the numbers come from the tools.)
4. Click **Open the HX-220 exposure** (`/exposures/EXP-HX-220-DAY`). KPIs: first stock-out **Oct 12**, **1,054** short,
   **$2.04M** at risk, **17.1** days of supply, **3** delayed POs. The chart: the orange projection dives below zero on
   Oct 12 / Oct 19, the dashed "if on time" line never does. Inbound POs table shows the three rolled containers; *What
   the AI read* shows the Pacific Crest advisory FA-0914 with its PO numbers; *Customer orders in the stock-out weeks*:
   10 orders, $2.1M, incl. Atlas Warehouse Robotics 420 × SG-400.
5. The **Mitigation plan** card lists the priced levers in policy order: Transfer from **Monterrey** (2,400, arrives Oct 3,
   $14,460, *closes the gap*, *releases E&O*) · Transfer 150 from Wroclaw (904 still short) · **Ridgeline** 1,200 (arrives
   Oct 19, $55,700, 372 still short) · **Nanhai air** 1,000 (Oct 10, $74,000, 54 still short) · safety stock +1 week.
   Click **Ask the copilot to build the plan** → the dock runs `get_exposure → evaluate_mitigations → simulate_plan →
   propose_plan` (~30–60 s) and answers: **transfer ~2,400 HX-220 from Monterrey, ~$14.4K vs $2.04M protected**, arrives
   Oct 3 ahead of the Oct 12 stock-out, 0 units short, 0 weeks below safety stock, ~$340K of obsolete stock put back to
   work, approver: plant supply planner; Ridgeline and air rejected (cost, still short). The card pre-selects the staged
   plan and shows *Copilot rationale*; the chart's navy "with your plan" line stays above safety stock.
6. Optional: tick **Air-expedite from Nanhai** to show the what-if — cost jumps past $50K and the approver becomes
   **VP Supply Chain**. Untick it. Ask the chip **"Who approves?"** — *"Per our supply policy, who has to approve $74,000 of
   air freight, and when should we raise safety stock on a disrupted lane?"* → the Genie agent (policy documents): VP Supply Chain
   (above $50K, CSP-01 §1.4 / CSP-03 §3.2); raise safety stock by one week when a lane has an active disruption > 14 days
   or OTD < 80% for four weeks (CSP-02 §2.2).
7. Click **Book plan** → *Plan PLN-… booked*, document numbers (e.g. **TO-7xxxxx** transfer order), *"Saved in Lakebase and
   written back to Delta (sop_plan_decisions)"*; the audit trail shows the copilot proposal and the booking. Home's exposure
   board now shows **Booked · $14K**; **Inventory health** → *Plans written back to Delta* lists the row read live from the
   SQL warehouse; the dashboard's exposures table shows *Booked*.
8. **Inventory health** (`/inventory`): Monterrey E&O (HX-220 $369K, PG-SET excess $248K, ST-30 $163K …), the days-of-supply
   heat table (Monterrey's SG-300 parts "no demand"), Dayton's fill rate sliding since June, Nanhai's OTD collapse.
9. **Supply dashboard** (`/dashboard`) for Tom Becker, or the Genie space: *"What is our excess and obsolete inventory value
   by plant?"* → Monterrey $883K ($635K obsolete + $248K excess), Wroclaw $73K excess.
10. Close: **Reset the demo** (header) clears plans, audit and chat, and removes the app's rows from `sop_plan_decisions`.

Talking points: the planning engine is deterministic — the LLM never computes a quantity, date or cost, it calls tools;
the forecast is one SQL function (AI_FORECAST) on governed tables; unstructured supplier emails become structured signals
with ai_extract; policy answers are cited by the Genie agent from the policy manual; every plan is a draft a planner books; Lakebase keeps
the transactional plan state next to the lakehouse and the booked plan flows back to Delta for BI and Genie.

## Files
`manifest.json` · `resources.json` · `architecture.md` · `specifications/01-05` · `data_generation/generate_data.py` ·
`src/gold/build_gold.py` · `src/ai/extract_signals.py` · `src/policy_manual/*.md` ·
`src/genie/genie_space.json` · `src/deploy/*.py` · `dashboard/supply_planning.lvdash.json` · `app/` · `databricks.yml` · `dab_instructions.md`

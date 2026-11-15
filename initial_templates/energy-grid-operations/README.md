# Grid Ops Copilot — the heat-wave overload nobody saw coming

**Midwest Regional Electric Cooperative (MREC)** · Energy & Utilities · *Grid monitoring & forecasting*

A distribution-utility control-room demo: a temperature-aware load forecast finds the **one** transformer
that goes over its nameplate in tomorrow's heat wave, asset health explains why that matters, and an agent
ranks three costed relief options. The operator approves one and it is written back to the action log.

## The story
It is **Tuesday 21 July 2026, 2 PM**, day two of a heat wave; the weather service says **103-104°F tomorrow**.
MREC serves 154,504 customers from 6 substations, 12 power transformers and 40 feeders. System-wide there is
plenty of headroom (tomorrow's peak is ~75% of installed capacity) — which is exactly how an overload hides.

- **T-104 at North Ridge** (25 MVA, GE 1987) is forecast to **107.2% of nameplate at 5 PM tomorrow**, over
  nameplate for 4 hours, with a **winding hot-spot of 123°C** (design 110, emergency 120) and insulation aging
  at 3.6x normal.
- Why now: the **Ridgeline Data Center** energised +4 MW on feeder NR-13 since February, on top of EV and
  heat-pump growth — the planning study never saw it.
- Why it matters: T-104 is **Poor** (health index 26); its **ethylene has quadrupled in six months**
  (46 → 177 ppm, IEEE C57.104 Condition 3). It serves **14,200 customers** incl. **Mercy Regional Hospital**,
  the water treatment plant and **two cooling centers**. It already **tripped on over-temperature on
  14 Aug 2025** (9,800 customers, 5+ hours — ~20 minutes of the year's 139-minute SAIDI).
- Decoy: **T-109 at Riverside** runs at 92% but is a healthy 2014 unit → *watch, don't act*.

Three relief options, costed on the same forecast:
| # | option | relief @ peak | cost | customers | peak after | hot-spot after | verdict |
|---|---|---|---|---|---|---|---|
| 1 | Demand response (C&I DR + 2,487 smart thermostats, 15:00-20:00) | 5.32 MVA | $23k | 2,493 voluntary | 94.8% | 110°C | **clears it, keeps N-1** |
| 2 | Switch NR-14 onto CF-03 via tie TS-417 | 5.89 MVA | $1.8k | 4,300 lose backup | 94.8% | 110°C | moves the problem: T-106 → 100.4% |
| 3 | Discharge the community battery + solar | 1.32 MVA | $4.2k | 0 | 101.9% | 119°C | not enough on its own |

## Personas
- **Evan Chen — VP Grid Operations** (protagonist): needs a defensible decision in minutes, not a study.
- **Maya Rodriguez — Distribution control-room operator**: approves and dispatches the action.
- **Dr. David Park — Asset management / predictive maintenance**: owns the health index and DGA program.

## Demo script (≈6 minutes)
1. **Open the app** (`grid-ops-copilot`) → *Control room*. Read the banner: "Heat advisory · forecast high 104°F".
   Point at the KPIs: system peak 258 MVA of 344 installed — *"on the system view, we're fine"* — but
   **1 transformer over nameplate** and **14,200 customers at risk**.
2. **The chart**: T-104's SCADA (blue) and the dashed forecast crossing the red 25 MVA nameplate tomorrow
   at 5 PM; the stats show 107.2%, 4 h over nameplate, 123°C hot-spot, 3.6x aging.
3. **Risk board**: only T-104 is red; T-109 is yellow but healthy. Scroll to **Why T-104**: health 26,
   ethylene 177 ppm and rising (sparkline), 39 years old, last August's trip, the hospital + cooling centers.
4. Click **Ask the copilot what's at risk** → the agent calls `get_grid_overview` + `get_transformer_risk`
   and explains the chain weather → load → hot-spot → condition → customers, and notes T-109 is only a watch item.
5. Click **Ask the copilot to rank** (on the Relief options card) → the agent calls `get_relief_options`,
   returns the ranking table and recommends **demand response**, explaining why switching (pushes T-106 to 100%,
   removes N-1 for 4,300 customers) and the battery (still 102% / 119°C) lose. It stops and asks for approval.
6. Type or click the suggested **Approve option 1** → the agent calls `log_operator_action`, writes the row to
   `operator_actions` and replies with the action id. (Alternative: hover an option card to see its post-action
   curve in green on the chart, then click **Approve & dispatch** — same write-back from the UI.)
7. The **Control-room action log** shows the dispatched action (operator, rationale, expected 94.8%).
   Optional: **SAIDI impact** suggested question → Genie answers from the reliability tables.
8. **Dashboard** (sidebar) → page 1 (tomorrow's peak), page 2 (asset health + options), page 3 (SAIDI/SAIFI —
   the August spike is the T-104 trip). **Genie space** questions:
   - *Which transformers are at risk of overload tomorrow?* → T-104 CRITICAL 107.2%, T-109 WATCH 92.1%
   - *What are the relief options for T-104 and which one is recommended?* → demand response, 5.32 MVA, $23,000
   - *What was our SAIDI and SAIFI over the last 12 months?* → 139.1 min, 1.253 (targets 125 / 1.10)
   - *Which critical facilities are served by T-104?* → 6 facilities incl. Mercy Regional Hospital
9. **Close**: from a forecast to a costed, approved, auditable action in two minutes — instead of discovering
   T-104 at 5:40 PM tomorrow when the over-temperature relay trips 14,200 customers.
   Reset between runs with **Reset demo** (clears the action log + chats).

## What's built
| asset | where |
|---|---|
| 18 Delta tables (SCADA, weather, DGA, outages, DR/DER, forecast, gold health + relief options, write-back log) | `energy_utilities.grid_operations` — `data_generation/generate_data.py` |
| Load forecast model (per-transformer weather-aware ridge regression + IEEE C57.91 thermal model) | trained in the setup job → `transformer_load_forecast` |
| AI/BI dashboard, 3 pages | `dashboard/dashboard.lvdash.json` |
| Genie space (instructions, 8 sample questions, 6 example SQLs) | `genie/genie_space.json`, `src/deploy/deploy_genie.py` |
| Databricks App + GridOps agent (5 tools incl. write-back) | `app/` (see `specifications/03-agent-bricks.md`) |
| DAB: schema, dashboard, agent-traces experiment, setup job (data → Genie → grants + `demo_resources`), app — deploy with `databricks bundle deploy` → `bundle run grid_ops_setup` → `bundle run grid_ops_copilot_app` | `databricks.yml`, `dab_instructions.md` |
| Architecture diagram | `architecture.md` |

Honest scope: the data is synthetic and generated by one Lakeflow Job task (no live SCADA / SDP pipeline); the
forecast is trained inside that job (not an MLflow-registered model); "dispatch" writes the decision to
`operator_actions` — it does not call a real DERMS/ADMS.

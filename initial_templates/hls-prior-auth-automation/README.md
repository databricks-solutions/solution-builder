# MedVault Health Plan — Prior Authorization Copilot

> Healthcare & Life Sciences (payer) · Outcome: **automate prior authorization** · synthetic data only (no PHI)

## The story
**MedVault Health Plan** (fictional regional payer — Medicare Advantage, Commercial PPO, Medicaid) runs a
utilization-management (UM) team that reviews ~50 prior-authorization (PA) requests a day against 11 medical
policies. The **CMS Interoperability & Prior Authorization final rule (CMS-0057-F)** requires a decision within
**72 hours for expedited** and **7 calendar days for standard** requests — and public reporting of approval rate,
denial rate and turnaround.

It's **Monday 08:00**. 196 requests are waiting, the weekend's faxes still aren't indexed, and every case means
reading clinical notes against a policy, criterion by criterion. The data tells the real story:

| Finding (last 120 days) | Number |
|---|---|
| Requests where every policy criterion was already documented at the first nurse review | **~52%** |
| …yet those clean approvals waited (median, received → approved) | **~63 h (~2.6 days)** |
| Expedited 72h compliance, weekdays / portal / ePA | **~99%** |
| Expedited 72h compliance, **faxes arriving Fri 3pm–Sun** (Monday indexing backlog) | **~21%** |
| Standard 7-day compliance | **~82%** |
| #1 pend: MRI lumbar spine — *missing 6 weeks of conservative therapy* | **~420 pends** |
| Pend rate — Cascade Spine & Pain Associates vs Northside Orthopedic Associates | **58% vs 4%** |

**The aha:** overnight, **AI Functions** (`ai_query`) read every open case's notes against its policy and quoted
the evidence for each criterion. About a third of the queue lands in an **approve-only auto-approval lane**; nurses
spend their time on the real gaps (with an auto-drafted provider request) and the few cases a Medical Director must
decide. Automation **never denies**.

## Personas
- **Dana Whitfield, RN** — UM nurse reviewer (the app user).
- **Dr. Marcus Oyelaran** — Medical Director (the only role that may deny).
- **Priya Raman** — VP UM Operations, owns the CMS metrics (dashboard + Genie).

## Demo script (≈10 min)
1. **Briefing** (`/`). *"Good morning, Dana — 196 requests waiting; ~90 already meet every criterion."* Point at the
   KPI tiles (5 expedited, past-due count, **weekend faxes awaiting indexing**) and the **AI pre-review lanes** bar.
2. **Worklist** → sort is by SLA clock. Show the red *overdue* and amber *at-risk* clocks. Filter **Expedited only**:
   two weekend-faxed **lumbar MRIs** with ~7h and ~11h left — both already in the **Auto-approve** lane.
3. **Open a Request-info case** (e.g. an MRI lumbar spine from *Cascade Spine & Pain*): the clinical summary has each
   evidence sentence highlighted and tagged C1/C3; criterion **C2 — 6 weeks conservative therapy** shows *no evidence
   found*. Click **Pend** → the provider request letter is pre-drafted from the AI gap → **Send request**.
   Talk track: *"that's the note she'd have typed; the decision is hers, written to Lakebase and Delta."*
4. **Open a Nurse fast-track case** (e.g. adalimumab for RA): click **Re-run live review** (Foundation Model API,
   same prompt as the batch) → Approve. *"Specialty drugs need a nurse sign-off even when everything is met."*
5. On any case, **Ask the medical policy** → *"Who is allowed to deny a prior authorization at MedVault?"* →
   *"Only a Medical Director may deny…"* (the Genie agent over the policy documents).
6. **PA Copilot chat** (Briefing chips or the floating dock):
   - *"What's on my plate this morning? Anything about to breach the 72-hour clock?"* → queue overview with lanes,
     at-risk expedited cases, practice groups with the most heat.
   - *"How many of these could the auto-approval rule clear right now? Show me before you do anything."* → the
     agent lists the lane (count, expedited count, value, policies, the MV-UM-000 rule) and **stops to ask**.
   - *"Yes — release them."* → the write tool approves the lane; Briefing/Worklist update live; *Decided* tab fills.
   - *"Why do lumbar spine MRIs keep getting pended, and which practice group drives it?"* → the agent calls
     **Genie**: ~420 pends for missing conservative therapy, ~300 of them from Cascade Spine & Pain.
   (Alternatively click **Release N auto-approvals** on the Briefing — same rule, with a confirm dialog.)
7. **CMS ops dashboard** (embedded AI/BI): page 1 — 93% expedited / 82% standard compliance, clean-on-first-review
   ~52%, the weekly auto-approval pilot line starting to climb, the Monday backlog spikes; page 2 — the weekend-fax
   bar, turnaround by decision path, pend rate by practice group, top pend reasons, and **decisions written back
   from the app** (the workbench's own decisions just appeared).
8. **Genie space** directly: *"Why are we missing the 72-hour clock on expedited requests?"* → weekend faxes: 79% of
   those miss, 69.5h median intake lag. *"Which practice groups are gold-card candidates?"* → Northside Orthopedic.
9. **Reset** (header button) between demos: wipes the Lakebase mirror + `um_decisions` and re-syncs the queue.

## Files
- `data_generation/generate_data.py` — self-contained generator (`--catalog/--schema`), tables + policy docs.
- `src/deploy/build_ai_review.sql` · `build_metric_view.sql` · `run_sql_on_warehouse.py` · `deploy_genie.py` · `grant_app_uc.py` · `export_resources.py`.
- `dashboard/dashboard.lvdash.json` (schema-less datasets) · `genie/genie_space.json` (serialized v2).
- `app/` — the PA Copilot app (fork of the solution-builder app template); see `specifications/03-app-pa-copilot.md`.
- `databricks.yml` + `dab_instructions.md` — recreate everything on another workspace.
- `specifications/` — data + AI review, Genie agent/dashboard, app specs. `architecture.md` — diagram.

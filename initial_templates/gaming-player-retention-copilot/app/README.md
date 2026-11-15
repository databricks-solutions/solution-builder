# Hollowspire Live-Ops Console — Databricks App

AppKit (Node/Express + React) app forked from the Solution Builder action-agent template and rebuilt for
free-to-play player retention (Emberline Studios, fictional). See `TEMPLATE_MAP.md` for the file map.

- **Console** (`/`): Season 7 story, D1/D7/D30 + ARPDAU KPIs, SHAP driver cards, the at-risk segment board.
- **Segment panel**: evidence, top at-risk players, AI-labelled chat, the plan engine, the copilot's staged plan
  and **Schedule** (writes Lakebase + Delta `liveops_schedule`).
- **Budget what-if** (`/whatif`) and the embedded **Live-Ops Dashboard** (`/dashboard`).
- **Copilot dock**: `databricks-gpt-5-4` agent with Genie + plan-engine tools.

Local run: `cp .env.template .env` (fill PGHOST, GENIE_SPACE_ID, DASHBOARD_ID), then `./start.sh` → http://localhost:8826.

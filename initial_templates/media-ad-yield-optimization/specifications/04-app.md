# 04 — Ad Yield Copilot app (Maya Chen, Director of Yield & Pricing)

Databricks App (AppKit, Node + React) on Lakebase (bundle-created project `ad-yield-copilot`, database `databricks_postgres`).
Pages: Home, Yield board, Campaigns at risk, Campaign workbench, Yield actions, Revenue & forecast, Dashboard.

Recovery plan (deterministic core + LLM write-up): problem line → ai_forecast to flight end → spare avails for the
booked audience in equal-or-better tier with audience share ≥ the failing line (IO exclusions: RON, Late Night, Kids,
Daytime) → floor-group check → allocate shortfall x 1.03 cheapest-displacement first (≤ 85% of each product's spare)
→ liability avoided, displaced programmatic revenue, floor-fix uplift, net → the Genie agent over the IO / policy documents →
`databricks-claude-sonnet-4-5` writes the diagnosis, agency notice, ad-ops instructions.

Write-backs: `app.yield_plans` (+ `app.floor_changes`) on *Approve plan & send to ad ops*; `app.floor_changes` on
*Restore floor* (yield board) or via chat tools. Chat agent (`databricks-gpt-5-4`, Responses API): the Genie agent (data + documents),
at-risk IOs, yield board, recovery plan, the two write-backs.

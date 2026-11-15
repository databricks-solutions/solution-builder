# 05 — Genie agent: "Westbrook DHS - Eligibility Operations" (tables + the policy_manual volume)

Source: `src/genie/genie_space.json` (serialized v2; tables + example SQL sorted; deployed by
`src/deploy/deploy_genie.py`, which rewrites `public_sector.eligibility_copilot` to the target).
Tables: `gold_applications`, `gold_county_monthly`, `gold_county_backlog`, `counties`, `program_rules`.
Instructions define the 7/30/45-day standards, on-time rate (determined only, last N COMPLETE months), uppercase
`determination` values, approval and procedural-denial rate formulas, and "use gold_county_backlog for caseload".
Also used by the app's chat agent (`ask_data` tool) and, for policy questions, by the eligibility check.

Verified answers (Genie conversation API, 2026-09-29):
| Question | Genie | Check (SQL) |
|---|---|---|
| Which county is furthest below the 30-day SNAP standard over the last 3 complete months? | Tamarack 37.9% (169 determinations) vs rest of state 91.0% | 37.9 ✓ |
| Tamarack's SNAP on-time rate month by month (9 months) | ~74–84% Dec–May, then 47.8% Jun, 43.1% Jul, 27.8% Aug | ✓ |
| Compare procedural denial rates by county | Tamarack 14.6% (41), Cedar Falls 7.7%, Pine Ridge 5.7% … Riverbend 3.6% | ✓ |
| Are approval rates different by race or ethnicity? | 76.0%–78.4%, 2.4-pt spread — essentially flat | ✓ |
| Open cases per caseworker by county | Tamarack 58.0; Pine Ridge 8.7; Cedar Falls 5.0 … Capitol 2.4 | ✓ |

# 05 — Genie space: "Orbitline+ - Content Discovery & Metadata"

`src/genie/genie_space.json` (serialized v2; tables sorted): `collections`, `gold_retag_pilot`, `gold_title_scorecard`,
`gold_title_weekly`, `retag_events`, `taxonomy`. Instructions define impressions / play rate / completion rate, the
last-4-complete-weeks default (never `current_date()`), per-title comparisons, the pilot, hidden gems and safety risk.

Sample questions (each has verified example SQL):
1. What share of impressions does the Harborlight library get compared with its share of the catalogue? → 30.0% vs 10.3%.
2. Do Harborlight titles perform worse when viewers actually watch them? → no: 59.3% / 59.0% vs 60.2% completion.
3. What happened to impressions and play starts for the titles re-tagged in the July pilot vs the rest of Harborlight? → ×4.7 / ×6.2 vs ×1.0.
4. Which hidden gems have the biggest discovery gap? → Quiet Fields, The Stone Station, The Winter River… (AI-genre dependent)
5. How many titles are sold as Family-Safe but have AI-detected content warnings, by source? → Harborlight 250, Studio Licensed 56, Originals 1.

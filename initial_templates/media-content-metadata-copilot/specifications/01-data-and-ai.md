# 01 — Data, AI Functions & gold layer

Catalog/schema: `media_advertising.content_metadata_copilot` (DAB variables `catalog` / `schema`).

## Raw tables (`data_generation/generate_data.py`, seeded, fixed AS_OF 2026-09-28)
| Table | Rows | What |
|---|---|---|
| `titles` | 1,400 | 360 Orbitline Originals, 620 Studio Licensed, 420 Harborlight Library (acquired 2026-04-13) |
| `title_metadata` | 1,400 | LIVE metadata: genres, moods, themes, content_warnings, warnings_reviewed, talent, keywords, synopsis, collections (home rows), brand_safety_tier, completeness_score, tagged_by |
| `scenes` | 9,727 | timecoded scene descriptions (synthetic transcripts / audio description) — CDF on for Vector Search |
| `credits` | 7,727 | director + cast from contracts (often not mapped into metadata) |
| `taxonomy` | 83 | controlled vocabulary: 20 genres + 3 generic placeholders, 18 moods, 28 themes, 14 content warnings |
| `collections` | 13 | tag-driven home rows and their rule (facet + terms, max rating, no-warnings) |
| `engagement_weekly` | 35,560 | 26 weeks × title: impressions, search impressions, play starts, completions, minutes |
| `retag_events` | 40 | the July 2026 re-tag pilot (40 Harborlight titles, 2026-07-27) |
| `title_truth` | 1,400 | generator ground truth of real tags (eval only) |

**Planted signal.** Impressions are a function of completeness (tag-driven discovery); completion rate is a
function of intrinsic quality only. Harborlight = 30% of titles, 10.3% of impressions, completeness 21.5/100,
completion 59.2% vs 60.2% for the rest. Pilot titles: impressions ×4.7, play starts ×6.2 (control ×0.97).
Heroes: `TTL-HB-0117` The Salt Road (tagged "Drama", 18/100, 6.3k impressions vs 41k thriller peer, 77% completion)
and `TTL-HB-0233` Paper Lanterns (TV-G, in "Little Ones (under 7)", scenes show a house fire and a mother's death).

## AI Functions (`src/ai/enrich_titles.py`)
`ai_query('databricks-gpt-5-4-mini', <prompt + dossier>, responseFormat => <JSON schema>)` over every title's dossier
(synopsis + all scenes). The prompt carries the controlled vocabulary and the Standards Guide warning definitions
(evidence rule). Deterministic post-processing: keep only taxonomy terms, talent from `credits`, brand-safety tier
from warnings, completeness of the proposal → `ai_title_enrichment`. `ai_tag_accuracy` measures the AI against the
ground truth (content warnings: precision 0.96, recall 0.99 (latest run)).

## Gold (`src/gold/build_gold.py`)
- `gold_title_scorecard` — live vs AI metadata, last-4-week engagement, peer benchmark (median of well-tagged
  titles with the same primary genre), `discovery_gap_impressions_4w`, `missing_warnings`, `safety_risk`,
  `hidden_gem`, `retag_priority_score`.
- `gold_title_weekly` — title × week with `library_group` (pilot / Harborlight not re-tagged / rest).
- `gold_retag_pilot` — 4 weeks before vs after the pilot, pilot vs control.
- `mv_content_discovery` — UC metric view (impressions, play starts, completion rate, impressions per title).

## Vector Search (`src/vector_search/create_indexes.py`)
Delta-sync indexes with managed embeddings (`databricks-gte-large-en`) on endpoint `dbdemos_vs_endpoint`:
`title_profiles_index` (synopsis + tags + setting, title name excluded) and `scenes_index` (every scene).

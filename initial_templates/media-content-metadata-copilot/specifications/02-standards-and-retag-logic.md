# 02 — Standards Guide & the AI re-tag logic

The Genie agent searches the **Orbitline Content Standards Guide** — `src/standards_guide/*.md` (6 chapters, volume
`standards_guide`, Agent mode): completeness score (§1.2), genre/mood/theme rules (§2), content warnings + maturity floors +
kids rows (§3), brand-safety tiers + Ad Ops (§4), synopsis style (§5), clip rights + approval workflow (§6).

The same rules are code in `app/server/lib/metadata.ts` (never left to an LLM):
- **Completeness** = genre specificity 15 + moods 15 + themes 15 + warnings reviewed 20 + talent 15 + keywords 10 + synopsis 10.
- **Brand tier**: any of Graphic Violence / Sexual Content / Nudity / Drug Use / Self-Harm / Suicide → Restricted;
  any other warning → Standard; none (reviewed) → Family-Safe.
- **Rating floor** (§3.4): Frightening Scenes, Death of a Parent, Violence, Strong Language, Alcohol, Smoking → ≥ TV-PG/PG;
  Restricted warning → ≥ TV-14/PG-13; sexual content / nudity / graphic violence → TV-MA/R.
- **Home rows** from the `collections` rules (facet terms, max rating, "Little Ones" requires no warnings).

`app/server/services/retag.ts` — the streamed re-tag: read scenes → load the AI Functions proposal → apply the rules
(6 checks: genre, moods/themes, warnings, tier, rating, rows) → ask the Genie agent (Standards Guide documents) the one question that matters (kids row →
rating/row rule; tier change → Ad Ops rule; hidden gem → prioritisation) → Vector Search look-alikes → Claude Sonnet 4.5
writes the editor brief (summary, why it under-performs, Ad Ops note). Projected impressions = current × the pilot
multiplier, capped at the well-tagged peer median.

Hero outcomes: The Salt Road → completeness 18 → 100, +3 rows (Edge-of-Your-Seat Thrillers, Crime Nights, Stormy Seas &
Coastal Towns), tier Family-Safe → Standard. Paper Lanterns → rating TV-G → TV-PG, leaves "Little Ones (under 7)",
tier Family-Safe → Standard.

# Metadata Copilot — AI content metadata generation, enrichment & taxonomy

**Customer (fictional):** Orbitline+ (a streaming service) · **Industry:** Media & Entertainment

## The story
In April Orbitline+ bought the **Harborlight Library** — 420 films and series — from a studio whose legacy vendor feed
carried almost no usable metadata: "Feature Film" or "Drama" as the genre, no moods, no themes, no talent, one-line
synopses and **no content warnings**. Orbitline+'s home rows, search and recommendations are **tag-driven**, so those
titles are barely shown: Harborlight is **30% of the catalogue but 10.3% of impressions** (average metadata completeness
**22/100**, vs 89 for studio titles and 99 for Originals). Yet viewers who find a Harborlight title **finish it as often as
anything else (59.2% vs 60.2%)** — it's the metadata, not the content.

The proof already exists: in July editors hand re-tagged **40** Harborlight titles (≈50 minutes each). In the four weeks
after, those titles earned **×4.7 impressions and ×6.2 play starts** while the other 380 stayed flat. Hand-tagging the rest
would take ~300 editor-hours. And there is a risk hiding in the gap: untagged titles default to **Family-Safe** ad
inventory, and one of them sits in the **"Little Ones (under 7)"** row.

The Metadata Copilot reads every title's scene descriptions with **AI Functions**, maps the tags onto the Orbitline+
taxonomy, applies the Standards Guide (completeness, brand-safety tier, maturity floor, home-row rules) as code, cites
the guide through the **Genie agent** (it searches the Standards Guide documents), finds look-alikes and repurposable clips with **Vector Search**, and lets the
editor publish the change — written back to **Lakebase** with a before/after audit trail.

**Personas**
- **Nadia Brooks** — Metadata Lead, Content Operations (app user).
- **Daniel Okafor** — VP Content Strategy (dashboard + Genie user).

## Demo script (≈10 minutes)
1. **Home** (`/`) — the catalogue wall: an editorial masthead over a poster wall of the Harborlight shelf (each poster's completeness ring shows how little metadata it has). Read the headline: *"We bought 420 Harborlight titles in April. Our viewers can't find them."* Point at
   the tiles — **30% of the catalogue, 10.3% of impressions, completeness 22/100, completion 59.2% (rest of library
   ~60%)** — and the bars: a Harborlight title is shown **3.7× less** than a title from the rest of the library.
2. **Ask the Copilot** (Home chips → chat dock, ~35 s each, Genie behind it):
   - **"What share of impressions does the Harborlight library get compared with its share of the catalogue, and is it
     because the titles are worse?"** → *30.0% of the catalogue, 10.3% of impressions; 13.1k impressions per title vs
     49.1k; completion 59.2% vs 60.2% — a visibility problem, not a quality problem.*
   - **"Did re-tagging work?"** → *the 40 pilot titles: impressions ×4.68 (8,488 → 39,728 per title), play starts ×6.15;
     the other 380 Harborlight titles ×0.97.* (Chat answers are phrased freshly each run; the numbers come from Genie SQL.)
   Optionally open **Discovery & impact** (`/analytics`): the green pilot line jumps on 27 July while the red one stays flat.
3. **The aha — The Salt Road** (*Start with The Salt Road* on Home, `/titles/TTL-HB-0117`). Live metadata: genre
   "Drama", one mood, no themes, no talent, synopsis *"A man returns home."*, completeness **18/100**, sold as
   **Family-Safe**, in **no** home rows. The header: **6.3k impressions** in 4 weeks vs **41.7k** for a well-tagged
   thriller — but **77% completion** vs a 60% peer median. Scroll the scenes: a coastal smuggling thriller.
4. Click **Run AI re-tag** (~20 s) and narrate the steps: read 8 scenes → AI Functions proposal → 6 standards checks →
   Standards Guide (Genie agent) → Vector Search look-alikes → editor brief. Result: **Safety fix + re-tag proposed** —
   Thriller / Crime / Drama, moods Tense · Suspenseful · Atmospheric · Brooding, themes Smuggling · Brotherhood ·
   Small-Town Secrets · Loyalty, talent from the contract credits, a real synopsis; **completeness 18 → 100**;
   **+3 home rows** (Edge-of-Your-Seat Thrillers, Crime Nights, Stormy Seas & Coastal Towns); content warnings with
   their evidence scenes (hover one — the scene lights up on the left) → **tier Family-Safe → Standard**, and the Standards
   Guide answer: *Standard tier; Ad Operations must be told so Family-Safe campaigns stop, makegoods may be owed (§4.4)*.
   **Projected impact 6.3k → 29.5k impressions / 4 weeks** (the pilot's ×4.68, capped at the peer median).
   *The AI's exact tags and wording can vary slightly between setup runs; the rules, numbers and rows are computed.*
5. **Repurpose**: click **Find matching clips across the library** under the promo clip → similar coastal/smuggling
   scenes in other titles with timecodes. Then **Approve & publish metadata** → *Published to the live catalogue …
   completeness 18 → 100 · Standard · rated TV-MA · now in 3 home rows*; the audit trail shows the AI re-tag and the
   human decision (written to Lakebase).
6. **The risk — Paper Lanterns** (*Paper Lanterns (kids row)* on Home, `/titles/TTL-HB-0233`). Rated **TV-G**, in
   **Family Movie Night** and **Little Ones (under 7)**. Run the re-tag: warnings **Frightening Scenes** (scene 2, the house
   fire) and **Death of a Parent** (scene 3) → **rating TV-G → TV-PG**, **must leave Little Ones (under 7)**, tier →
   Standard; the Genie agent cites §3.4: *it cannot stay in "Little Ones (under 7)" and must be rated at least TV-PG*. Human in the
   loop: click the **Tense** mood chip to drop it (the AI over-reached), then **Approve & publish** → *rated TV-PG · now in
   1 home row*; the audit trail records *Edited by editor* + *Published*.
7. **Metadata queue** (`/library`): *Hidden gems* (≈210, highest priority first), *Safety review* (kids & family rows
   first), *Reviewed* (the two titles you just published). Optional chat: **"Kids-row risks"** (find_titles + Standards
   Guide) and **"Clips for a collection"** — *"Find me clips for a 'Stormy Seas' promo: boats at night in a storm"* →
   Vector Search puts The Salt Road's night boat run (01:12:46) first.
8. **Content dashboard** (`/dashboard`, or the published dashboard): discovery gap, pilot lift, hidden gems, safety list.
9. Close: **Reset the demo** (header) re-syncs the library from Delta for the next run.

Talking points: the AI proposes, rules decide (completeness, tier, rating floor and rows are code, never an LLM); every
warning carries the scene that proves it; the Genie agent grounds every standards statement in the guide; nothing reaches the
live catalogue without an editor; everything governed in Unity Catalog; the same gold tables feed the app, the dashboard
and Genie.

## Files
`manifest.json` · `resources.json` · `architecture.md` · `specifications/01-05` · `data_generation/generate_data.py` ·
`src/ai/enrich_titles.py` · `src/gold/build_gold.py` · `src/vector_search/create_indexes.py` · `src/standards_guide/*.md` ·
`src/genie/genie_space.json` · `src/deploy/*.py` ·
`dashboard/content_metadata_ops.lvdash.json` · `app/` · `databricks.yml` · `dab_instructions.md`

# Brand service redesign — evidence-in, LLM-decides

**⚠️ CRITICAL GOTCHA — the `ddgs` image backend:** `ddgs.images(q)` defaults to
backend `auto`, a roulette over bing/google/brave/yandex/mojeek, and its
`duckduckgo` image backend is currently DEAD (returns nothing). `auto` therefore
falls through to whichever backend answers — sometimes a poisoned/rate-limited one
that returns totally unrelated junk (we literally got IKEA-hacks, candles, and porn
for "airbnb logo" — NONE of it from DuckDuckGo, whose real web index is fine). The
fix: PIN to reliable backends (`_IMG_BACKENDS = bing/google/brave`) and merge across
them. If logos ever go garbage again, check this first — re-test each backend in
isolation before touching prompts/queries. (Text search `_ddg` uses the default and
is fine; this only bit image search.)

**STATUS: IMPLEMENTED** (colors + logo). Verified on previously-broken cases:
Stripe now picks the real purple wordmark (was ElevenLabs/Runway), Databricks picks
the real stacked-brick wordmark (brand page gave 0 candidates before). The vision
model's rationale + the contact sheet it saw are in the review file. Full-batch
scoreboard pending.


**Trigger:** human review of the 18-company batch. Palettes were good; **logos were
wrong** (Stripe→ElevenLabs, Linear→OpenAI, Databricks brand page→0 candidates,
several broken/non-rendering). Root cause: the logo pipeline scrapes HTML `<img>`/
`<svg>`, which fails on brand portals, SPAs, and aggregator grids — and **we never
looked at the pixels**, so wrong logos scored 100.

**Philosophy (the whole point of the redesign):**
- **Tools gather EVIDENCE and describe it; the AGENT decides.** Minimal Python
  judgment — no vote-count math, no near-white/merge filters deciding the output,
  no hardcoded aggregator/TLD lists picking winners.
- **Cross-source agreement is evidence the LLM can see.** Show it "this logo/color
  recurred from N independent sources" and let it conclude it's the real one.
- **For logos, the LLM must SEE the images.** Multimodal is confirmed working on
  `databricks-gpt-5-4-mini` (tested). Build a labelled contact-sheet of candidate
  images and let the model pick — preferring SVG (told via prompt, not code).
- Intent-explaining prompts that generalize; no per-company special-casing.

---

## Part 1 — Colors (search + palette): make it LLM-driven

**Change `fetch_page` from "regex hex + filter" to "read the page and report evidence."**
The extractor LLM returns, per page:
- `finding` (prose): what this page IS and what it says about the brand — e.g.
  *"brand.databricks.com, the official brand-guidelines page. Explicitly declares
  the primary palette: Lava 600 #FF3621, Navy 900 #0B2026, Oat Medium #EEEDE9, Oat
  Light #F9F7F4, White."* vs *"third-party aggregator; colors look inferred."*
- `is_official` / `declares_palette` (bools): is this the company's own page, and
  does it EXPLICITLY declare a palette (vs colors merely used in styling)?
- `colors`: `[{hex, name?, role?}]` — **including declared neutrals/off-whites**
  (brands really use oat/cream); the extractor does NOT drop them.

**The parent agent decides the palette.** It reads the findings across pages and
reasons in the open (via `log_reasoning`): *"the official brand page explicitly
lists these five — take them as the core; add one accent seen across other
sources."* Then calls `set_palette([...])`.

**Python stops filtering.** `set_palette` only normalizes hex format + drops exact
duplicates. No near-white rejection, no merge-distance math, no vote ranking — the
agent, which can read "Oat Light #F9F7F4 (brand neutral)", makes those calls. The
color "votes" become an **evidence view** (`{hex: [sources, declared?]}`) the agent
consults, not a ranker that decides.

**Search:** add a "<company> brand guidelines / press kit" query so the official
brand page surfaces; keep the existing color/aggregator searches as supplementary
evidence. Let the agent weight official > aggregator (prompt intent, not a domain
allowlist).

## Part 2 — Logo: full rewrite around DDG image search + multimodal pick

Replace HTML-scraping-for-logos entirely. New flow:

1. **DDG IMAGE search** (`ddgs` images), preferring official + transparent:
   - `"<company> logo" site:<official-domain>` with transparent filter, THEN
   - `"<company> logo"` transparent, THEN a plain fallback.
   Collect top ~12 image URLs (+ the SVG/PNG candidates the site crawl already
   found — they remain evidence, not the only source).
2. **Download + normalize** each candidate (SVG rasterized for display; keep the
   original SVG bytes as the preferred deliverable). Drop dead/unrenderable.
3. **Compose a labelled CONTACT SHEET**: a grid PNG, each cell numbered, rendered
   on a neutral background (and we can show light+dark). Recurrence is visible —
   the same real logo appears in many cells.
4. **Multimodal pick**: hand the contact sheet to the vision model:
   *"Which cell(s) show the REAL, current primary logo/wordmark of <company>?
   Prefer a clean vector wordmark. Note which appear multiple times (a strong
   signal). Return the cell number(s) + why, and flag any that are wrong-company /
   broken / cropped."* The agent gets the pick + rationale.
5. **Prefer SVG**: among the cells the model endorses, if an SVG version of that
   logo exists in our candidates, deliver the SVG (crisp); else the best raster.
   This preference is stated in the prompt AND used when choosing which endorsed
   candidate to return.
6. The agent can still override; everything recorded in the trace + shown in the
   review file (now including the contact sheet the model saw).

**Why this fixes the failures:** we judge by looking, so wrong-company/broken logos
are caught; official + transparent + recurring wins naturally; brand portals and
SPAs are bypassed because image search finds the asset regardless of how the site
renders it.

## What gets deleted / shrunk
- `_validate_candidates` quality rubric, `_is_og_card_shape`, `_is_icon_like`
  hard-reject in `choose_logo`, `pick_best_logo`'s scoring, `_LOGO_RANK` — replaced
  by "gather images → show model → model picks." (Some may survive as cheap
  pre-filters for the contact sheet, but they no longer DECIDE.)
- `_clean_palette`'s near-white/merge filtering behind the agent's back.
- Hardcoded aggregator domain lists as selection logic.

## Instrumentation (keep + extend)
- The contact sheet PNG is saved + embedded in the review file (see what the model
  saw).
- Trace records: image-search queries, candidates gathered, the model's pick +
  rationale, SVG-preference outcome.
- Multimodal availability: confirmed (`databricks-gpt-5-4-mini` read a test image).

## Open questions for the user
1. Vision model for the pick: `databricks-gpt-5-4-mini` (same as extractor, cheap)
   or a stronger one (`databricks-claude-sonnet-4-6` / `gemini-3-flash`) for the
   single high-stakes logo decision?
2. Contact sheet: light bg only, or light+dark tiles per cell (catches white-text
   logos, costs more image area)?
3. Keep the site-crawl SVG/PNG candidates as extra cells in the sheet, or go
   image-search-only?

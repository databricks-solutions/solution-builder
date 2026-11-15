# Flow B — Genie Code workshop

You reach this file from SKILL.md flow B (`Mode: workshop` in the system prompt, or an opening
message asking for a Genie Code workshop). It replaces stages 0–5; SKILL.md's shared sections
still apply as written (paths, efficiency + output discipline, `resources.json`, storytelling,
brand personalization, handling unknown components).

**What you deliver:** a hands-on workshop where an attendee builds a whole Databricks
solution **live with Genie Code**, one pasted prompt at a time. You do NOT build the solution
yourself. The deliverable is one self-contained page, `PROJECT/notebooks_html/workshop.html`,
plus the files the attendee's Genie Code reads and the data generator they run. Together they form
**the kit** (phase 4), with one home per fact:
- `README.md` — the story and the key numbers;
- `specifications/` — every name: tables, columns, dashboard, Genie, governance, ML;
- `CONTEXT.md` — a short primer that points Genie Code at those two (no story, numbers or names of
  its own);
- `data_generation/` — the generator.

## What changes vs the stages

- **No gates, no ideation.** The story is already picked (the opening message). Skip Stage 0's
  story proposals and the "Approve the story?" / "Ready to build?" gates; run straight through,
  with a one-line status between phases (SKILL.md → "Telling the user where you are").
- **Stage files for writing rules only.** Phases 1–2 use `stages/01-design-story.md` and
  `stages/02-write-specs.md` for how to write; when they say "return to SKILL.md", come back here.
  Never read `stages/03.1-build.md` or `03.1r`, and don't spawn subagents.
- **No resource provisioning.** Never create the pipeline, dashboard, Genie space, metric view,
  policies, model, app or Lakebase — the attendee builds those. `created_resources` stays `{}`,
  so the resource-suffix naming rule has nothing to apply to. The ONLY workspace action is the
  data test in phase 3, into the default catalog/schema from the system prompt.

The worked example to pattern-match is **`DEMO_SKILL_DIR/references/example-luxebeauty-workshop/`**
(read its `REFERENCE.md` first). Copy its shape, rewrite its content. For specs, data and cells it
replaces the `example-luxebeauty{,-simple}` references the stage files point at (the full
example is still the README style reference and the feature-store notebook, below).

`<slug>` below = the demo slug (used for tracking); the app names the kit folder
`<slug>_workshop/` from the project name.

## Pages ↔ capabilities

The reference workshop has one page per step. Keep a page when ANY of its capabilities is in
`resources.json` (`capabilities.buildable` or `capabilities.talking_track`, both count), and write
only the steps of the capabilities listed; drop the page when none is, and add a page (same pattern) for any workshop-capable
capability the reference doesn't cover. The capability list may have been trimmed or extended
by the user or the model — follow `resources.json`, not this table.

| Page | Capabilities |
|---|---|
| `00_introduction` — the hub: platform + story, get the kit into the workspace, one-time priming prompt, the flow strip | always (`genie-code`, `unity-catalog`) |
| `01_setup_and_explore` — pick catalog.schema, generate raw data, explore it | `synthetic-data-gen`, `notebooks-eda` |
| `02_build_pipeline` — silver (+ AI functions), data quality, gold, Lakeflow Job | `sdp`, `ai-functions`, `lakeflow-jobs` |
| `03_dashboard_and_genie` — AI/BI dashboard, Genie agent, certify | `aibi-dashboards`, `genie`, `genie-one` |
| `04_business_semantics` — metric view, Genie on it, Discover domain | `metric-views` |
| `05_governance` — ABAC on PII tags, data classification | `abac`, `data-classification` |
| `06_ml` — feature table, train + register, batch score | `ml-training-serving` (+ `feature-store`) |

Not available in a workshop: apps, Lakebase, PDF documents, Data Quality
Monitoring. Don't add pages for them. Data quality in the pipeline page is SDP expectations (part
of `sdp`).

**Feature store only when `feature-store` is in `resources.json`.** The reference ML page uses it;
without that capability, rewrite the same three steps the plain way: a regular gold feature table,
`mlflow` logging to Unity Catalog, plain batch scoring — no `FeatureEngineeringClient`,
`FeatureLookup`, `fe.*` call, or feature-store wording anywhere (README, specs, cells). When it
is selected, the prompts hint Genie Code toward the same deltas as
`example-luxebeauty/ml/premium_train_score_with_feature_store.py` (the step table in
`references/blocks/capabilities/feature-store.md`) — name the API in each prompt, since Genie Code
won't pick the feature store on its own:
- **feature table:** `FeatureEngineeringClient().create_table`, primary key = the entity id, features
  only (label out);
- **train:** key + label only → `FeatureLookup` + `fe.create_training_set`; encoding + model in one
  pyfunc returning the probability; `fe.log_model(training_set=...)`; then the `prod` alias;
- **score:** `fe.score_batch` on `@prod` with only the key, `result_type="double"`.
The checks confirm the table is under **Features** and the model's lineage points at it. No
point-in-time joins, online store or serving endpoint. `feature-store` without
`ml-training-serving` means nothing — ignore it.

## Phase 1 — Story

**Order.** The app shows progress from the files each phase writes: Story = `README.md`, Specs =
`CONTEXT.md`, Data = `data-check.md`, Workshop = the built page. Write `README.md` before you
generate any data (with the numbers the story needs; phase 3 replaces them with the measured ones),
then the specs and `CONTEXT.md`, then the data test and `data-check.md`, then the page. Writing
the specs while the generator runs is fine; skipping ahead to the data is not.

1. **Read the brief first** — SKILL.md → Stage 0's captured-brief rules (`context/source-brief.md`,
   `context/uploads/`, lossless intake) and → Brand personalization (`brand/brand.json`; a real
   company named in the brief is the story's company).
2. **Write `README.md` + `resources.json`** following `DEMO_SKILL_DIR/stages/01-design-story.md`
   for the writing rules (use `example-luxebeauty/README.md` as the style reference). The story must
   give **every kept page a beat**: the spike the dashboard shows, the "why?" Genie answers, and —
   when those pages are kept — the governed metric, the PII to protect, the thing ML predicts.
   `created_resources` stays `{}`.

Track: `python3 DEMO_SKILL_DIR/tools/track.py WORKSHOP_STORY <slug>`.

## Phase 2 — Specs + CONTEXT.md

1. **Write the specs** using `DEMO_SKILL_DIR/stages/02-write-specs.md` for the writing rules:
   `01-lakeflow.md` first (raw datasets → silver → gold, the story-shaping data rules), then only the
   specs the kept pages need (`02-uc-governance.md`, `03-ml-*.md`, `04-ai-bi.md`). Mirror the
   reference workshop's `specifications/` (not the simple/full examples). **No SDP SQL** — the
   attendee's Genie Code writes it live. Skip 02-write-specs' app spec (no apps here).
   The specs are where Genie Code finds every exact name, so each one must be complete for its
   page: raw layout and silver/gold columns (01), metric view, tags and policies (02), feature table,
   model and predictions (03), dashboard datasets and the Genie attach list, instructions, sample
   questions and curated SQL (04). Numbers stay in the README; a spec points to it.
2. **Write `CONTEXT.md`** — copy the reference's short primer and adapt it: who Genie Code is
   helping, ask for the catalog.schema, what to read in the folder (`README.md`, each spec file you
   wrote, the generator), the working style. Nothing else — no story, numbers or names.

Track: `python3 DEMO_SKILL_DIR/tools/track.py WORKSHOP_SPECS <slug>`.

## Phase 3 — Data generation + test (throwaway schema)

1. **Copy** `DEMO_SKILL_DIR/references/example-luxebeauty-workshop/data_generation/` to
   `PROJECT/data_generation/`, then **rewrite** `generate_data.py` for this story (read its
   docstring: keep the Spark-native idioms + the raw-parquet-to-Volume contract, replace all the
   domain content). Also invoke the `databricks-synthetic-data-gen` Databricks Agent Skill for
   patterns. It writes ONLY the raw datasets to `/Volumes/{catalog}/{schema}/raw_data/<dataset>/`.
   Never overwrite a dataset path that the same run still reads (Spark refuses): later steps must
   build from the in-memory DataFrame, not read the Volume back.
2. **Run it into the project's default catalog/schema** (system prompt → Databricks Resources;
   already created by the app). It is throwaway test data, kept afterwards. Run it with the active
   venv's `python` (system prompt → Python; add `databricks-connect` with `uv pip install` if it
   says it isn't pre-installed):
   ```bash
   DEMO_CATALOG=<catalog> DEMO_SCHEMA=<schema> python PROJECT/data_generation/generate_data.py
   ```
3. **Check the story with a few queries** on the Volume files (`read_files(...)` on the SQL
   warehouse, or Spark): every dataset has rows, the keys join, the anomaly shows up in the
   past at about the size the story claims, and the "why" (e.g. the incident note) is on the
   right rows. Put the real numbers in the README's Key Numbers and the pages.
   **Story over numbers.** A check passes when the story holds (signal visible, peak in the past,
   cause on the right rows, keys join), not when a number matches what the story guessed. Never
   re-run to nudge a magnitude: write the measured numbers into the README, the specs' validation
   checks and the pages instead. Fix each metric's definition before you measure it.
   **Stop condition.** If the run or a check fails, fix the generator and re-run — **at most 3 fix-and-rerun
   attempts**. After that, stop fixing: list the failing checks (name + numbers) for the user in the
   final message, and **still build the workshop page** (phase 4). If the workspace is unreachable
   or you lack permission, say so in the final message and continue with the page — don't invent a
   result.
4. **Write `data-check.md`** at the project root once the checks have run: one line per check
   (pass/fail + the measured number) and the attempt count. The app's Data step reads this file, and
   it stays out of the kit. Phases may overlap (copying `workshop/` early, writing specs while the
   generator runs), but write this file only after the checks, then update the README's Key
   Numbers and the specs' validation checks with what you measured. Report a check as passed only if it
   passed on the data as it is now: after any re-generation, re-run every check, not just the ones
   you changed.
5. Don't record the schema in `created_resources`. Mention it in the final message.

## Phase 4 — Build the workshop page

1. **Copy** `DEMO_SKILL_DIR/references/example-luxebeauty-workshop/workshop/` to
   `PROJECT/workshop/` and read `PROJECT/workshop/README.md` — the authoring rules (cells are
   free-form HTML, styles in `theme.css`, icons as `<i data-icon="name">`, the prompt block,
   `workshop.json`, `notebook.json` `nav`). Never read `icons/` or the built HTML.
2. **The kit the attendee receives.** One zip, two parts: `workshop.html` (opened in the
   browser, never uploaded) and `<slug>_workshop.zip` (unpacks to `<slug>_workshop/` with `README.md`,
   `CONTEXT.md`, `specifications/` and `data_generation/`), plus a generated `IMPORT.md` — no
   `.claude/`, no transcripts. The attendee imports that zip into their workspace (Import takes a
   zip, not a folder), creates a notebook in the folder it unpacks to, and opens Genie Code there. So every page must assume:
   - `README.md`, `CONTEXT.md`, `specifications/` and `data_generation/generate_data.py` sit **next to
     the notebook**.
   - Refer to files **by name** ("in this folder", `specifications/04-ai-bi.md`). No `../` paths, no
     "download the project as a zip" — the kit is what they get.
   - `00_introduction` has a short "get the kit into your workspace" step before the priming prompt.
3. **Rewrite every kept page's cells** for this story; delete the folders of dropped pages and add
   folders for new ones. Keep the reference's pattern: step-logo title, `N/` sub-headers, one prompt
   per step, an illustrative "you should see" visual where it helps, a next-step card at the end.
   Set `workshop.json` (title, brand, sub) and each `notebook.json` (`pill`, `nav`); the sidebar is
   generated from `nav`. Fix every `href="#nb-NN"` (flow strip, next cards) to the pages you kept.
   - **Prompts read like a human building**, natural and one step at a time — exact names live in
     the specs. Copy stays **short** (a line or two per step) — visuals over text.
   - The priming prompt (00) points Genie Code at `CONTEXT.md` "in this folder" and the files it
     lists (`README.md`, `specifications/`).
   - The data step (01) runs `data_generation/generate_data.py` from the kit folder for the
     attendee's catalog.schema.
   - Brand: when `brand/brand.json` exists, set the `--accent`/`--ink` tokens at the top of
     `theme.css` from its palette, and set `title`/`brand`/`sub` in `workshop.json`.
4. **Set `forbid`** in `workshop.json` to the reference's story terms (e.g. `LuxeBeauty`,
   `SKU-100`, `Lyon`, `Claire`, `Dubois`), so the build fails on any leftover.
5. **Build + check:** `python3 PROJECT/workshop/build.py`. It fails on an unknown icon, an empty
   page, or a `forbid` term anywhere in the page. Fix and re-run, **at most 3 times**; if it still
   fails, say which error remains in the final message.

Track: `python3 DEMO_SKILL_DIR/tools/track.py WORKSHOP_BUILT <slug>`.

## Done — tell the user

Two or three lines: the workshop is ready on the **Workshop** tab (download button there — the kit),
the story in one sentence, which pages it has, the throwaway schema (default catalog.schema) holding
test data they can dry-run against, and any data-test checks still failing (phase 3). If the
workspace was unreachable, say so here.

## Coherence checks (before you finish)

- Every table/column a prompt or visual names exists in the specs and in the generated data.
- The Volume subdirs `generate_data.py` writes match the `read_files()` paths in `01-lakeflow.md`.
- The "why" is reachable as a governed table Genie can join to (not only raw files).
- Numbers quoted in the pages (baseline, peak, affected count) match the README's Key Numbers
  and what you measured in phase 3.
- `CONTEXT.md` lists exactly the spec files you wrote.
- Pages, sidebar, flow strip and `resources.json` capabilities list the same steps.
- Every number and time phrase ("peak 3 weeks ago", "~$142K normal week") is the one your phase-3
  queries measured, phrased the way the page's own prompt will show it (same window, same grain).
- Every object a prompt relies on exists or is created by an earlier prompt: functions a policy
  calls, groups/personas a check uses, tags, the job name. Spell those out in the specs.
- When the brief names a real company, people at it are roles ("Head of Baggage Ops"), never
  invented names — the SA presents this to that company. Fictional companies can have personas.
- When the brief sets a duration, the page timings add up to it with slack; cut a page rather
  than squeeze.
- The generator is deterministic: explicit seeds only (never `hash()` of a string — it changes
  per process).
- No page refers to `../` paths or to downloading the project; no story term survives the build.

## Changing an existing workshop

The workshop mode **persists** for the project: a later message on a workshop project (even one
that doesn't say "workshop") stays in this flow. Don't switch to the build stages.

SKILL.md → "Modifying an Existing Project" applies, with these workshop specifics: also read
`CONTEXT.md` and the cells you'll touch; change the source (`workshop/`, never the built HTML);
ripple name/number changes through the README, specs, data generator and cells; "update the built
resource" means re-run the data test if the data changed (same 3-attempt limit), then rebuild the
page. A new capability means a new or extended page (see Pages ↔ capabilities), not a resource.

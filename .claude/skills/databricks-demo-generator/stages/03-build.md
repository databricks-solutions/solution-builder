# Stage 03 — Build Resources

Run this only after the user confirms at the stage-2 build-or-stop gate — creating the actual Databricks resources that implement the specs.

All resource files (.py, .sql, .yaml, …) must go in the project folder.

## Behavior rules (apply throughout)

**Don't narrate — call the tools.** Routine work ("I'll write the data-gen script", "Let me create the pipeline file") is just narration. Open Write/Edit and do it. Deeper thinking IS welcome on bug fixes, non-obvious code logic, and spec ambiguities — think, then write.

**Specs are approximations — story wins.** Inputs (formulas, distributions) and outputs (averages, rates) in the spec are written independently and usually don't algebraically close. Pick reasonable inputs, run, accept the result. If your output differs from the spec's predicted number, update the spec to match — don't retune inputs to chase a target. **Non-negotiable:** the story holds (persona, catalyst, demo flow, visible signal). **Negotiable:** exact magnitudes. **Story > spec > numbers.**

**Build-order gate.** Never create a downstream resource before its upstream data exists and is verified. Before creating any dashboard, Genie space, KA, or agent: verify every table/document it references exists and has rows. If a gate fails, STOP and fix upstream.

**Keep specs in sync.** If you change a resource during build (or the user asks you to), update its spec file first.

---

## How to build (the recipe everywhere applies)

The spec files in `PROJECT/specifications/` are your playlist. Walk them **in numbered order** (`01-lakeflow.md`, `02-uc-governance.md`, `03-…`, `04-…`, `05-…`, then `specifications/app/*.md` if there's an app). Each spec file says what to build; you use the matching ai-dev-kit skill to actually build it.

For each spec file:

1. Read the spec (the WHAT — names, columns, sample questions, etc.).
2. Read the matching ai-dev-kit skill at `SKILLS/<skill-dir>/SKILL.md` (the HOW — CLI, auth, validation). Pick from the *Available Skills* index in your system prompt; `ls SKILLS/` if unsure.
3. Create the resource using the CLI the skill documents. **Do NOT use MCP tools.**
4. Validate (verify rows, endpoint responses, etc).
5. Update `resources.json.created_resources` with the resource ID.

That's the loop. The rest of this file is **the order in which to apply it** — what runs sequentially, what runs in parallel as subagents.

---

## Step-by-step build order

Walk the spec files numerically. The numbering is the dependency order — `01` produces data that `03` (ML) consumes; `03` produces a predictions table that `04` (AI/BI: dashboard + Genie) and `05` (agents) both consume; everything else flows from there.
Remember, the spec could be anything. You must follow them, below are typical spec structure: 

### Step 1 — `01-lakeflow.md` (ON MAIN, sequential)

Always first. Everything downstream needs the tables to exist. Typically has (can vary per demo)

- **A. Synthetic data generation** — write the data-gen script (if the spec calls for one), run it, verify volume files exist. Invoke the `databricks-synthetic-data-gen` ai-dev-kit skill for the runtime / framework / writing patterns. **For simple demos** (no SDP), also lift `DEMO_SKILL_DIR/references/example-luxebeauty-simple/data_generation/generate_data.py` as a worked starting point — the Parquet-drop-on-Volume + inline `spark.sql` CTAS pattern is already wired. It's a syntax reference, not a fill-in-the-blanks template — schema, entities, IDs, story-shaping rules, time anchors, and the entire data narrative all change per demo.
- **B. Spark Declarative Pipeline** — write the SDP code, run the pipeline, verify Bronze/Silver/Gold tables populated. Only when `sdp` is in the buildable capabilities.
- **C. PDF** — Generate pdf documents for the demo (only when KA is in scope).

**Gate before step 2:** every Gold table referenced by downstream specs has rows. Quick `SELECT COUNT(*)` per table.

### Step 2 — If app exists, spawn the App subagent now (the only parallelization point)

`01-lakeflow.md` is done. If `specifications/app/` exists, **spawn the App subagent NOW** — before walking any other spec file. The App is ~5 minutes and there's no reason to make the rest of the build wait on it. If there's no `specifications/app/`, skip this step and go straight to Step 3. `[DEMO_SKILL_DIR]/app/app.md` contains the instructions to build the app.


**App is the only thing that runs in a subagent.** Everything else (`02-uc-governance.md`, `03-ml-*.md`, `04-ai-bi.md`, `05-agent-bricks.md`, anything custom the spec invented) runs on main. Don't create subagents for ML / Genie / KA / governance.

**Spawn rules:**

- **Foreground only.** `run_in_background: false` (the default). The harness blocks the main thread until the subagent reports back — but you don't wait idle; you do Step 3 in the meantime via the harness fanning out work.
- **Substitute every placeholder.** The subagent has no system prompt — `DEMO_SKILL_DIR`, `PROJECT`, `SKILLS` mean nothing to it. Replace them with real absolute paths before sending.

**Spawn this exact prompt** (replace the bracketed paths with absolute values from your system prompt):

```
You are a subagent spawned by the `databricks-demo-generator` skill, executing Stage 03 (build). Your single job: copy the app template, rewrite it for this demo's story, wire config to the built resources, and run the smoke test. Then return: list of files touched, the deployed app URL, and any placeholders you left in config/app.json.

Read these first, in one batched message:
- [DEMO_SKILL_DIR]/SKILL.md — to understand the context
- [DEMO_SKILL_DIR]/app/app.md — the build walkthrough (copy template → customize → wire config → smoke test).
- [PROJECT]/README.md — demo story, persona, walkthrough. READ THIS — do not rely on a summary.
- [PROJECT]/specifications/01-lakeflow.md — table schemas your app code references.
- All files under [PROJECT]/specifications/app/ — the app spec the parent wrote in Stage 2. This is your design source of truth; do not rewrite it.
- [PROJECT]/resources.json — IDs already built (catalog, schema, warehouse_id, pipeline_id, lakebase_*).

Late-fill rule. Some IDs aren't ready yet — Genie space, dashboard, and MAS endpoint are being built in parallel on the parent's main thread. For each one that's missing from resources.json, write a placeholder into app/config/app.json:
- "genieSpaceId": "__LATE_FILL_GENIE__"
- "dashboardId": "__LATE_FILL_DASHBOARD__"
- "masEndpointName": "__LATE_FILL_MAS__"
Finish the full app rewrite with placeholders. The parent backfills the real values after you return.

Smoke test — start, then always stop. After the rewrite is done, run ./start.sh for the smoke test (see app.md Step 5). Let it boot ~60s, capture the log, verify it serves the home page, fix any issue, restart, then UNCONDITIONALLY kill the process. In the future, the UI owns the process lifecycle afterwards; a leftover ./start.sh is an orphan. Placeholders are fine for the smoke test — the app boots; agent calls happen post-handoff after the parent backfills.

Scope:
- Do NOT spawn further subagents.
- Do NOT ask the parent questions — if a design point is ambiguous, follow the app spec; if the spec is silent, make a reasonable choice and note it in your return.
- Do NOT edit any file outside [PROJECT]/app/.
- Speed: batch reads in one message, batch independent writes in one message.

Completion format (one short summary at the end):
- Placeholders left: list of __LATE_FILL_*__ keys still in app/config/app.json.
- Any issues / non-obvious choices.
```

**Status line you say to the user** (one line, no follow-up question):
*"App subagent spawned (~5 min), continuing the build on main."*

**Small iterations after the first build go on main.** Subagents are only for the initial generation. User-requested tweaks afterward — UI text, an extra column, a bug fix — happen on the main loop so the user can see your thinking.

### Step 3 — Walk the remaining specs on main (in numbered order)
While the App subagent (if any) runs in the background, work through the rest of `specifications/` numerically on the main thread. Go over the spec and build every resource, 1 by 1, typically (but can vary based on the story and the capabilities requested):

- `02-uc-governance.md` — UC grants, metric views, row-level security.
- `03-ml-*.md` — :  ML train / register / inference, usually as a serverless job (10–15 min), usually the predictions table must exist before building 04 or 05 if either consumes it.
- `04-ai-bi.md` — Genie space, then dashboard (sequential). May read the predictions table from `03`.
  - **Dashboard**: invoke the `databricks-aibi-dashboards` ai-dev-kit skill — it owns the JSON shape, encoding rules, and grid math. Cross-reference `DEMO_SKILL_DIR/references/blocks/capabilities/aibi-dashboards.md` for the load-bearing patterns (color pinning, frame descriptions, symbol-map coordinates, sankey top-N bucketing, silent-failure pitfalls).
  - **For simple demos** (no SDP / KA / MAS / ML), additionally lift `DEMO_SKILL_DIR/references/example-luxebeauty-simple/dashboard/dashboard.json` as a worked starting point — every encoding shape, color pin, frame description, and section divider you need is already in there. **It's a syntax reference, not a fill-in-the-blanks template** — the demo's story, persona, widget set, positions, colors, descriptions, and dataset SQL all change per build; lift only what the current story actually needs.
- `05-agent-bricks.md` — KA, then MAS (sequential; KA needs unstructured docs if the spec calls for them — generate those first as part of this step). May call Genie over the `03` predictions table.
- Anything else the spec invented — pick the matching ai-dev-kit skill, build, validate, record the ID.

**Hands off `app/` while the App subagent runs.** Don't read or write any file under `app/` until the subagent returns. Two threads writing the same files is a race condition. **Once the App subagent returns**, `app/` is yours again — backfill placeholders, do user edits, fix smoke-test bugs.

**If nothing's left on main and the App subagent is still running, wait.** Waiting is correct.

### Step 4 — Backfill the app (only if app agent was created)

If the app is defined, once the app subagents return:

- **App late-fill.** The App subagent runs with placeholder IDs for resources still in flight when it spawned. Replace them in `app/config/app.json`:
  - `"__LATE_FILL_GENIE__"` → `resources.json.genie_space_id`
  - `"__LATE_FILL_DASHBOARD__"` → `resources.json.dashboard_id`
  - `"__LATE_FILL_MAS__"` → `resources.json.multi_agent_supervisor_endpoint`
  Verify nothing left: `grep -r __LATE_FILL_ app/config/` returns empty. No redeploy — `app/config/app.json` is read at boot.


### Final review:
Make sure you created all the Databricks resources according to the story and the spec files, and that they're all in the resources.json file
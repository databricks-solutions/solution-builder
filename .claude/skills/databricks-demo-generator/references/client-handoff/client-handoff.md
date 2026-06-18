# Client Handoff — authoring guide

> **`SKILL_VERSION: 1.1`** — the single source of truth for this skill's version. Stamp this EXACT value into `ADAPTATION_FACTS.skill_version` (Step 5.5) AND the generated adaptation `SKILL.md` (Step 6) so a stale shipped skill is detectable by comparing the two. Bump it when you change the handoff contract.

When asked to make a built + DAB-packaged demo "client-ready" or "handoff-ready", apply this transformation. The result is a self-contained, IP-stripped, Genie-Code-skill-bundled project the SA can publish as a public git repo (or hand directly to the client). The single shipping artifact is a ZIP archive.

## Prerequisites

This stage operates on a project that already has Stage 3 (Build) and Stage 4 (Package as DAB) outputs. Detect missing prerequisites and **offer to run them first** — never hand-craft a stub DAB from specs alone. Stage 4 owns `databricks.yml` generation; this stage transforms what Stage 4 produced.

## Inputs

- A project directory containing at minimum: `README.md`, `resources.json` (with non-empty `created_resources`), `specifications/`, `databricks.yml`.
- Real source files (`src/**/*.py`, `src/**/*.sql`) or inline job/pipeline definitions referenced from `databricks.yml` / `resources/*.yml`.
- (Optional) `databricks.prod.yml` — deleted during handoff.
- (Optional) `dab_instructions.md` from Stage 4 — rewritten in Step 4 below.

## Outputs (each is produced by a numbered Algorithm step — see mapping)

| # | Output | Produced by |
|---|---|---|
| 1 | Modified `databricks.yml` with synth-data toggle + targets-pattern + migrated variable refs + de-hardcoded catalog/schema literals | Step 3 (3.1–3.2b) |
| 2 | Stripped environment fingerprint across all non-bundle files + `resources.json` | Step 2 |
| 3 | Updated `dab_instructions.md` — client-oriented deploy commands | Step 4 |
| 4 | Auto-patched Stage-4 codegen defects (widgets API, cluster security mode) | Step 5.0 — see `presubmit.md` |
| 4b | `ADAPTATION_FACTS.json` — introspected per-demo facts contract the adaptation skill reads | Step 5.5 |
| 5 | `.assistant/skills/<demo-slug>-adaptation/` — Genie Code skill (in-repo; installed by the 3-line CLI snippet in README Step 8) | Step 6 |
| 6 | `ADAPTATION_GUIDE.md` — human-readable conversion guide | Step 7 |
| 7 | `README.md` updated with a "First Run (Client)" section (v1.1 — uses CLI snippet, not setup target) | Step 8 |
| 8 | (Optional) `HANDOFF_NOTES.md` — SA-facing log of intentional stubs + manual TODOs | Step 9 |
| 10 | Final diff summary printed to the SA | Step 10 |
| 11 | `<demo-slug>-client-handoff.zip` — the shipping artifact | Step 11 |

## Algorithm

> **Hard-gate rule:** If **Step 5 (Validate)** fails, STOP. Do not write the Genie Code skill (Step 6), `ADAPTATION_GUIDE` (Step 7), README "First Run" section (Step 8), `HANDOFF_NOTES` (Step 9), diff summary (Step 10), or ZIP (Step 11). Report each validation failure with the exact file path and the manual fix required, then exit. The point of the gate is to never ship a broken bundle to a client.

### Step 1 — Prerequisite check (strengthened)

A non-empty `resources.json.created_resources` + a present `databricks.yml` are **necessary but not sufficient.** Verify all of the following:

1. **`resources.json`** exists and `created_resources` is **non-empty** (Stage 3 ran).
2. **`databricks.yml`** is present at project root (Stage 4 ran).
3. **At least one source asset exists.** One of:
   - `src/**/*.py` or `src/**/*.sql` files, OR
   - inline `tasks:` / `notebooks:` / `libraries:` blocks inside `databricks.yml` or `resources/*.yml`.
   If none, Stage 4 produced a hollow bundle — fail prereq.
4. **`include:` paths resolve.** If `databricks.yml` has `include: - resources/*.yml`, glob and confirm at least one file matches. If none match, either drop `include:` in Step 3 or fail prereq.
5. **Synth-data generator path matches specs.** If specs reference synthetic data or `src/data_generation/`, that path must exist on disk. If absent, either fail prereq OR document `# TODO(client-handoff): no synth generator — client must wire real data via Step 3` in `HANDOFF_NOTES.md`.
6. **Resolve `{{run-target}}` — pipeline OR job (do NOT assume a job).** Read `databricks.yml` (and any `resources/*.yml` referenced by `include:`) and pick the primary run target: the resource that materializes the demo's tables. It may be `resources.jobs.<key>` OR `resources.pipelines.<key>` — many demos are pipeline-only (no job at all). Record both its `kind` (`pipeline`|`job`) and `resource_key`. Steps 4, 7, 8 need it for the `databricks bundle run <key>` command; Steps 5.5 and 6 record it in `ADAPTATION_FACTS.json` (`deploy_target`). If both a job and a pipeline exist, the primary is the one that produces the gold tables. If neither exists, fail prereq. *(Older drafts said "primary job's key" — that assumed a job and broke on pipeline-only demos.)*
7. **Resolve `{{demo-slug}}`.** Derive from the project's `bundle.name` in `databricks.yml` (or from the project folder name as fallback). Record it — Steps 6 and 11 need it.

If any check fails, prompt:
> "Stage 5 (Client Handoff) needs <missing prereq>. Run <missing stage> now and continue with handoff?"

On `yes`, invoke the missing stage(s) per `SKILL.md`'s stages table, then resume at Step 2. On `no`, stop with: "Cannot proceed — Stage 5 requires <X>." **Never hand-craft a stub from specs alone.**

### Step 2 — IP-strip (environment fingerprint only — defer structural `databricks.yml` rewrite to Step 3)

Scope: strip environment fingerprint from non-bundle files + `resources.json`. **Step 2 may lightly touch `databricks.yml` to scrub obvious fingerprints** (workspace block, top-level `host:`) but **Step 3 owns the structural rewrite** to the targets pattern. Avoid editing the same file twice in conflicting ways.

Preserve: story, persona, narrative, capability mix — those are the demo's value.

Files and replacements:

| File / pattern | Action |
|---|---|
| `databricks.yml` → `workspace.host`, `workspace.profile`, `workspace.root_path` (top-level) | Remove or replace with empty placeholder — Step 3 will rewrite the file structurally. Don't touch `variables:` yet. |
| `databricks.yml` → `variables.catalog`, `variables.schema` (or other SA-specific real catalog/schema defaults) | Note them for Step 3 — Step 3 renames + replaces defaults. Don't strip them here. |
| `databricks.prod.yml` | Delete entirely. `databricks.prod.yml.example` (if present) ships with all values blanked. |
| `resources.json` → `created_resources.*` | Replace EVERY workspace-specific value (`warehouse_id`, `pipeline_id`, `dashboard_id`, `genie_space_id`, `knowledge_assistant_id`, `app.id`, `lakebase_project_id`, `mlflow_experiment_path`, `workspace_folder`) with `"<created-on-deploy>"`. Don't trust nested keys to be flat. |
| `dab_instructions.md` (from Stage 4) | Strip FE URLs, SA emails, SA-Workspace paths, and references to SA-only targets (`dev`, `prod`, etc.). Step 4 rewrites this for the client. |
| `app/.env`, `app/config/*.json` containing workspace IDs | Strip workspace-specific IDs to placeholders; preserve structural keys. |
| Any `*.md`, `*.py`, `*.sql`, `*.yml` matching `/(e2-demo-field-eng|fevm-[a-z0-9-]+)\.cloud\.databricks\.com/` | Replace with `<your-workspace-url>`. |
| Any `@databricks.com` email | Replace with `<your-email>`. |
| Any path `/Workspace/Users/[^/]+/` referring to the SA | Replace `[^/]+` with `<your-username>`. |
| Any `.env` (not `.env.example`) | Delete. |
| `META-PROMPT.md` (SA-scaffolding from the demo-generator template) | Delete — SA-internal bootstrap doc, no client value. |
| `raw_data/pdf/` and `raw_data/html/` duplicates (e.g., `01_brand_voice_guide.pdf` AND `brand_voice_guide.pdf`) | SHA-hash dedupe (`shasum -a 256`). On collision, keep the numeric-prefixed canonical name (`<NN>_<topic>.{pdf,html}`), delete the unprefixed variant. Record in `HANDOFF_NOTES.md`. Why: KA double-indexes duplicates → duplicate MAS citations; HTML dupes also bloat the ZIP. |

After stripping, **record** the strip counts (e.g., "7 FE-workspace URLs in 3 files, 4 emails in 2 files, ...") — Step 10 prints the final summary. **Do not print a summary here**; Step 2's job is to strip, not to talk.

### Step 3 — Restructure `databricks.yml` + migrate variable refs + wire the synth toggle

Read `templates/databricks.yml.patch.md` for the canonical recipe. This step does FOUR things — all of them, in this order:

#### 3.1 — Reshape `databricks.yml` to the client-targets pattern

- Top-level `bundle.name: <demo-slug>` and `include: - resources/*.yml`.
- Top-level `variables:` block declares `run_with_synthetic_data` (default `"yes"`), `client_catalog`, `client_schema`, `warehouse_id`, plus any demo-specific vars (model endpoints, Genie/KA IDs, etc.). Defaults are placeholders like `"<your_catalog>"`.
- `targets.client:` with `default: true`, `mode: production` (or omit `mode:` — defaults to production), `workspace.host: https://<your-workspace>.cloud.databricks.com`, and a `variables:` override block repeating the placeholders. **Do NOT use `mode: development`** — it prepends `dev_<username>_` to every DAB resource (schemas, volumes, jobs, pipelines, dashboards) but does NOT prefix `${var.client_schema}` substitutions, producing a schema-vs-pipeline divergence the client can't reconcile. Discovered 2026-05-29 V1 Phase E8.
- **No other targets ship** — the SA's `dev` / `prod` working targets are stripped.

#### 3.2 — Migrate ${var.*} references across the ENTIRE project tree (critical)

Stage 4 typically emits `${var.catalog}` / `${var.schema}` (matching upstream's `references/dab/example_databricks.yml`). The handoff renames these to `${var.client_catalog}` / `${var.client_schema}` to match the new variable definitions, the skill, and the README. **Apply the rename everywhere the old names appear** — silent leftovers will cause `bundle deploy` failures with unhelpful "variable not found" errors.

Run (across `databricks.yml`, `resources/*.yml`, `src/**/*.py`, `src/**/*.sql`, pipeline configs, app configs):

| Find | Replace |
|---|---|
| `${var.catalog}` | `${var.client_catalog}` |
| `${var.schema}` | `${var.client_schema}` |
| `${var.warehouse_id}` | (unchanged — keeps same name) |
| `spark.conf.get("demo.catalog")` (in Python bronze) | `spark.conf.get("demo.client_catalog")` |
| `spark.conf.get("demo.schema")` | `spark.conf.get("demo.client_schema")` |

**Pick ONE convention and apply globally.** Don't leave a mix of `catalog` and `client_catalog` — that produces footguns. We use `client_catalog` / `client_schema` because the Genie Code skill, the README "First Run" section, and the ADAPTATION_GUIDE all reference those names.

#### 3.2b — De-hardcode RAW catalog/schema LITERALS (not just `${var.*}` refs) — [CODEGEN-CLEANUP]

3.2 above migrates `${var.*}` *references*. But Stage 4 also bakes the SA's **raw catalog/schema literal** (e.g. `acme_prod_catalog`, schema `quality_analytics`) directly into source — these are NOT `${var.*}` refs and the 3.2 table will not catch them. Left in, they ship the SA's workspace identity to the client AND make the bundle deploy data into the SA's catalog instead of the client's. (Stage-4 defect — see `dab-defects-catalog` / D-CATLIT; this sub-step retires when Stage 4 stops emitting literals.)

**Detect first.** Read the real catalog/schema from the *original* (pre-Step-2) `databricks.yml` `variables.catalog`/`variables.schema` defaults, then grep the whole tree:

```bash
grep -rIn -e "<real_catalog_literal>" -e "<real_schema_literal>" src/ resources/ databricks.yml | grep -v '\${var\.'
```

**De-hardcode by file type** (the mechanism differs — apply the one that's verified to work for each; do NOT invent SQL substitution):

| File type | Fix |
|---|---|
| `databricks.yml` `variables.*.default` | → placeholder (`"<your_catalog>"` / `"<your_schema>"`). Handled by 3.1. |
| Pipeline resource (`resources/*.yml` `pipelines.<k>.catalog`/`.target`) | → `${var.client_catalog}` / `${var.client_schema}`. This parameterizes the **output** location. |
| Dashboard resource (`resources/*.yml` `dashboards.<k>.dataset_catalog`/`.dataset_schema`) | → `${var.client_catalog}` / `${var.client_schema}`. (If the dashboard already uses these, no action.) |
| Python (`*.py` — data-gen, scoring) | Read from config, not a constant. Three cases by how the file runs: **(a) pipeline** → `spark.conf.get("demo.client_catalog")`; **(b) job/notebook** → `dbutils.widgets.text(...)` + `dbutils.widgets.get(...)`; **(c) standalone Databricks Connect script** (runs outside any pipeline/job — common for data generators) → neither conf nor widgets are auto-populated, so use `spark.conf.get("demo.client_catalog", "<your_catalog>")` with a placeholder fallback default, and note in `HANDOFF_NOTES.md` that the client must set that conf (or edit the constant) before running the generator. Replace every literal occurrence regardless of case. |
| **SQL pipeline `read_files()` SOURCE path** (`'/Volumes/<cat>/<sch>/...'`) | SQL string literals can't take a variable: Databricks SQL named params are `:name` *bind values* (cannot build a path string), and there is no supported `${...}` textual substitution into a `read_files` path. **Convert that one ingestion to Python** per `databricks.yml.patch.md` §3 (`spark.conf.get` + f-string path), DELETE the original `*_bronze.sql`, update `pipeline.libraries[]`/`glob` to include the `.py`, and record the conversion in `HANDOFF_NOTES.md`. The output catalog/target are already parameterized by the pipeline resource, so only the source path needs this. |
| `genie_space.json` | Replace every `<cat>.<sch>` literal with the placeholder/token convention. **Note:** `bundle deploy` does NOT create the Genie space (it's only `sync.include`'d, never a DAB resource — see D-CATLIT/DAB-skips-Genie). So the literal here is off the deploy path, but it still must be stripped (IP) and the adaptation skill / `dab_instructions.md` must tell the client how their Genie space is (re)created against their catalog. |

After de-hardcoding, the Step 5 grep gate (broadened) confirms zero raw literals remain anywhere in shipped files. If a literal can't be safely de-hardcoded (unusual structure), leave a `TODO(client-handoff)` and let Step 5 hard-fail — never silently ship the SA's catalog.

#### 3.3 — Wire the synth-data toggle into the actual job/pipeline (not just the root YAML)

Two patterns — pick whichever fits the demo's existing structure:

- **Pattern A — DAB `condition_task`** (preferred): gate the synth-gen task with `${var.run_with_synthetic_data} == "yes"`. **Multi-task jobs — guard the gate fan-out:** when a `condition_task` evaluates false, its downstream is marked skipped, and any task that `depends_on` it under the DEFAULT rule (`ALL_SUCCESS`) is skipped too. So on the real-data path (`"no"`) every task sequenced AFTER the synth-gen — Genie/KA/dashboard deploy, pipeline trigger, etc. — would be silently skipped. Gate ONLY the synth-gen task; for each downstream task that must still run, add `run_if: ALL_DONE` (or `NONE_FAILED`/`AT_LEAST_ONE_SUCCESS` as fits). Verify with `databricks bundle summary -t client` that the real-data path still reaches table creation + every deploy task. (Found 2026-06-18 on FreshMart: `deploy_genie` depended on `generate_data`; without `run_if: ALL_DONE` the real-data path skipped Genie deployment.)
- **Pattern B — notebook early-return**: inject `if os.environ.get("RUN_WITH_SYNTHETIC_DATA", "yes") == "no": dbutils.notebook.exit("Skipped — using client data")` at the top, and pass via `base_parameters`.

For SDP/pipeline bronze: SDP SQL **cannot** interpolate Spark conf vars in `read_files()` — Python bronze is required. If the existing bronze is SQL, convert it per `databricks.yml.patch.md` Section 3, DELETE the original `*_bronze.sql`, update `pipeline.libraries[]` to the `.py`, and record the deletion in `HANDOFF_NOTES.md`. (Alternative: leave a `TODO(client-handoff)` and let Step 5 hard-fail — never silently continue.)

#### 3.4 — App demos: preserve Stage 4 artifacts

If the demo includes an Apps deploy (per Stage 4's `artifacts.default.build` + `sync.include` for `app/dist/**`), preserve those blocks. They handle the app build + sync correctly already; no rewriting needed. App-specific deploy steps (Lakebase scripts, etc.) belong in Step 4's `dab_instructions.md`, NOT as new bundle resources.

#### 3.5 — Leave TODO markers where automation can't be perfect

Format: `# TODO(client-handoff): verify <X> still works for client_catalog/schema`. Step 5 validation flags critical-path TODOs (pipeline source, synth gate) as hard fails; non-critical-path TODOs (cosmetic thresholds, optional features) are reported as warnings.

**Expected exception — external/standalone data-gen.** When the synthetic-data generator runs OUTSIDE the bundle (a standalone Databricks Connect script, not a DAB job task or pipeline node), there is no pipeline/job hook to gate `run_with_synthetic_data` against, so a synth-toggle `TODO(client-handoff)` in pipeline config is the NORMAL, expected outcome — not a defect needing per-run SA sign-off. Surface the toggle into pipeline `configuration:` (so the value is at least threaded), record the limitation in `HANDOFF_NOTES.md`, and treat this specific TODO as accepted automatically. Step 5 should NOT hard-fail on it. (Only a TODO that leaves the pipeline unable to find its DATA is a true critical-path fail.)

#### 3.6 — (removed in v1.1)

v1's `setup` bundle target is gone in v1.1. The skill install machinery is now the 3-line CLI snippet in Step 8's README template. Stage 5 must NOT emit a `setup` target, `resources/setup.yml`, or `src/setup/install_skill.py` — if you're writing any of those, you're on the v1 path. (DAB v1.1.0 doesn't support `${resources.jobs.<key>}` self-reference, so the v1 setup target inherited all bundle resources and failed at terraform apply on placeholder values — observed on FEVM 2026-06-02.)

### Step 4 — Rewrite `dab_instructions.md` for the client

Replace Stage 4's SA-oriented instructions with a client-oriented version. The SA reading `dab_instructions.md` won't be the SA anymore — it's the client. Include:

- **Authentication**: `databricks auth login --host <your-workspace-url> --profile MY_WORKSPACE` (placeholder host).
- **Default target = `client`**: `databricks bundle deploy` (no `-t` flag needed because `default: true` on the client target) OR explicit `databricks bundle deploy -t client`.
- **First run is synth-data**: no catalog/schema/warehouse edits required for the first deploy. Genie Code will help with real-data swap later.
- **First-run command**: `databricks bundle run <resolved-job-name>`.
- **If App + Lakebase**: keep the three-command pattern from upstream `references/dab/dab.md` but with client placeholders. Reference Lakebase setup scripts (e.g., `cd app && ./scripts/lakebase-setup.sh`) here, not as new bundle resources.
- **Remove**: any reference to SA dev/prod targets, SA workspace URLs, SA emails, the `dab.md` Stage 4 boilerplate.
- **Point to** `ADAPTATION_GUIDE.md` for real-data swap and to the Genie Code skill for interactive help.

If `dab_instructions.md` didn't exist (Stage 4 didn't emit one), create it.

### Step 5 — Pre-submit auto-fix + validate the bundle (HARD GATE)

This is the gate. Two phases: **5.0 auto-fix** (patches known upstream Stage-4 codegen defects so the bundle deploys cleanly) then **5.1 validate** (the official gate). If any non-auto-fix check fails, **stop** — do not proceed to Steps 6–11. Report each failure with the file path and the exact fix needed, then exit.

#### 5.0 — Run the pre-submit auto-fix + checks (HARD-GATE — do not skip)

**STOP.** Invoke `presubmit.md` (sibling file) against `HANDOFF_DIR = <project root>` before writing anything in Steps 6–11. Do not proceed until presubmit reports `OVERALL: PASS`. Paste its full output into Step 10's diff summary as evidence.

Presubmit auto-fixes two Stage-4 codegen defects (`dbutils.widgets.addText` → `.text`; missing `data_security_mode: SINGLE_USER` on `new_cluster:` blocks) and runs detect-only checks (IP-strip, v1-artifact exclusion, bronze-layer shape, Genie Code skill placeholders, `databricks.yml` shape). If any detect-only check fails, fix and re-run 5.0 until clean. Log every auto-fix — Step 10 needs them.

#### 5.1 — Run the official validate gate

```bash
databricks bundle validate -t client    # exit 0 required
databricks bundle summary -t client     # human-readable shape check
```

Validation checklist (every item must pass):

- `bundle validate` exits 0 with no errors.
- `bundle summary` resolves every variable to either a sensible default (`"yes"` for `run_with_synthetic_data`) or a placeholder the client will fill in.
- **Grep clean across all shipped files** — none of these strings remain:
  - `e2-demo-field-eng`, `fevm-` (FE workspace fingerprints)
  - `@databricks.com` (SA email)
  - `/Workspace/Users/<sa-username>/` (SA workspace paths)
  - `databricks.prod.yml` (deleted file shouldn't be referenced)
  - **The SA's real catalog/schema literal anywhere in shipped files** (not just the Genie skill). Take the real catalog/schema from the original pre-Step-2 `databricks.yml` defaults and grep all of `src/`, `resources/`, `databricks.yml`, `*.json` (genie/dashboard), and the bundled adaptation skill: `grep -rIn -e "<real_catalog>" -e "<real_schema>" src/ resources/ databricks.yml *.json .assistant/ | grep -v '\${var\.'` must return zero **true** hits. Any true hit means 3.2b missed a literal. **Expected non-hits to ignore:** a DAB resource KEY derived from the schema name (e.g. schema `quality_analytics` → resource key `quality_analytics_pipeline`) is identical for every client and is NOT a fingerprint — filter it with `| grep -vE '<real_schema>_[a-z]'` (or eyeball that the only matches are `<schema>_pipeline`/`<schema>_job`-style keys). Generic placeholders / `${var.client_*}` only — never a real catalog name. Discovered 2026-05-29 V3 (Genie skill); broadened to all files 2026-06-18 after D-CATLIT (raw literals in bronze SQL + genie_space.json on Lakeside).
- **`include:` patterns match real files.** Grep `include:` lines in `databricks.yml`, glob the patterns, confirm every glob has ≥1 match.
- **No orphaned `${var.catalog}` / `${var.schema}` refs.** `grep -rE '\$\{var\.(catalog|schema)\}'` across project root must return zero matches (only `${var.client_catalog}` / `${var.client_schema}` should remain).
- **No critical-path `TODO(client-handoff)` in pipeline source, synth gate, or `databricks.yml`** — unless the SA has explicitly accepted manual follow-up (record acceptance in `HANDOFF_NOTES.md` at Step 9; carry it forward for Step 10's summary).
- **Deploy scripts use the current databricks-sdk API shape.** The reference scripts in upstream `references/dab/scripts/` are the contract. Grep `src/deploy/*.py` for stale patterns — `page_token`, `next_page_token`, `resp.<plural> or []`, or `create_<thing>(display_name=...)` kwargs — and flag any hit as a Step 5 WARNING (not a hard fail). Surface in HANDOFF_NOTES.md. Discovered 2026-05-29 V1 Phase E8 — `deploy_ka.py` and `deploy_genie.py` shipped by the demo-generator hit this and broke `harvestly_setup` until manually patched. **RETIRING [A]:** upstream main FIXED these scripts (commit `c91544c` / #64; databricks-sdk floor ≥0.114). Demos generated from post-#64 main no longer hit this — keep this WARNING only while pre-#64 forks circulate; drop it once all builds are post-#64.

On failure: emit a structured report:

```
Step 5 — Validation FAILED.
  - databricks bundle validate exited 1 with error: <error text>
  - resources/jobs.yml line 42: orphaned ${var.catalog} — rename to ${var.client_catalog}
  - <other failures...>
Aborting before Step 6. Manual fixes required.
```

Do not write skill, ADAPTATION_GUIDE, README client section, HANDOFF_NOTES, diff summary, or ZIP. The point of the gate is to never ship a broken bundle.

### Step 5.5 — Generate `ADAPTATION_FACTS.json` (introspected facts contract) — [NOVEL]

Runs only after the Step 5 gate passes (it reads the FINAL restructured + de-hardcoded bundle). Produces `<project>/ADAPTATION_FACTS.json` — the deterministic, per-demo facts the adaptation (Genie Code) skill READS instead of reconstructing context at runtime. Schema + per-field derivation rules: `templates/ADAPTATION_FACTS.schema.json`.

**Compute every value by introspecting THIS project's own files — never assume a medallion/RFM/table-family shape.** Derivations (all read from the post-Step-3 bundle):

1. `skill_version` — copy the handoff-skill version constant (stamp the identical value into the adaptation SKILL.md in Step 6 so staleness is detectable).
2. `demo_slug` — `bundle.name` (fallback: folder name).
3. `name_vars` — read the `variables:` block: the catalog/schema/warehouse variable names after 3.2 migration (e.g. `client_catalog`).
4. `deploy_target` — the `{{run-target}}` resolved in Step 1.6: `{kind: pipeline|job, resource_key, run_command}`.
5. `source_inputs[]` — for each bronze/ingest definition classify `source_type`: `read_files(`/`cloud_files(` or `format("cloudFiles")` → `volume_files`; reads another UC table via `STREAM`/`readStream.table`/`stream(...)` → `uc_streaming_table`; `FROM <cat>.<sch>.<tbl>` or `spark.read.table` → `uc_static_table`. Record `locator` with catalog/schema shown as the variable token, not the literal.
6. `table_contract` (by layer) — for each table: `produced_columns` from the explicit SELECT list; if it's `SELECT *` from a source (not statically knowable) set `null` + add an `unresolved[]` entry. `consumed_columns_downstream` = columns the downstream SQL/py/dashboard/genie actually reference (always computable).
7. `dependency_map[]` — parse each ST/MV's FROM/JOIN for `upstream`; invert for `downstream`. `dashboard_refs` from the dashboard JSON datasets; `genie_refs` from `genie_space.json` `data_sources`/`instructions`.
8. `grain_constraints[]` — `candidate_columns` from GROUP BY (+ CLUSTER BY / PARTITIONED BY → `partition_clause`). `min_partition_size` is DATA-DEPENDENT: leave `null` + `unresolved[]` unless you ran a live row-count query at handoff.
9. `verify_queries[]` — emit parameterized verify SQL (using `${catalog}.${schema}` tokens) per transform type present, derived from `table_contract` + `grain_constraints`.
10. `lock_targets[]` — derive per task class from `dependency_map` + `source_inputs` (e.g. for `rename_column`, lock the ingestion-contract files). Use the family vocabulary the adaptation skill matches on — rename family (`rename_column`/`rename_table`), transform family (`add_metric`/`change_grain`/`add_segment`/…), `setup`. Every path must exist on disk.

**FAIL CLOSED.** Any field you cannot derive with confidence is `null` AND gets an `unresolved[]` entry `{field, table?, reason, needs_author_input: true}`. A wrong fact (e.g. an incorrect dependency map) is worse than a missing one — the adaptation skill halts on unresolved facts rather than guessing.

**Validate before writing:** the emitted JSON must conform to `ADAPTATION_FACTS.schema.json` (required keys present; enums valid). If it doesn't, fix the generation — do not ship a malformed facts file. Ship `ADAPTATION_FACTS.json` at the project root (included in the Step 11 ZIP).

### Step 6 — Drop the Genie Code skill bundle (in-repo carrier; CLI snippet in README copies to canonical path)

Generate the skill files into `<project>/.assistant/skills/<slug>-adaptation/`. This in-repo path is the source the README Step 8 CLI snippet copies to `/Workspace/Users/<user>/.assistant/skills/<slug>-adaptation/` (the canonical path Genie Code auto-loads from per Databricks docs — it does NOT auto-discover from the in-repo path).

1. Read the templated skill from `templates/genie-code-skill/SKILL.md`.
2. Resolve placeholders:
   - `{{demo-slug}}` → from Step 1.
   - `{{demo-name}}` → from `README.md` title (e.g., "Harvestly Co. — Loyalty Segmentation").
   - `{{demo-persona}}` → the protagonist named in README (e.g., `Harvestly Co.`).
   - `{{job-name}}` → from Step 1. *(No longer used by the genie-code-skill template, which now uses `{{deploy_target.run_command}}`; still used by Steps 7–8's README/guide.)*
   - `{{skill-version}}` → the `SKILL_VERSION` value from the top of this file. Stamp the IDENTICAL value into `ADAPTATION_FACTS.skill_version` (Step 5.5) so the shipped skill and facts file agree — the adaptation skill's entry gate compares them to detect a stale package.
   - `{{deploy_target.run_command}}` → from `ADAPTATION_FACTS.deploy_target.run_command` (Step 5.5) — the pipeline-or-job run command.
   - `{{table-names}}` (and any dependency/grain/source facts the template needs) → read from `ADAPTATION_FACTS.json` (Step 5.5) — it already introspected tables, layers, dependency map, and source types from the actual bundle. This is the canonical source now: do NOT re-derive from specs and do NOT read `resources.json.created_resources` (Step 2 gutted that). Only fall back to `specifications/01-lakeflow.md` / `src/pipeline/*` if a needed value is in `ADAPTATION_FACTS.unresolved[]`, and record the fallback in `HANDOFF_NOTES.md` at Step 9.
3. Write resolved files into `<project>/.assistant/skills/<demo-slug>-adaptation/`.

**Do NOT emit `install.sh`** (v0 artifact) **or a `setup` bundle target** (v1 artifact). The 3-line `databricks workspace import-dir` CLI snippet in Step 8's README is the install mechanism in v1.1.

### Step 7 — Render `ADAPTATION_GUIDE.md`

Copy `templates/ADAPTATION_GUIDE.md.template` to `<project>/ADAPTATION_GUIDE.md` and resolve placeholders against the project:

- `{{demo-name}}` → from Step 1 / README title.
- `{{one-paragraph summary from project README}}` → the pitch/overview from README.
- `{{job-name}}` → from Step 1.
- `{{data-contract-path}}` → best of: `src/pipeline/bronze.sql`, `src/pipeline/bronze.py`, or the spec table in `specifications/01-lakeflow.md`. Pick the one that names the columns the client must match.
- `{{project-map-path}}` → if a `PROJECT_MAP.md` exists at project root, point at it; otherwise omit the line.

**This step must run before Step 8** — the README's "First Run (Client)" section links to ADAPTATION_GUIDE.

### Step 8 — Add a "First Run (Client)" section to `README.md`

Prepend (or insert directly under the title) a section the client sees first. Use the resolved `{{job-name}}` from Step 1:

```markdown
## First Run (Client)

This project ships with synthetic data so you can experience the demo immediately on your own workspace. All commands run inside a Databricks **web terminal** opened in this folder — no laptop CLI setup required.

1. **Open a web terminal in this folder**: in the Databricks UI, navigate to this git folder, then Compute panel → terminal icon (or ⌘+Shift+T). The web terminal is auto-authenticated as you.

2. **Install the Genie Code adaptation skill** (one-time, ~10 seconds — paste these three lines verbatim, no edits):
   ```bash
   USER_EMAIL=$(databricks current-user me | python3 -c 'import sys,json;print(json.load(sys.stdin)["userName"])')
   databricks workspace mkdirs "/Workspace/Users/$USER_EMAIL/.assistant/skills"
   databricks workspace import-dir .assistant/skills "/Workspace/Users/$USER_EMAIL/.assistant/skills" --overwrite
   ```
   This copies the adaptation skill from this repo to `/Workspace/Users/<your-username>/.assistant/skills/<demo-slug>-adaptation/`. Genie Code auto-loads skills from that path in any new chat.

3. **Configure for your workspace.** Two paths:

   **(a) Guided — recommended**: Open Genie Code in this workspace (top nav → Genie Code → **New chat** — the skill only auto-loads in fresh chats, not in chats opened before step 2). Type exactly: `run in my workspace`. The adaptation skill walks you through detecting your catalog/schema/warehouse, asks whether to start with synthetic or real data, edits `databricks.yml` for you, and outputs the deploy commands to run.

   **(b) Manual**: Edit `targets.client.variables` in `databricks.yml`: set `client_catalog`, `client_schema`, `warehouse_id` to values that exist in your workspace; keep `run_with_synthetic_data: "yes"` for the first run.

4. **Deploy and run** — paste these into the same web terminal:
   ```bash
   databricks bundle validate --target client
   databricks bundle deploy   --target client
   databricks bundle run <job-name> --target client
   ```
   Defaults to `run_with_synthetic_data=yes` — no real data required for the first pass.

5. **Adapt to your data later.** When you're ready to swap synthetic data for real tables, set `run_with_synthetic_data: "no"` and point `client_catalog` / `client_schema` at your tables. See `ADAPTATION_GUIDE.md` — or ask Genie Code, since the skill is loaded.

**Updates from the SA**: when the SA pushes a new version of this repo, run `git pull` in this folder, then re-run step 2 to refresh the helper skill.
```

Leave the rest of `README.md` (story, walkthrough) intact — those are the demo's value, not environment fingerprint.

### Step 9 — (Optional) Author `HANDOFF_NOTES.md` for the SA

This file is **SA-facing**, not client-facing — it documents anything the automated handoff couldn't fully resolve. Include if any of the following happened during Steps 1–8:

- Strip pass had zero hits in some file (record it so the SA sees the pass ran).
- A `TODO(client-handoff)` was left in non-critical-path code (Step 5 didn't fail on it, but the SA should know).
- `{{table-names}}` was resolved from a non-canonical source (Step 6.2 fallback path used).
- `include:` was dropped because no resources files existed (Step 1.4).
- Manual follow-up was accepted at Step 5 (variant of the hard gate where the SA acknowledged a known-broken case).

Skip the file entirely if there's nothing to report.

### Step 10 — Final diff summary (printed to the SA)

Print a comprehensive summary covering Step 2 (strip) AND every file changed/added across Steps 3–9:

```
Stage 5 complete. Summary:

IP-strip:
  - Stripped 7 FE-workspace URLs in 3 files
  - Stripped 4 @databricks.com emails in 2 files
  - Blanked 12 resource IDs in resources.json
  - Deleted 1 databricks.prod.yml, 1 .env

Bundle restructure:
  - Reshaped databricks.yml to targets-pattern (variables: + targets.client:)
  - Migrated 14 ${var.catalog} refs → ${var.client_catalog} across 6 files
  - Migrated 14 ${var.schema} refs → ${var.client_schema} across 6 files
  - Wired synth-data toggle (Pattern A in resources/jobs.yml)

Pre-submit auto-fixes (Step 5.0):
  - <list of Stage-4 codegen defects patched, e.g.:>
  - src/data_generation/generate_data.py: dbutils.widgets.addText → dbutils.widgets.text
  - resources/job.yml: added data_security_mode: SINGLE_USER to job_clusters.new_cluster
  - (or "no auto-fixes needed" if presubmit found nothing)

Client-facing assets:
  - Rewrote dab_instructions.md (client-oriented)
  - Wrote .assistant/skills/<slug>-adaptation/SKILL.md
  - Wrote ADAPTATION_GUIDE.md
  - Updated README.md with "First Run (Client)" section (3-line CLI snippet for skill install)

Validation:
  - databricks bundle validate -t client: PASS (0 errors)
  - Grep clean: no FE URLs / SA emails / SA paths / orphaned ${var.catalog} refs
  - All include: patterns match existing files

Handoff notes:
  - <list any HANDOFF_NOTES.md entries; "(none)" if not written>
```

The SA can revert via git if anything important was caught. The summary is the SA's checkpoint before publishing the ZIP.

### Step 11 — Produce the handoff ZIP

The single shipping artifact. Package the entire project directory as `<demo-slug>-client-handoff.zip` **inside the project root** (next to `databricks.yml`).

```bash
# Run from inside the project folder
cd <project>
zip -r ./<demo-slug>-client-handoff.zip . \
  -x "./<demo-slug>-client-handoff.zip" \
  -x "*.pyc" "__pycache__/*" ".venv/*" "*.log" ".DS_Store" \
  -x ".claude/*" ".databricks/*" \
  -x "META-PROMPT.md" \
  -x "client_handoff/*" \
  -x ".anthropic_token" "get_anthropic_token.sh" ".claude/settings.json"
```

**Include in the ZIP:**
- `databricks.yml` (single `client` target), `resources/`, `src/`, `dashboard/`, `raw_data/`, `README.md`
- `ADAPTATION_GUIDE.md` (at project root — flat layout, no `client_handoff/` subfolder)
- `dab_instructions.md`
- `.assistant/skills/<demo-slug>-adaptation/**` — in-repo skill; the README Step 8 CLI snippet copies these to the canonical workspace path
- (If present) `HANDOFF_NOTES.md` — SA notes; harmless if the client sees it but it's primarily for the SA.

**Exclude from the ZIP:**
- `<demo-slug>-client-handoff.zip` (don't pack the zip into itself)
- `databricks.prod.yml` (deleted in Step 2)
- Build artifacts: `.venv/`, `__pycache__/`, `*.pyc`, `*.log`, `.DS_Store`
- `.claude/` (SA's Claude Code config — distinct from `.assistant/skills/`)
- `.databricks/` (CLI-local bundle cache written by `bundle validate`; ships → client's first `bundle deploy` fails on sync-state mismatch)
- `META-PROMPT.md` (Step 2 already deletes it — belt-and-braces)
- `client_handoff/` (legacy staging dir — canonical layout is flat at project root)
- FMAPI auth artifacts: `.anthropic_token`, `get_anthropic_token.sh`, `.claude/settings.json` (appear in Solution-Builder-forked projects; SA-only secrets)
- Any local credentials / `.env` files

Present the ZIP path to the SA as the shipping artifact:
> "Handoff package ready: `<demo-slug>-client-handoff.zip`. Publish to a public GitHub repo (or hand directly to the client). The client imports it as a Databricks git folder; first-run uses synthetic data so no config is required, then Genie Code auto-loads the adaptation skill and walks them through pointing at their own data."

## Validation (checklist for the SA before shipping)

After Stage 5 completes, the SA should verify:

- [ ] `databricks bundle validate -t client` exits 0.
- [ ] `ADAPTATION_GUIDE.md` exists.
- [ ] `dab_instructions.md` references the client target only (no SA dev/prod).
- [ ] `install.sh` does NOT exist (v0 artifact).
- [ ] `targets.setup` does NOT exist in `databricks.yml`, `resources/setup.yml` does NOT exist, `src/setup/install_skill.py` does NOT exist (v1 artifacts; v1.1 ships without them).
- [ ] README "First Run" Step 2 has the 3-line `databricks workspace import-dir` snippet (NOT `bundle deploy --target setup`).
- [ ] `<demo-slug>-client-handoff.zip` exists at the project root.
- [ ] ZIP contains: `ADAPTATION_GUIDE.md` + `.assistant/skills/<demo-slug>-adaptation/SKILL.md` + `databricks.yml` (client target only) + `dab_instructions.md`.
- [ ] No orphaned `${var.catalog}` / `${var.schema}` refs anywhere in the project (`grep -rE '\$\{var\.(catalog|schema)\}\b' .` returns empty).
- [ ] No remaining FE workspace URLs (`e2-demo-field-eng`, `fevm-`) in any shipped file.
- [ ] No remaining `@databricks.com` email refs.
- [ ] `.assistant/skills/<demo-slug>-adaptation/SKILL.md` parses (YAML frontmatter valid; no `{{...}}` placeholders left).
- [ ] Diff summary (Step 10) was printed and captures every change.

## Common pitfalls

Empirically-discovered failure modes from prior runs. Most algorithmic pitfalls are caught by the Step 5 gate; the entries below are the ones whose existence isn't obvious from the algorithm alone:

| Pitfall | Mitigation |
|---|---|
| **Demo never reached Stage 3+4** — no `databricks.yml`, empty `created_resources` | Step 1 prereq detects + offers to run earlier stages. Do NOT hand-craft a bundle from specs. |
| **Persona/story content mistakenly stripped** ("Maya Patel", "Harvestly Co." wiped from README) | IP-strip scope is environment fingerprint only. If a regex matches story content, narrow the regex. |
| **`databricks.prod.yml.example` keeps real values** | Blank all value fields in `*.yml.example` files (keep keys for shape). |
| **ZIP packed into itself** (size grows each re-run) | Step 11 excludes `./<demo-slug>-client-handoff.zip` from the `zip -r`. |
| **`.databricks/` CLI cache shipped** (caught 2026-05-29 V1 Phase E) — sync-state mismatch on client's first deploy | Step 11 excludes `.databricks/*`. Don't re-run `bundle validate` after Step 11 packs the ZIP. |
| **`META-PROMPT.md` shipped** (caught 2026-05-29 V1 Phase E) — confusing SA-bootstrap doc lands in client's hands | Step 2 deletes it; Step 11 excludes it. |
| **Duplicate PDFs in `raw_data/pdf/`** (caught 2026-05-29 V1 Phase E) — KA double-indexes, MAS citations duplicate | Step 2 SHA-hashes + dedupes; keep numeric-prefixed canonical names. |
| **`ADAPTATION_GUIDE.md` lands in nested `client_handoff/`** (caught 2026-05-29 V1 Phase E) | Step 7 writes to project root flat; Step 11 excludes `client_handoff/*`. |
| **`mode: development` prepends `dev_<user>_` to every DAB resource** (caught 2026-05-29 V1 Phase E8) — schema-vs-pipeline-target divergence | Step 3.1: omit `mode:` or set `mode: production`. Step 5 grep gate flags `mode: development` as critical-path fail. |
| **Demo-generator deploy scripts (`deploy_ka.py`, `deploy_genie.py`) use stale SDK API** (caught 2026-05-29 V1 Phase E8) — `'generator' object has no attribute` or `create_*(display_name=...)` kwargs reject. AI layer fails to deploy. | NOT a handoff-skill bug — upstream Stage-3 template regression. Step 5 WARNING flags it pre-ship; upstream fix is a PR to `industry-demo-prompts` to refresh deploy-script blocks against current databricks-sdk. |

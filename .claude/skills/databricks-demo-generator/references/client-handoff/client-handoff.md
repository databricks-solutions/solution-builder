# Client Handoff — authoring guide

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
| 1 | Modified `databricks.yml` with synth-data toggle + targets-pattern + migrated variable refs | Step 3 |
| 2 | Stripped environment fingerprint across all non-bundle files + `resources.json` | Step 2 |
| 3 | Updated `dab_instructions.md` — client-oriented deploy commands | Step 4 |
| 4 | Auto-patched Stage-4 codegen defects (widgets API, cluster security mode) | Step 5.0 — see `presubmit.md` |
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
6. **Resolve `{{job-name}}`.** Read `databricks.yml` (and any `resources/*.yml` referenced by `include:`) and pick the primary job's key. Record it — Steps 4, 7, and 8 need it for the deploy commands and Step 6 needs it for the Genie Code skill template.
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
| `META-PROMPT.md` (SA-scaffolding artifact from the demo-generator template) | Delete entirely. This file's only purpose is to bootstrap a new demo-generator session — it has no client value and contains SA-internal instructions. |
| `raw_data/pdf/` duplicates (two PDFs with same content but different filenames, e.g., `01_brand_voice_guide.pdf` AND `brand_voice_guide.pdf`) | Detect by content hash (`shasum -a 256`) within `raw_data/pdf/`. When two files have identical SHA, keep the one whose name matches the numeric-prefixed canonical convention (`<NN>_<topic>.pdf`) and delete the unprefixed variant. If both copies are non-identical with similar names, keep the larger / newer one and record the deletion in `HANDOFF_NOTES.md`. **Why it matters:** the Knowledge Assistant indexes everything under `raw_data/pdf/` — duplicates produce duplicate citations in MAS responses, undermining the demo. |
| `raw_data/html/` duplicates (same dup pattern as PDFs — Solution Builder regenerates HTMLs mid-build and ships both old + numeric-prefixed copies) | Apply the same SHA-hash de-dup pass to `raw_data/html/`. Keep numeric-prefixed canonical names, delete the unprefixed variants, record in `HANDOFF_NOTES.md`. **Why it matters:** even though KA usually indexes PDFs (not HTML), the duplicate HTML files clutter the package + confuse the client about what's authoritative. They also doubled the shipped ZIP size by ~5% in the V2 build. |

After stripping, **record** the strip counts (e.g., "7 FE-workspace URLs in 3 files, 4 emails in 2 files, ...") — Step 10 prints the final summary. **Do not print a summary here**; Step 2's job is to strip, not to talk.

### Step 3 — Restructure `databricks.yml` + migrate variable refs + wire the synth toggle

Read `templates/databricks.yml.patch.md` for the canonical recipe. This step does FOUR things — all of them, in this order:

#### 3.1 — Reshape `databricks.yml` to the client-targets pattern

- Top-level `bundle.name: <demo-slug>` and `include: - resources/*.yml`.
- Top-level `variables:` block declares `run_with_synthetic_data` (default `"yes"`), `client_catalog`, `client_schema`, `warehouse_id`, plus any demo-specific vars (model endpoints, Genie/KA IDs, etc.). Defaults are placeholders like `"<your_catalog>"`.
- `targets.client:` with `default: true`, `mode: production` (or omit `mode:` entirely — defaults to production), `workspace.host: https://<your-workspace>.cloud.databricks.com`, and a `variables:` override block repeating the placeholders. **CRITICAL: do NOT use `mode: development`** — that mode prepends `dev_<username>_` to every DAB resource name (schemas, volumes, jobs, pipelines, dashboards). For a client deploy, the client expects the schema they named (e.g., `accelerator_loyalty_v1`) to literally be that name — not `dev_jane_doe_accelerator_loyalty_v1`. The dev-mode prefix also creates a confusing schema-vs-pipeline-target divergence: the schema resource gets prefixed but `${var.client_schema}` substitution does NOT, so the pipeline writes to one schema while the DAB-managed schema resource exists at a different name. **Set `mode: production`.** Discovered 2026-05-29 V1 Phase E8.
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

#### 3.3 — Wire the synth-data toggle into the actual job/pipeline (not just the root YAML)

Two patterns — pick whichever fits the demo's existing structure:

- **Pattern A — DAB `condition_task`** (preferred): gate the synth-gen task with `${var.run_with_synthetic_data} == "yes"`.
- **Pattern B — notebook early-return**: inject `if os.environ.get("RUN_WITH_SYNTHETIC_DATA", "yes") == "no": dbutils.notebook.exit("Skipped — using client data")` at the top, and pass via `base_parameters`.

For SDP/pipeline bronze: SDP SQL **cannot** interpolate Spark conf vars in `read_files()`. **Python bronze is required.** If the demo's existing bronze is SQL, either:
- Convert to Python bronze per `databricks.yml.patch.md` Section 3, **then DELETE the original `*_bronze.sql` file** (don't leave it as an SA TODO — the .sql will confuse the client and the pipeline definition no longer references it). Update `databricks.yml`'s `pipeline.libraries[]` to point at the .py only. Record the deletion in `HANDOFF_NOTES.md`.
- OR leave a `# TODO(client-handoff)` comment AND fail Step 5 validation with: `"SDP SQL bronze cannot interpolate ${var.client_catalog} — must convert to Python bronze."` Do not silently continue.

#### 3.4 — App demos: preserve Stage 4 artifacts

If the demo includes an Apps deploy (per Stage 4's `artifacts.default.build` + `sync.include` for `app/dist/**`), preserve those blocks. They handle the app build + sync correctly already; no rewriting needed. App-specific deploy steps (Lakebase scripts, etc.) belong in Step 4's `dab_instructions.md`, NOT as new bundle resources.

#### 3.5 — Leave TODO markers where automation can't be perfect

Format: `# TODO(client-handoff): verify <X> still works for client_catalog/schema`. Step 5 validation flags critical-path TODOs (pipeline source, synth gate) as hard fails; non-critical-path TODOs (cosmetic thresholds, optional features) are reported as warnings.

#### 3.6 — (removed in v1.1)

v1 tried to install the Genie Code skill via a second bundle target (`setup`) that the client would `databricks bundle deploy` first. **Removed in v1.1** because DAB v1.1.0 does not support `${resources.jobs.<key>}` self-reference in target overrides — the `setup` target inherited ALL bundle resources, and `bundle deploy --target setup` failed at `terraform apply` on placeholder catalog/warehouse values (real failure observed on FEVM 2026-06-02).

v1.1 installs the skill via a 3-line CLI snippet pasted into the Databricks web terminal (no DABs, no Python notebook task, no chicken-and-egg). The snippet is in Step 8's README template. Stage 5 does NOT emit a `setup` target, a `resources/setup.yml`, or a `src/setup/install_skill.py` — those files are gone in v1.1. If you find yourself writing any of those, you're on the v1 path — back out.

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

**STOP. Before you proceed to Step 6, invoke `presubmit.md` (sibling file in this directory) against `HANDOFF_DIR = <project root>`. Do not write the Genie Code skill, the README "First Run" section, the ZIP, or anything in Steps 6–11 until presubmit reports `OVERALL: PASS`.** Paste presubmit's full output into your Step 10 diff summary as evidence — if it's missing there, Step 10's checklist will fail.

The presubmit will:

1. Auto-patch `dbutils.widgets.addText` → `dbutils.widgets.text` in any `.py` file (Stage 4 codegen defect).
2. Auto-patch missing `data_security_mode: SINGLE_USER` into every `job_clusters.new_cluster:` block in `resources/*.yml` (Stage 4 codegen defect — UC catalogs require single-user or user-isolation security mode).
3. Run detect-only checks: IP-strip leaks, `META-PROMPT.md` and `install.sh` exclusions (v1 artifacts that must NOT ship in v1.1 packages), bronze-layer shape, Genie Code skill placeholders, `databricks.yml` shape.

If any detect-only check FAILs, fix it (or surface to the SA), then re-run 5.0 until clean. Then proceed to 5.1.

Log every auto-fix applied — Step 10's diff summary needs them.

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
  - **Any workspace-specific FEVM catalog/schema literal** (e.g., `morgan_stable_classic_6df0yw_catalog`, `accelerator_loyalty_v1`) — these can leak into the bundled Genie Code skill's auto-detect examples if the template uses them as "e.g.," values. **Generic placeholders only** in the shipped skill: use phrases like "a user-owned catalog" or "<their-catalog>" — NEVER paste a real workspace's catalog/schema name. (Discovered 2026-05-29 V3 — `templates/genie-code-skill/SKILL.md` had `morgan_stable_classic_6df0yw_catalog` baked in as an example.)
- **`include:` patterns match real files.** Grep `include:` lines in `databricks.yml`, glob the patterns, confirm every glob has ≥1 match.
- **No orphaned `${var.catalog}` / `${var.schema}` refs.** `grep -rE '\$\{var\.(catalog|schema)\}'` across project root must return zero matches (only `${var.client_catalog}` / `${var.client_schema}` should remain).
- **No critical-path `TODO(client-handoff)` in pipeline source, synth gate, or `databricks.yml`** — unless the SA has explicitly accepted manual follow-up (record acceptance in `HANDOFF_NOTES.md` at Step 9; carry it forward for Step 10's summary).
- **Deploy scripts use the current databricks-sdk API shape.** Grep `src/deploy/*.py` for these stale-SDK patterns and flag any hit as a Step 5 WARNING (not a hard fail — the SA may accept and ship as-is):
  - `page_token =` and `next_page_token` (paginated-response loops) — current SDK returns Python generators directly. Pattern: `for x in w.<api>.list_*(page_size=N):` is correct.
  - `resp.<plural_field> or []` — same regression. Use `for x in w.<api>.list_*():` directly.
  - `create_<thing>(display_name=..., description=...)` — current SDK takes a model object: `create_<thing>(<thing>=Class(display_name=..., description=...))`. The model-class import paths are like `databricks.sdk.service.knowledgeassistants.KnowledgeAssistant`.
  - Surface in HANDOFF_NOTES.md so the SA knows what to fix or warn the client about. Discovered 2026-05-29 V1 Phase E8: `deploy_ka.py` and `deploy_genie.py` shipped by the demo-generator both hit this regression and broke the in-FEVM `harvestly_setup` job until manually patched.

On failure: emit a structured report:

```
Step 5 — Validation FAILED.
  - databricks bundle validate exited 1 with error: <error text>
  - resources/jobs.yml line 42: orphaned ${var.catalog} — rename to ${var.client_catalog}
  - <other failures...>
Aborting before Step 6. Manual fixes required.
```

Do not write skill, ADAPTATION_GUIDE, README client section, HANDOFF_NOTES, diff summary, or ZIP. The point of the gate is to never ship a broken bundle.

### Step 6 — Drop the Genie Code skill bundle (in-repo carrier; CLI snippet in README copies to canonical path)

Now that the bundle structure is final and validated, generate the skill files. **The skill ships in-repo at `<project>/.assistant/skills/<slug>-adaptation/` as the source for the 3-line CLI snippet in README Step 8 to copy at first-run time.** Genie Code does NOT auto-discover from this in-repo path — it only auto-loads from `/Workspace/.assistant/skills/<name>/` or `/Workspace/Users/<user>/.assistant/skills/<name>/` (per Databricks docs). The CLI snippet moves the bytes to the latter path.

1. Read the templated skill from `templates/genie-code-skill/SKILL.md`.
2. Resolve placeholders:
   - `{{demo-slug}}` → from Step 1.
   - `{{demo-name}}` → from `README.md` title (e.g., "Harvestly Co. — Loyalty Segmentation").
   - `{{demo-persona}}` → the protagonist named in README (e.g., `Harvestly Co.`).
   - `{{job-name}}` → from Step 1.
   - `{{table-names}}` → from `specifications/01-lakeflow.md` (the spec table that lists gold/silver/bronze tables), OR from `src/pipeline/bronze.sql` / `.py` if specs are absent. **Do NOT read from `resources.json.created_resources`** — Step 2 gutted that. Record which source you used in `HANDOFF_NOTES.md` at Step 9.
3. Write resolved files into `<project>/.assistant/skills/<demo-slug>-adaptation/`.

**Do NOT emit `install.sh`.** v0 shipped a shell script as the install mechanism; v1.1 replaces it with the 3-line `databricks workspace import-dir` CLI snippet shown in the README "First Run" section (Step 8). The client runs that snippet once to copy the in-repo skill into the canonical workspace path `/Workspace/Users/<user>/.assistant/skills/<slug>-adaptation/`, where Genie Code auto-loads it. (v1's `setup` bundle target was tried and failed — DAB v1.1.0 doesn't support `${resources.jobs.<key>}` self-references, so `bundle deploy --target setup` died at terraform apply. Removed in v1.1; do not reintroduce.) If you find yourself writing `install.sh`, you're on the v0 path — back out and apply Step 8 instead.

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
- `.claude/` (Claude Code config dir — separate from `.assistant/skills/`; the SA's `.claude/` shouldn't ship)
- **`.databricks/`** (CLI-local bundle cache: `sync-snapshots/`, `.internal/`, etc. — written by `databricks bundle validate` during Step 5. Never ship — will interfere with the client's first `bundle deploy`.)
- **`META-PROMPT.md`** (SA-scaffolding from the demo-generator template — Step 2 already deletes it; this is the belt-and-braces in case it survived.)
- **`client_handoff/`** (legacy staging dir name — if anything lands there during a flow, the ZIP excludes it; canonical layout writes ADAPTATION_GUIDE.md and everything else flat at project root.)
- **FMAPI auth artifacts** (`.anthropic_token`, `get_anthropic_token.sh`, `.claude/settings.json`) — these may appear in projects forked from the Solution Builder app. They're SA-only secrets/dev-mode shims and must never ship to the client.
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

Surfaced during prior runs of this guide:

| Pitfall | Symptom | Mitigation |
|---|---|---|
| **Demo never reached Stage 3+4** (still a prompt template) | No `databricks.yml`, no `resources/` files, `resources.json.created_resources` is `{}` | Step 1 detects this and offers to run Stages 3+4 first. Do **NOT** hand-craft a `databricks.yml` from specs alone — Stage 4 owns that. |
| **Orphaned `${var.catalog}` refs after rewrite** | `bundle deploy` errors with "variable catalog not defined" on the client side | Step 3.2 migration MUST scan the entire tree (databricks.yml + resources/*.yml + src/**). Step 5 grep gate catches missed refs before shipping. |
| **IP-strip pass turns up zero matches** | No grep hits for `e2-demo-field-eng`/`fevm-`, `@databricks.com`, `/Workspace/Users/<sa>/` | Expected when the demo was authored cleanly. Record "zero counts" in Step 2 and Step 9 (`HANDOFF_NOTES.md`) so the SA sees the pass ran. |
| **`include: - resources/*.yml` references files that don't exist** | `bundle validate` errors with "no resources matched include pattern" | Step 1.4 catches this prereq; Step 3 drops `include:` if no files exist. Don't ship the line if it doesn't resolve. |
| **Pipeline source is SDP SQL, not Python bronze** | `${var.client_catalog}` interpolation silently fails inside SDP SQL `read_files()` | Step 3.3 + `databricks.yml.patch.md` Section 3: bronze MUST be Python. If existing bronze is SQL, convert OR fail Step 5 — never silently continue. |
| **Workspace-specific resource IDs leak via `resources.json`** | After IP-strip, `created_resources.warehouse_id` still shows the SA's UUID | Step 2 replaces EVERY value under `created_resources.*`. Nested keys included. |
| **`databricks.prod.yml.example` keeps real values** | Client sees `host: https://e2-demo-field-eng...` in the example file | Blank ALL value fields in `*.yml.example` files (keep keys for shape). "Example" is not a license to leak fingerprint. |
| **Genie Code skill has `{{...}}` placeholders left in** | Skill auto-loads but its `description:` field has `{{demo-name}}` literally in it, so it doesn't match the client's query | Step 6.2 placeholder resolution is mandatory. Step 5 doesn't currently grep the skill file (it's not yet written); Validation checklist at the bottom DOES check, but Step 6 should also self-verify by grepping for `\{\{[a-z-]+\}\}` after write. |
| **`{{table-names}}` resolved from `created_resources` (which was gutted in Step 2)** | Skill ships with `{{table-names}}` blank or generic placeholders | Step 6.2 resolves from `specifications/01-lakeflow.md` or `src/pipeline/bronze.*`, NOT `resources.json`. Record the source in `HANDOFF_NOTES.md`. |
| **Persona/story content mistakenly stripped** | "Maya Patel", "Harvestly Co.", "Customer Marketing Playbook" — wiped from README | Re-read the IP-strip rule scope: environment fingerprint only. Personas and narrative are the demo's value. If your strip regex matches story content, narrow the regex. |
| **ZIP packed into itself** | ZIP file size grows on each re-run, contains stale `*.zip` inside | Step 11 explicitly excludes `./<demo-slug>-client-handoff.zip` from the `zip -r` invocation. |
| **`.claude/` shipped in the ZIP** | Client receives the SA's IDE settings, MCP configs, etc. | Step 11 excludes `.claude/`. The Genie Code skill lives under `.assistant/skills/` (different path, intentionally — `.claude/` is Claude Code config, not Genie Code). |
| **`.databricks/` CLI cache shipped** (NEW — caught in 2026-05-29 V1 Phase E run) | The Step 5 `databricks bundle validate` invocation creates `.databricks/bundle/<target>/sync-snapshots/` and `.databricks/bundle/<target>/.internal/` directories. They're CLI-local state. If they ship in the ZIP, the client's first `bundle deploy` may fail with sync-state mismatches. | Step 11 excludes `.databricks/*`. Equally important: do NOT run `bundle validate` inside `client_handoff/` or `<staging>` after Step 11 has packed the ZIP — that re-creates the cache. Validate runs in Step 5 only. |
| **`META-PROMPT.md` shipped** (NEW — caught in 2026-05-29 V1 Phase E run) | Client downloads ZIP, unzips, sees a file titled "Meta Prompt for Demo Implementation" describing how an SA bootstraps a new project — confusing. | Step 2 deletes `META-PROMPT.md` outright (it's SA-only). Step 11 excludes it as belt-and-braces. |
| **Duplicate PDFs in `raw_data/pdf/` cause double KA indexing** (NEW — caught in 2026-05-29 V1 Phase E run) | KA returns the same source twice in MAS citations because two PDFs with different filenames (e.g., `01_brand_voice_guide.pdf` AND `brand_voice_guide.pdf`) have identical content. Undermines the demo's credibility. | Step 2 SHA-hashes everything under `raw_data/pdf/` and deduplicates. Prefer the numeric-prefixed canonical filename. Record removals in `HANDOFF_NOTES.md`. |
| **`ADAPTATION_GUIDE.md` lands in a nested `client_handoff/` subfolder** (NEW — caught in 2026-05-29 V1 Phase E run) | Client unzips and finds a stray `client_handoff/` folder containing one file. Confusing — they wonder what else should be there. | Step 7 writes ADAPTATION_GUIDE.md directly to project root (flat layout). Step 11 excludes `client_handoff/*` as belt-and-braces in case any legacy code path writes there. |
| **`mode: development` prepends `dev_<username>_` to every DAB resource** (V2.1 — caught in 2026-05-29 V1 Phase E8 deploy) | Client says "deploy this in `accelerator_loyalty_v1`" → bundle deploys schema/volume/pipeline/job/dashboard at `dev_<their_user>_accelerator_loyalty_v1` instead. Worse, the pipeline's `target: ${var.client_schema}` substitutes to the un-prefixed name, so data lands in one schema and the DAB-managed schema resource sits empty at a different name. Client confused about which schema is "real". | Step 3.1: `targets.client.mode: production` (or omit `mode:`). DAB defaults to production behavior — no prefixing. Step 5 grep gate: `grep "mode: development" databricks.yml` → flag as critical-path fail if found in a client target. |
| **Demo-generator deploy scripts (`deploy_ka.py`, `deploy_genie.py`) use stale databricks-sdk API patterns** (V2.1 — caught in 2026-05-29 V1 Phase E8 job run) | After a successful `bundle deploy`, the `harvestly_setup` job's `deploy_ka` task fails with `'generator' object has no attribute 'knowledge_assistants'` (old paginated-response pattern), or `create_knowledge_assistant() got an unexpected keyword argument 'display_name'` (new SDK wants a model object, not kwargs). The data layer deploys fine, but the AI layer (KA + Genie Space + MAS) never comes up. | NOT a handoff-skill bug — it's a regression in the demo-generator's Stage 3 templates (the deploy script blocks in `industry-demo-prompts/.claude/skills/databricks-demo-generator/references/blocks/capabilities/*.md`). Mitigation in the handoff skill: Step 5 WARNING (above) flags the scripts before shipping. Upstream fix: PR against industry-demo-prompts to refresh deploy-script templates against current databricks-sdk. The skill can also note this in the Genie Code skill's Step 4 fallback guidance so a client hitting the issue knows where to look. |

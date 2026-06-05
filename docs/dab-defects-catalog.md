# DAB defect catalog

Defects in Stage 3/4 codegen and the reference DAB patterns that prevent a generated bundle from redeploying cleanly on an arbitrary Databricks workspace.

**Premise.** A demo's Stage 4 output should redeploy on any UC-enabled workspace out of the box. Today it doesn't. The Stage 5 client-handoff stage (proposed in [#65](https://github.com/databricks-field-eng/industry-demo-prompts/pull/65)) papers over the gap with IP-strip + variable migration + presubmit auto-fixes; the right long-term fix is to remove these defects upstream so Stage 5 collapses to "package + ship customization skill" with no transformations needed.

**Scope.** Empirically caught across V3 Phase E (Harvestly Loyalty), v1.1 (Pacific Grid Utilities), and v2 (Precision Motors) test cycles. Not exhaustive — this is the set with concrete evidence.

**Status.** Group 1 (SDK regressions) closed by [#64](https://github.com/databricks-field-eng/industry-demo-prompts/pull/64) (merged 2026-06-04) + `49e7e50` (deps bump) + `819cf46` (condense). Groups 2-6 open.

## Severity legend

- **P0** — blocks deploy. `bundle validate` or `bundle deploy` fails. Loud and immediate.
- **P1** — silent corruption. Deploy succeeds; runtime behavior is wrong; client may not notice for hours/days.
- **P2** — UX friction or non-portable assumption. Deploy works on SA workspace, fails on client workspace.
- **P3** — quality / hygiene. Works everywhere but ships SA-specific noise (PII, dead artifacts, etc.).

## Catalog

### Group 1 — SDK call shape regressions

The demo-generator agent regresses to outdated SDK call shapes when templating `references/dab/scripts/*.py` from memory. Manifests at deploy-time, not codegen-time.

| # | Defect | Where | Severity | Fix shape | Status |
|---|---|---|---|---|---|
| 1.1 | `w.knowledge_assistants.create_knowledge_assistant(display_name=..., description=...)` — older kwarg pattern | Generated `src/deploy/deploy_ka.py` | P0 (TypeError at runtime) | Doc guardrail + model-object pattern | ✅ **MERGED in PR #64** (`c91544c` 2026-06-04) |
| 1.2 | `w.knowledge_assistants.create_knowledge_source(parent=..., source_type="files", files={...})` — older inline kwargs | Generated `src/deploy/deploy_ka.py` | **P1 silent corruption** — create succeeds, indexing never finds files | Doc guardrail + `KnowledgeSource(source_type="FILES", files_spec=FilesSpec(...))` | ✅ **MERGED in PR #64** |
| 1.3 | `while resp.next_page_token: for x in resp.spaces: ...` — older paginated list pattern | Generated `src/deploy/deploy_genie.py`, `deploy_ka.py` | P0 (AttributeError on `.spaces` / `.knowledge_assistants`) | Iterate generator directly: `for x in w.genie.list_spaces(page_size=200):` | ✅ **MERGED in PR #64** |

Root cause: the demo-generator agent's training is older than the current `databricks-sdk` (≥ 0.114 as of 2026-06-04). The dab.md guardrail (originally shipped in PR #64) is the load-bearing fix because it counters the regression tendency at the documentation layer; the code fixes just make the reference scripts match what dab.md now says.

**Follow-ups after merge** (Quentin Ambard, `databricks-field-eng`):
- `49e7e50` (2026-06-04) — bumped `databricks-sdk` floor `>=0.74 → >=0.114` in `pyproject.toml` + `uv.lock` so the lockfile and the dab.md guardrail agree on API surface.
- `819cf46` (2026-06-05) — **condensed** the 55-line "CRITICAL — copy verbatim" prose in dab.md down to 1 sentence pointing at the reference scripts. Editorial rationale (from his commit message): *"the scripts themselves are the contract; duplicating their shape as prose was noise."* Bumped all `0.102.0` references to `0.114.0` across dab.md + deploy scripts.

This independently confirms our `skill-text-cannot-constrain-genie-code` learning at the team level: **trust structural artifacts, don't pile prose on top of them**. Important editorial signal for how the rest of the catalog (and PR #65) should be written.

### Group 2 — DAB codegen defects (Stage 4 generates these wrong)

Bugs in how Stage 4 produces the bundle structure itself. Manifests at `bundle validate` or `bundle run`.

| # | Defect | Where | Severity | Fix shape | Status |
|---|---|---|---|---|---|
| 2.1 | `dbutils.widgets.addText(...)` instead of `dbutils.widgets.text(...)` | Generated notebook tasks (data generator, deploy scripts) | P0 (`AttributeError: 'WidgetsHandlerImpl' object has no attribute 'addText'`) | Stage 4 codegen should emit `text(...)`; meanwhile presubmit auto-fixes | ⚠️ Auto-fixed by Stage 5 presubmit; root fix is in Stage 4 codegen — not yet shipped upstream |
| 2.2 | Missing `data_security_mode: SINGLE_USER` on `job_clusters.new_cluster` for UC-enabled jobs | `resources/jobs.yml` | P0 (`REQUIRES_SINGLE_PART_NAMESPACE: spark_catalog requires a single-part namespace, but got X.Y`) | Stage 4 should add the field when generating jobs that touch UC tables (which is all of them) | ⚠️ Auto-fixed by Stage 5 presubmit; root fix in Stage 4 — not yet upstream |
| 2.3 | `outcome: success` on a notebook task dependency (only valid on `condition_task` / if-else nodes) | Generated `resources/jobs.yml` job graph | P0 (`bundle deploy` fails terraform-apply with cryptic dependency error) | Stage 4 should NOT emit `outcome:` on non-conditional task deps | ⚠️ Caught & patched on V3 Phase E manually; root fix in Stage 4 — not yet upstream |
| 2.4 | Generated dashboards reference `dataset_catalog` / `dataset_schema` parameters but Stage 4 doesn't always wire them from DAB variables | Generated `.lvdash.json` files | P2 (deploy succeeds, dashboard renders empty data because the parameters don't resolve) | Stage 4 should consistently wire dashboard-level params from `${var.client_catalog}` / `${var.client_schema}` | ❓ Sometimes works, sometimes doesn't — needs reproducer |

### Group 3 — Bundle config defaults (Stage 4's default `databricks.yml` shape)

These are design choices in Stage 4's default `databricks.yml` template that make the bundle non-portable.

| # | Defect | Where | Severity | Fix shape | Status |
|---|---|---|---|---|---|
| 3.1 | No `variables:` block by default; catalog/schema/warehouse_id hardcoded in `targets.default:` or sprinkled in source | `databricks.yml` | P2 (deploy works for SA, requires Stage 5 restructure for clients) | Stage 4 should generate `variables:` block with `client_catalog`, `client_schema`, `warehouse_id`, `run_with_synthetic_data` as first-class variables; `targets.client:` references them | ⚠️ Worked around by Stage 5 Step 3.1; root fix in Stage 4 codegen |
| 3.2 | `mode: development` (implicit or explicit) on the SA's default target — prepends `dev_<username>_` to every DAB-managed resource name (schemas, jobs, pipelines, dashboards) | `databricks.yml` targets | **P1 silent corruption for clients** — client expects `<their_schema>`, gets `dev_jane_doe_<their_schema>`. Also breaks `${var.client_schema}` substitution because the pipeline writes to the prefixed name while the resource declares the unprefixed name | Stage 4 should default to `mode: production` for any target named `client`; documentation should call this out for SA-facing targets too | ⚠️ Worked around by Stage 5 explicit `mode: production`; root fix needs Stage 4 to be opinionated about target naming |
| 3.3 | Single hardcoded target instead of SA-target + client-target pattern | `databricks.yml` targets | P2 (forces Stage 5 to restructure into multi-target shape) | Stage 4 should emit `targets.<sa>` AND `targets.client:` from the start, with the SA target marked `default: true` only during local SA work | ⚠️ Worked around by Stage 5 Step 3.1 |
| 3.4 | `${var.catalog}` / `${var.schema}` naming convention instead of `${var.client_catalog}` / `${var.client_schema}` | `databricks.yml`, plus every `.py` / `.sql` / `.json` / `.lvdash.json` | P3 (works, but the names imply "the demo's catalog" not "the client's catalog" — semantic mismatch when handing to a client) | Stage 4 should use `client_catalog` / `client_schema` as the canonical names from the start | ⚠️ Worked around by Stage 5 Step 3.2 global rename across the tree; root fix is naming convention change in Stage 4 |

### Group 4 — Resource representation (`resources.json`)

How Stage 3 records the deployed resources after a successful build.

| # | Defect | Where | Severity | Fix shape | Status |
|---|---|---|---|---|---|
| 4.1 | `created_resources.*` holds real workspace-specific IDs (warehouse_id, pipeline_id, dashboard_id, genie_space_id, knowledge_assistant_id, app.id, lakebase_project_id, mlflow_experiment_path, workspace_folder) as literal values | `resources.json` | P3 (these IDs leak through to the client package if not stripped — client tries to attach to SA's resources and fails with permission errors) | Stage 3 should record these as `<created-on-deploy>` placeholders for the client target; OR Stage 4 should strip them when packaging | ⚠️ Worked around by Stage 5 Step 2 IP-strip; root fix in Stage 3's resource-recording convention |
| 4.2 | Nested keys hide workspace-specific values (e.g., `app.id`, `lakebase_project_id`) so naive top-level strip misses them | `resources.json` | P3 (Stage 5 has to explicitly enumerate the nested keys) | Stage 3 should flatten or schema-validate workspace-specific fields | ⚠️ Stage 5 enumerates explicitly; root fix is schema discipline |

### Group 5 — Source pattern issues

How Stage 3 generates the actual pipeline code.

| # | Defect | Where | Severity | Fix shape | Status |
|---|---|---|---|---|---|
| 5.1 | SDP/DLT pipeline bronze layer emitted as SQL — `${var.client_catalog}` cannot interpolate because SQL is parsed before DAB variables resolve | `src/pipeline/01_bronze.sql` | P0 for client (bundle validate fails with "variable not found in SQL context") | Stage 3 should emit bronze as `.py` (where `spark.conf.get(...)` reads the variable) OR ensure variable values are passed via Python in all pipeline DSL paths | ⚠️ Worked around by Stage 5 Step 3 conversion + delete of `.sql`; root fix is Stage 3 emitting bronze as Python from the start |
| 5.2 | Hardcoded `CATALOG = "..."` / `SCHEMA = "..."` / `VOLUME = "..."` constants in `src/data_generation/generate_data.py` | `src/data_generation/generate_data.py` | P2 (deploy works, but the data generator writes to the SA's catalog regardless of what `databricks.yml` says) | Stage 3 should generate the data generator to read from `dbutils.widgets.get(...)` parameters passed in via the DAB job task | ⚠️ Caught & called out by Stage 5 presubmit; root fix in Stage 3 codegen |
| 5.3 | Inconsistent variable naming between Python (`os.environ`, `dbutils.widgets`) and SQL (`${var.*}`) so the same catalog/schema flows through 3 different paths in one demo | Various | P2 (hard to reason about, brittle to changes) | Stage 3 should pick ONE convention (DAB widgets via job parameters) and use it consistently | ❓ Not yet documented as a hard defect — observed across demos |

### Group 6 — Generated content quality (PII / IP / artifacts)

What Stage 4 leaves behind in the package.

| # | Defect | Where | Severity | Fix shape | Status |
|---|---|---|---|---|---|
| 6.1 | SA's FE workspace URL (`https://e2-demo-field-eng.cloud.databricks.com`) embedded in `databricks.yml` `workspace.host`, source file headers, comments | Multiple files | P3 (PII / SA fingerprint; works on SA workspace, semantically wrong on client) | Stage 4 should never emit a hardcoded `workspace.host` in the client target | ⚠️ Stage 5 IP-strip handles it; root fix in Stage 4 |
| 6.2 | SA's email in commit headers, README authors, generated docstrings | Multiple files | P3 | Stage 4 should template author/owner fields with `<sa-name>` or omit them | ⚠️ Stage 5 IP-strip handles it |
| 6.3 | `META-PROMPT.md` file ships in the package — internal Stage 4 codegen scaffolding, not for clients | Project root | P3 (confusing artifact) | Stage 4 should not write this file at all, OR write it outside the package staging dir | ⚠️ Stage 5 Step 2 + Step 11 ZIP exclusion; root fix is to stop emitting it |
| 6.4 | `.databricks/` CLI cache directory shipped (created by `bundle validate` during Stage 5 packaging) | Project root | P3 (client `bundle deploy` may fail with sync-state mismatches) | Either don't run `bundle validate` inside the staging dir, or always exclude `.databricks/*` from packaging | ⚠️ Stage 5 Step 11 excludes it explicitly; ideally Stage 4 packaging never creates it |

## Roll-up by severity

| Severity | Count | Examples |
|---|---|---|
| **P0** (blocks deploy) | 6 | SDK regressions (1.1, 1.3); widgets API (2.1); cluster security mode (2.2); `outcome:` (2.3); SDP SQL bronze (5.1) |
| **P1** (silent corruption) | 2 | KnowledgeSource shape (1.2); `mode: development` prefixing (3.2) |
| **P2** (deploy works for SA, fails for client) | 6 | Dashboard params (2.4); variables block missing (3.1); single target (3.3); hardcoded constants (5.2); naming inconsistency (5.3); workspace URL (3.x sometimes) |
| **P3** (quality / hygiene) | 7 | Naming convention (3.4); resource ID leaks (4.1, 4.2); PII (6.1, 6.2); META-PROMPT.md (6.3); .databricks/ (6.4) |

## What's already shipped to upstream

- **PR #64** — ✅ **MERGED 2026-06-04** (`c91544c`). SDK regressions (Group 1, #1.1, 1.2, 1.3) fixed via dab.md guardrail + code fixes in deploy_genie.py, deploy_ka.py. Quentin's two follow-up commits (`49e7e50` deps bump, `819cf46` condense) refined it further.
- **PR #65** — Stage 5 algorithm that papers over Groups 2, 3, 4, 5, 6 at packaging time. Status: **still open**, awaiting review. **NOT the long-term answer** — see "Recommended next PRs" below. May get condensed pre-emptively before review lands per Quentin's editorial style.

## Recommended next PRs (in priority order)

1. **`stage-4-codegen-fixes` — defects 2.1, 2.2, 2.3, 5.2** (P0 + P2). Stop emitting the broken patterns in the first place. Concretely: update Stage 4's notebook-task templates to use `dbutils.widgets.text(...)`, default `data_security_mode: SINGLE_USER` on every job cluster, drop `outcome:` from non-conditional task deps, generate `generate_data.py` to read widget params.
2. **`databricks-yml-defaults` — defects 3.1, 3.2, 3.3, 3.4** (P1 + P2). Make Stage 4's default `databricks.yml` a `variables:` + `targets.client:` structure with the canonical naming. This collapses Step 3.1, 3.2, 3.3 of the Stage 5 algorithm.
3. **`sdp-bronze-python-default` — defect 5.1** (P0). Stage 3 emits bronze as `.py` not `.sql`. Collapses one of the most fragile parts of Stage 5.
4. **`resources-json-placeholders` — defects 4.1, 4.2** (P3). Stage 3 records `<created-on-deploy>` for workspace-specific IDs in the client target. Stage 5's IP-strip stops being needed for these fields.
5. **`stage-4-stop-emitting-noise` — defects 6.1, 6.2, 6.3, 6.4** (P3). Stop emitting META-PROMPT.md, stop hardcoding workspace.host, template author fields. Collapses Step 2 IP-strip.

If all 5 land, Stage 5 reduces to:
- Add the `<demo-slug>-adaptation` Genie Code skill template
- Add the README "First Run" section with the 3-line CLI snippet
- ZIP

The presubmit (and most of the 11-step algorithm) goes away.

## Open questions for the team

- Which of these has already been internally triaged? Is there an existing Linear/JIRA project where these should be filed instead of GitHub issues?
- For the SDK regressions (Group 1), is the dab.md guardrail enough, or do we also want a CI check that lints the generated `deploy_*.py` against the current SDK signatures? (Out-of-scope for in-repo CI today since there's no CI infra; could be a pre-commit hook.)
- For the codegen defects (Group 2), is the right fix path: (a) modify the Stage 4 prompt templates that drive the agent, (b) add post-generation validation in the agent that runs presubmit-equivalent checks, or (c) both?
- Should we open one GitHub issue per defect (15+ issues) or batch them into 5 issues mapped to the 5 recommended PRs above?

## Cross-references

- [#64](https://github.com/databricks-field-eng/industry-demo-prompts/pull/64) — DAB SDK fixes (merged 2026-06-04); closes Group 1.
- [#65](https://github.com/databricks-field-eng/industry-demo-prompts/pull/65) — Stage 5 client handoff; the 11-step algorithm + presubmit that papers over Groups 2-6 today. The recommended next PRs in this doc would let it collapse to ~3 trivial steps.

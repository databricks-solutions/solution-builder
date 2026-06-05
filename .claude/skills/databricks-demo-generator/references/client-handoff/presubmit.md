---
name: stage-5-handoff-presubmit
description: "Pre-submit validation AND auto-fix for an industry-demo-prompts Stage 5 client-handoff package. Runs immediately after Stage 5 produces the package and BEFORE `databricks bundle validate`. Auto-fixes two known upstream Stage-4 codegen defects (wrong widgets API, missing UC cluster security mode) and reports all other defects so the agent can patch them. Returns pass/fail with a list of fixes applied."
---

# Stage 5 Handoff Pre-Submit — validate AND auto-fix

After Stage 5 produces a handoff package (typically `<project>/` with `databricks.yml` at root), this skill runs 9 checks. Checks 1 and 3 are **auto-fix** — known upstream Stage-4 codegen defects patched in place. The rest are detect-and-report.

Each defect caught here saves ~5 minutes of bundle deploy + job run + failure diagnosis on the client workspace.

> **Why auto-fix?** The defects in Checks 1 and 3 originate upstream in Stage 4. Until that upstream fix lands, every handoff inherits them. Stage 5 is the last layer that can correct them before the client sees a broken bundle.

## When to invoke

- The demo-generator agent has produced a Stage 5 handoff package and is about to run `databricks bundle validate` (Step 5 of `client-handoff.md`).
- The user runs presubmit directly on a `client_ready/` dir before importing to a client workspace.
- The user reports a deploy/job-run failure matching one of the patterns below.

## Inputs

- `HANDOFF_DIR` — absolute path to the unzipped handoff (the dir containing `databricks.yml`).
- (Optional) `CLIENT_PROFILE` — Databricks CLI profile for the client/FEVM workspace, used by Check 8.

## Auto-fix checks

### Check 1 — Widgets API (AUTO-FIX)

`dbutils.widgets.addText` is not a valid method; the correct API is `dbutils.widgets.text`. Stage 4's synth-data template uses the wrong form, which fails at job-run time with `AttributeError: 'WidgetsHandler' object has no attribute 'addText'`.

Detect: `grep -rln "dbutils\.widgets\.addText" "$HANDOFF_DIR" --include="*.py"`. For each hit, use `Edit` with `replace_all: true` to rewrite `dbutils.widgets.addText` → `dbutils.widgets.text` (so the change is visible in the diff). Log: `AUTO-FIX: widgets API — patched N files: <list>`. If no hits, log `PASS: widgets API`.

### Check 3 — UC-compatible cluster security mode (AUTO-FIX)

Every `job_clusters.new_cluster:` block must declare `data_security_mode: SINGLE_USER` (or `USER_ISOLATION`) to access Unity Catalog. Without it, the job fails at runtime with `[REQUIRES_SINGLE_PART_NAMESPACE] spark_catalog requires a single-part namespace`. Stage 4's cluster template omits this.

Detect — for every `*.yml` under `$HANDOFF_DIR/resources/`, scan each `new_cluster:` block for a sibling `data_security_mode:` within ~30 lines:

```bash
for f in $(find "$HANDOFF_DIR/resources" -name "*.yml"); do
  if grep -q "new_cluster:" "$f"; then
    awk '/new_cluster:/{found=1; count=0; next} found && count<30 {if (/data_security_mode/) {found=0}; count++} found && count>=30 {print FILENAME; found=0}' "$f"
  fi
done
```

Files emitted need the patch. Auto-fix with the `Edit` tool — pass the existing `new_cluster:` block as `old_string`, the patched block (insert `data_security_mode: SINGLE_USER` at sibling indent) as `new_string`. Bash one-liners are too fragile for indented YAML.

If the bundle uses serverless compute (no `new_cluster:` anywhere), log `PASS: cluster security mode (serverless — N/A)`. If every block already has `data_security_mode:`, log `PASS: cluster security mode (N clusters checked)`. Otherwise patch and log `AUTO-FIX: cluster security mode — added data_security_mode: SINGLE_USER to N files: <list>`.

## Detect-only checks (agent must patch)

### Check 2 — IP-strip — SA workspace catalogs / hosts / emails

The handoff must not contain literal references to the SA's build workspace. Grep for the patterns below across `*.py *.yml *.json *.md` (exclude `HANDOFF_NOTES.md` — that file is meta-commentary and may reference SA fingerprints intentionally):

```bash
FORBIDDEN_PATTERNS=(
  'ai_demo_gen[^_]'                              # SA catalog literal
  '@databricks\.com'                              # SA email
  'e2-demo-field-eng\.cloud\.databricks\.com'    # SA workspace URL
  'demo_harvestly_v3_rebuild_sdk_patched'        # SA schema literal
  '/Workspace/Users/morgan\.williams'             # SA workspace path
)
```

No auto-fix — the agent removes the leak (likely a Stage 2 strip miss).

### Check 4 — Bronze layer is Python, not SDP SQL with hardcoded paths

SDP SQL `read_files()` can't interpolate `${var.client_catalog}`. Bronze must be Python that uses `spark.conf.get("demo.client_catalog")`.

```bash
# Fail if any SQL bronze hardcodes a Volume path:
grep -rEln "FROM\s+(STREAM\s+)?read_files\s*\(\s*['\"]\\/Volumes\\/" "$HANDOFF_DIR" --include="*.sql"
# Fail if no *bronze*.py exists, or it doesn't use spark.conf.get('demo.client_catalog').
```

No auto-fix — converting SQL bronze to Python bronze is a structural rewrite owned by Step 3.3 of `client-handoff.md`.

### Check 5 — Genie Code skill placeholders resolved

The bundled `.assistant/skills/<demo-slug>-adaptation/SKILL.md` must have no `{{...}}` placeholders left. Fail if no SKILL.md exists, or if any `{{` remains. No auto-fix — placeholder resolution needs project context (demo slug, persona, table names) the presubmit doesn't have.

### Check 6 — Excluded files not packed

Per Step 11: `.databricks/`, `META-PROMPT.md`, `.anthropic_token`, `get_anthropic_token.sh`, the ZIP itself, and `install.sh` (v0 artifact — superseded by the v1.1 CLI snippet) must not exist at the package root or one level down. No auto-fix — `rm -rf` the offending paths and re-run.

### Check 7 — databricks.yml has the right shape

Single `client:` target, `mode: production` (or omitted), four variables (`client_catalog`, `client_schema`, `warehouse_id`, `run_with_synthetic_data`), no leaked `dev:`/`prod:` targets. No auto-fix — re-run Step 3 of `client-handoff.md`.

### Check 8 — `databricks bundle validate` (the official gate)

Run after all auto-fixes have been applied. This is the hard gate of `client-handoff.md` Step 5.

```bash
cd "$HANDOFF_DIR"
DATABRICKS_AUTH_STORAGE=plaintext databricks bundle validate --target client --profile "$CLIENT_PROFILE"
# Expected: exit 0 + "Validation OK!"
```

If this fails after auto-fixes and the upstream checks pass, the failure is structural (YAML error, missing include, etc.) — report exit code + error verbatim.

### Check 9 — No v1 artifacts (v1.1)

v1.1 packages must not contain v1 setup-target artifacts. Fail if any of:

- `databricks.yml` has a `setup:` target.
- `resources/setup.yml` exists.
- `src/setup/install_skill.py` exists.
- `README.md` references `bundle deploy --target setup` or `bundle run skill_setup`.
- `README.md` is missing the v1.1 CLI snippet (`workspace import-dir .assistant/skills`).

Background: DAB v1.1.0 doesn't support `${resources.jobs.<key>}` self-reference, so the v1 `setup` target inherited all bundle resources and failed at terraform apply on placeholder catalog/warehouse values (observed on FEVM 2026-06-02). v1.1 installs via a 3-line CLI snippet pasted into the web terminal. The skill carrier at `.assistant/skills/<slug>-adaptation/` still ships in v1.1 — only the setup-target machinery is gone. No auto-fix — re-run `client-handoff.md` Step 6 and Step 8.

## Output format

```
=== Stage 5 Handoff Pre-Submit Report ===
[1/9] AUTO-FIX: widgets API — patched 1 file: src/data_generation/generate_data.py
[2/9] PASS: IP-strip
[3/9] AUTO-FIX: cluster security mode — added data_security_mode: SINGLE_USER to 1 file: resources/job.yml
[4/9] PASS: bronze layer
[5/9] PASS: Genie Code skill placeholders (1 skill checked)
[6/9] PASS: no excluded artifacts (install.sh absent — v1 OK)
[7/9] PASS: databricks.yml shape
[8/9] PASS: bundle validate (setup + client)
[9/9] PASS: no v1 artifacts

Fixes applied:
  - src/data_generation/generate_data.py: dbutils.widgets.addText → dbutils.widgets.text (3 sites)
  - resources/job.yml: added `data_security_mode: SINGLE_USER` to job_clusters.new_cluster

OVERALL: PASS — safe to deploy to client workspace
```

If any non-auto-fix check FAILs, list the failure(s) and STOP — do not proceed to Step 6 of `client-handoff.md`.

## Why auto-fix lives here (not in `client-handoff.md`)

`client-handoff.md` is about adaptation (IP-strip, DAB restructure, generate the Genie Code skill, package). Auto-patching Stage 4 codegen defects is a different responsibility — defensive fixup against known upstream bugs. When the upstream Stage 4 templates are fixed, the auto-fix logic in this skill becomes a no-op and can be removed without touching `client-handoff.md`.

## Notes

- Check 2's forbidden-pattern list is project-specific. Update it when porting to a different SA workspace.
- This skill is invoked from `client-handoff.md` Step 5.
- If the invoking agent doesn't have file-editing tools (e.g., running headless), auto-fix degrades to detect-and-report — log fixes that *would* have applied and exit FAIL.

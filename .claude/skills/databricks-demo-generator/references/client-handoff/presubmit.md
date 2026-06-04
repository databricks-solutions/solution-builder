---
name: stage-5-handoff-presubmit
description: "Pre-submit validation AND auto-fix for an industry-demo-prompts Stage 5 client-handoff package. Runs immediately after Stage 5 produces the package and BEFORE `databricks bundle validate`. Auto-fixes two known upstream Stage-4 codegen defects (wrong widgets API, missing UC cluster security mode) and reports all other defects so the agent can patch them. Returns pass/fail with a list of fixes applied."
---

# Stage 5 Handoff Pre-Submit — validate AND auto-fix

After the demo-generator agent produces a Stage 5 handoff package (typically at `<project>/` with `databricks.yml` at the root), this skill runs 9 checks. Checks 1 and 3 are **auto-fix** — known upstream Stage-4 codegen defects that this skill patches in place. The rest are detect-and-report.

Each defect caught here saves ~5 minutes of bundle deploy + job run + failure diagnosis on the client workspace.

> **Why auto-fix?** The two defects in Checks 1 and 3 originate in Stage 4 templates upstream (industry-demo-prompts). Until that upstream fix lands, every handoff inherits them. Stage 5 is the last layer that can correct them before the client sees a broken bundle. The fix log lets the SA see exactly what was patched.

## When to invoke

- The demo-generator agent has produced a Stage 5 handoff package and is about to run `databricks bundle validate` in Step 5 of `client-handoff.md`.
- The user runs the presubmit directly on a `client_ready/` dir before importing to a client workspace.
- The user reports a deploy or job-run failure matching one of the patterns below — the skill can re-run on an already-imported package and report which fixes would apply.

## Inputs

- `HANDOFF_DIR` — absolute path to the unzipped handoff package (the dir containing `databricks.yml`).
- (Optional) `CLIENT_PROFILE` — Databricks CLI profile for the client/FEVM workspace, used only by Check 8.

## Auto-fix checks

These two checks **patch the package in place** when defects are found. Each fix is logged in the final report.

### Check 1 — Widgets API (AUTO-FIX)

`dbutils.widgets.addText` is **not a valid method**. The correct API is `dbutils.widgets.text`. Stage 4's synth-data generator template uses the invalid form, which fails at job-run time with `AttributeError: 'WidgetsHandler' object has no attribute 'addText'`.

**Detect:**

```bash
HITS=$(grep -rln "dbutils\.widgets\.addText" "$HANDOFF_DIR" --include="*.py" 2>/dev/null)
```

**Auto-fix** — for every file in `$HITS`, replace `dbutils.widgets.addText` with `dbutils.widgets.text`. The agent should use its `Edit` tool with `replace_all: true` on each file so the change is visible in the diff. macOS-compatible shell alternative if needed:

```bash
for f in $HITS; do
  sed -i '' 's/dbutils\.widgets\.addText/dbutils.widgets.text/g' "$f"
done
```

Log: `AUTO-FIX: widgets API — patched N files: <list>`. If `$HITS` is empty, log `PASS: widgets API`.

### Check 3 — UC-compatible cluster security mode (AUTO-FIX)

Every `job_clusters.new_cluster:` block must declare `data_security_mode: SINGLE_USER` (or `USER_ISOLATION`) to access Unity Catalog. Without it, the job fails at runtime with `[REQUIRES_SINGLE_PART_NAMESPACE] spark_catalog requires a single-part namespace`.

Stage 4's cluster template omits `data_security_mode`. This skill patches it in.

**Detect + auto-fix** — for every `*.yml` under `$HANDOFF_DIR/resources/`:

1. If the file contains `new_cluster:` but no `data_security_mode:` line within 30 lines below, the cluster needs a patch.
2. Insert `data_security_mode: SINGLE_USER` as a sibling key under `new_cluster:`, matching the indentation of other sibling keys (e.g., `spark_version:`, `node_type_id:`).
3. The agent should use its `Edit` tool — pass the existing `new_cluster:` block as `old_string` and the patched block as `new_string` so the change is visible in the diff. Bash one-liner is too fragile for indented YAML insertion; do this with the Edit tool only.

Detection bash:

```bash
for f in $(find "$HANDOFF_DIR/resources" -name "*.yml" 2>/dev/null); do
  if grep -q "new_cluster:" "$f"; then
    # Check if data_security_mode appears within 30 lines after each new_cluster: occurrence
    awk '/new_cluster:/{found=1; count=0; next} found && count<30 {if (/data_security_mode/) {found=0}; count++} found && count>=30 {print FILENAME; found=0}' "$f"
  fi
done
```

Files emitted by the awk are the ones that need the patch.

If the bundle uses **serverless compute** (no `new_cluster:` anywhere), this check is N/A — serverless is UC-compatible by default. Log: `PASS: cluster security mode (serverless — N/A)`.

If `new_cluster:` is present and `data_security_mode:` is already there in every block, log `PASS: cluster security mode (N clusters checked)`.

Otherwise: patch each affected file, then log `AUTO-FIX: cluster security mode — added data_security_mode: SINGLE_USER to N files: <list>`.

## Detect-only checks (no auto-fix — agent must patch)

### Check 2 — IP-strip — SA workspace catalogs / hosts / emails

The handoff must not contain literal references to the SA's build workspace.

```bash
FORBIDDEN_PATTERNS=(
  'ai_demo_gen[^_]'                              # SA catalog literal (allow ai_demo_gen_xxx fictional names)
  '@databricks\.com'                              # SA email
  'e2-demo-field-eng\.cloud\.databricks\.com'    # SA workspace URL
  'demo_harvestly_v3_rebuild_sdk_patched'        # SA schema literal
  '/Workspace/Users/morgan\.williams'             # SA workspace path
)
for pat in "${FORBIDDEN_PATTERNS[@]}"; do
  hits=$(grep -rEn "$pat" "$HANDOFF_DIR" --include="*.py" --include="*.yml" --include="*.json" --include="*.md" 2>/dev/null | grep -v "^.*HANDOFF_NOTES\.md:")
  if [ -n "$hits" ]; then
    echo "FAIL: IP-strip leak ($pat):"
    echo "$hits" | head -3
  fi
done
```

`HANDOFF_NOTES.md` is a meta-commentary file and may reference SA-side fingerprints intentionally — exclude it from this scan.

**No auto-fix** — the agent must remove the leak (likely a Stage 2 strip miss).

### Check 4 — Bronze layer is Python, not SDP SQL with hardcoded paths

SDP SQL `read_files()` can't interpolate `${var.client_catalog}` — bronze must be Python that uses `spark.conf.get("demo.client_catalog")`.

```bash
SQL_BRONZE=$(grep -rEln "FROM\s+(STREAM\s+)?read_files\s*\(\s*['\"]\\/Volumes\\/" "$HANDOFF_DIR" --include="*.sql" 2>/dev/null)
if [ -n "$SQL_BRONZE" ]; then
  echo "FAIL: SDP SQL bronze with hardcoded Volume path — must convert to Python bronze:"
  echo "$SQL_BRONZE"
fi

PY_BRONZE=$(find "$HANDOFF_DIR" -name "*bronze*.py" 2>/dev/null)
if [ -z "$PY_BRONZE" ]; then
  echo "FAIL: no Python bronze file found (*bronze*.py)"
elif ! grep -q "spark\.conf\.get.*demo\.client_catalog" $PY_BRONZE 2>/dev/null; then
  echo "FAIL: Python bronze doesn't use spark.conf.get('demo.client_catalog')"
fi
```

**No auto-fix** — converting SQL bronze to Python bronze is a structural rewrite owned by Step 3.3 of `client-handoff.md`.

### Check 5 — Genie Code skill placeholders resolved

The bundled `.assistant/skills/<demo-slug>-adaptation/SKILL.md` must have no `{{...}}` placeholders remaining.

```bash
SKILL_FILES=$(find "$HANDOFF_DIR/.assistant/skills" -name "SKILL.md" 2>/dev/null)
if [ -z "$SKILL_FILES" ]; then
  echo "FAIL: no .assistant/skills/<slug>/SKILL.md bundled — Genie Code won't auto-load"
else
  for f in $SKILL_FILES; do
    count=$(grep -c "{{" "$f" 2>/dev/null || echo 0)
    if [ "$count" -gt 0 ]; then
      echo "FAIL: $f has $count unresolved {{...}} placeholders"
    fi
  done
fi
```

**No auto-fix** — placeholder resolution requires project context the presubmit doesn't have (demo slug, persona, table names from specs).

### Check 6 — Excluded files not packed

Per `client-handoff.md` Step 11: `.databricks/`, `META-PROMPT.md`, `.anthropic_token`, `get_anthropic_token.sh`, the ZIP itself. **`install.sh`** is also a v0 artifact that must NOT exist in v1 packages — it's superseded by the `setup` target (see Check 9).

```bash
SHOULD_NOT_EXIST=(.databricks META-PROMPT.md .anthropic_token get_anthropic_token.sh install.sh)
for name in "${SHOULD_NOT_EXIST[@]}"; do
  hits=$(find "$HANDOFF_DIR" -maxdepth 2 -name "$name" 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "FAIL: should-exclude artifact present: $hits"
  fi
done
```

**No auto-fix** — agent should `rm -rf` the offending paths and re-run the check.

### Check 7 — databricks.yml has the right shape

Single `client:` target, `mode: production`, four variables (`client_catalog`, `client_schema`, `warehouse_id`, `run_with_synthetic_data`), no leaked `dev:`/`prod:` targets.

```bash
YML="$HANDOFF_DIR/databricks.yml"
if ! grep -q "^\s*client:" "$YML"; then echo "FAIL: no 'client:' target in databricks.yml"; fi
if grep -qE "^\s*(dev|prod):" "$YML"; then echo "FAIL: dev or prod target leaked"; fi
if ! grep -q "mode:\s*production" "$YML"; then echo "FAIL: client target missing 'mode: production'"; fi
for var in client_catalog client_schema warehouse_id run_with_synthetic_data; do
  if ! grep -q "^\s*$var:" "$YML"; then echo "FAIL: variable $var missing"; fi
done
```

**No auto-fix** — shape errors mean Step 3 of `client-handoff.md` didn't run correctly; agent must re-run that step.

### Check 8 — `databricks bundle validate` (the official gate)

Run after all auto-fixes have been applied. This is the hard gate of `client-handoff.md` Step 5. v1.1 ships a single `client` target.

```bash
cd "$HANDOFF_DIR"
DATABRICKS_AUTH_STORAGE=plaintext \
  databricks bundle validate --target client --profile "$CLIENT_PROFILE"
# Expected: exit 0 + "Validation OK!"
```

If this fails after auto-fixes + the upstream detect-only checks pass clean, the failure is structural (YAML error, missing include, etc.) — report exit code + error verbatim.

### Check 9 — No v1 artifacts (v1.1)

v1.1 packages must NOT contain any of the v1 setup-target artifacts. If any of these exist, the package is on the v1 path and won't work cleanly on FEVM (the setup target fails deploy because DAB v1.1.0 doesn't support `${resources.jobs.<key>}` self-reference and the target inherits all bundle resources).

```bash
YML="$HANDOFF_DIR/databricks.yml"

# 1. databricks.yml must NOT have a `setup:` target
if awk '/^targets:/,/^[^[:space:]]/{print}' "$YML" | grep -qE "^\s*setup:"; then
  echo "FAIL: databricks.yml has 'setup:' target — v1 artifact, must be removed in v1.1"
fi

# 2. resources/setup.yml must NOT exist
if [ -f "$HANDOFF_DIR/resources/setup.yml" ]; then
  echo "FAIL: resources/setup.yml exists — v1 artifact, must be removed in v1.1"
fi

# 3. src/setup/install_skill.py must NOT exist
if [ -f "$HANDOFF_DIR/src/setup/install_skill.py" ]; then
  echo "FAIL: src/setup/install_skill.py exists — v1 artifact, must be removed in v1.1"
fi

# 4. README must contain the v1.1 3-line CLI snippet (not the v1 bundle commands)
if [ -f "$HANDOFF_DIR/README.md" ]; then
  if grep -q "bundle deploy --target setup\|bundle run skill_setup" "$HANDOFF_DIR/README.md"; then
    echo "FAIL: README.md still references v1 setup-target commands — must use the 3-line CLI snippet"
  fi
  if ! grep -q "workspace import-dir .assistant/skills" "$HANDOFF_DIR/README.md"; then
    echo "FAIL: README.md missing the v1.1 CLI install snippet (workspace import-dir .assistant/skills)"
  fi
fi
```

**No auto-fix** — if any sub-check fails, the agent must re-run `client-handoff.md` Step 6 and Step 8 (the v1.1-aware versions). The skill carrier at `.assistant/skills/<slug>-adaptation/` still ships in v1.1 — it's only the setup-target install machinery that's removed.

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
[9/9] PASS: setup target + install_skill notebook present

Fixes applied:
  - src/data_generation/generate_data.py: dbutils.widgets.addText → dbutils.widgets.text (3 sites)
  - resources/job.yml: added `data_security_mode: SINGLE_USER` to job_clusters.new_cluster

OVERALL: PASS — safe to deploy to client workspace
```

If any non-auto-fix check FAILs, list the failure(s) and STOP — do not proceed to Step 6 of `client-handoff.md` until they're fixed by the agent.

## Why auto-fix lives here (not in `client-handoff.md`)

`client-handoff.md` is about **adaptation** (IP-strip, DAB restructure, generate the Genie Code skill, package). Auto-patching Stage 4 codegen defects is a different responsibility — defensive fixup against known upstream bugs.

Keeping them separated means: when the upstream Stage 4 templates are fixed (in a PR to `industry-demo-prompts` against `databricks-demo-generator/references/blocks/`), the auto-fix logic in this skill becomes a no-op (PASS on every run) and can be removed without touching `client-handoff.md`.

## Notes

- Check 2's forbidden-pattern list is project-specific. Update the list when porting to a different SA workspace.
- This skill is invoked from `client-handoff.md` Step 5 — see that doc for the algorithm context.
- If the agent invoking this skill doesn't have access to its own file-editing tools (e.g., running headless), auto-fix degrades gracefully to detect-and-report mode — log the fixes that *would* have applied and exit with FAIL so the SA knows manual action is required.

# Maintainer evaluation

`evaluation/` is the durable, runner-neutral evaluation API for Solution Builder. It is outside `app/`, the shipped `databricks-demo-generator` skill, deployed app wheel artifacts, installers, and all deployed routes.

## Contracts

- `cases/*.yaml` contains the versioned canonical scenarios. `tests/pipeline` consumes the same files.
- `models.py` and `schema/scenario.schema.json` define the Pydantic and JSON Schema contracts.
- `adapter.py` converts a scenario losslessly into transient SkillForge v5 assets with `shared_cwd: true`.
- `skillforge.lock.yaml` pins SkillForge and ai-dev-kit by full Git commit.
- `EvalRun` is the normalized result contract. Generated fixtures, raw output, normalized JSON, HTML, and leak reports live under `test-runs/skillforge/`.

SkillForge is never installed by `sb-eval`. The CLI discovers the external `stf` executable, requires `stf build-info --json`, and verifies its version, revision, and safety features against the lock.

## Commands

```bash
uv run sb-eval cases validate
uv run sb-eval doctor
uv run sb-eval run --levels L1,L3
uv run sb-eval run --levels all --live --scenario financial-services
```

`--scenario all` is the default. Scores and gaps are informational; the command does not apply a minimum score. External runner errors, `invalid_eval`, missing live requirements, and cleanup leaks return nonzero.

## Live guardrails

Live runs are manual only. Set all of:

```bash
export SB_EVAL_DATABRICKS_PROFILE=solution-builder-eval
export SB_EVAL_ALLOWED_PROFILES=solution-builder-eval
export SB_EVAL_ALLOWED_HOSTS=https://non-production-workspace.example.com
```

The profile name may not be `DEFAULT`, `prod`, or `production`. The resolved host must exactly match the allowlist, and `databricks current-user me` must identify the caller as a service principal. Every run/case/side receives distinct `SB_EVAL_CATALOG`, `SB_EVAL_SCHEMA`, and `SB_EVAL_RESOURCE_PREFIX` values. Setup writes `.skillforge/run-context.json`; cleanup reconciles `resources.json` with SkillForge tracking, deletes in reverse dependency order, retries, and writes `leak-report.json`. Any remainder fails the command.

## Improvement loop

1. Run a quick or full evaluation on a feature branch.
2. Inspect normalized gaps, raw SkillForge output, and MLflow traces.
3. Run `/forge-improve <skill> --run-id <id>` locally.
4. Review the skill diff; improvement never writes directly to `main`.
5. Re-run the identical scenarios and confirm no regressions or leaks.
6. Submit the change through the normal reviewed PR process.

Shared reports belong in MLflow and CI artifacts, not Git. No GitHub credentials, evaluation controls, or reports belong in the deployed app.

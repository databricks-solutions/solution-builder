# Scenario contracts

`evaluation/` contains the versioned, runner-neutral scenarios used by the
Solution Builder pipeline tests. It is outside `app/`, the shipped
`databricks-demo-generator` skill, installers, and deployed application routes.

## Contents

- `cases/*.yaml` defines the canonical prompts, stages, capabilities, expected
  artifacts, assertions, citations, and cleanup ownership.
- `models.py` validates those files with strict Pydantic models.
- `schema/scenario.schema.json` is the committed JSON Schema representation.
- `tests/pipeline/scenarios.py` exposes a small compatibility view for the
  existing pipeline harness.

## Validation

```bash
uv run sb-eval cases validate
uv run python -m evaluation.schema_generator --check
uv run pytest tests/evaluation
```

These contracts intentionally do not select, install, or integrate an
evaluation runner. Maintainers can consume the YAML through tooling outside
this public repository.

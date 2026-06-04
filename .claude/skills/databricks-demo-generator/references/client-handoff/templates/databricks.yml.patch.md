# `databricks.yml` client-handoff patch — recipe

Apply this patch as part of Stage 5 (Client Handoff). The goal: produce a `databricks.yml` that the client can deploy with one command, then edit a single `client:` target to point at their own catalog/schema/warehouse.

Modeled after the `targets:`-pattern in [`Bunch0fAtoms/document_finder/databricks.yml`](https://github.com/Bunch0fAtoms/document_finder/blob/main/databricks.yml) — adopted: variable-driven config, target-per-environment, explicit placeholders, inline comments. NOT adopted: a reference `databricks-dev` target with the SA's workspace values (stripped per IP-strip rules).

## 0 — Migrate Stage 4 variable names (critical, do this first)

Stage 4's DAB generator emits variables named `catalog`, `schema`, and `warehouse_id` (matching upstream's [`references/dab/example_databricks.yml`](../dab/example_databricks.yml)). The handoff renames `catalog` → `client_catalog` and `schema` → `client_schema` to match the Genie Code skill, the README "First Run (Client)" section, and the `ADAPTATION_GUIDE.md` — all of which reference `client_catalog` / `client_schema`. `warehouse_id` keeps its name.

**Apply the rename across the ENTIRE project tree before reshaping the YAML.** Silent leftovers cause `bundle deploy` to fail with unhelpful "variable not defined" errors on the client side. Files to scan:

- `databricks.yml`
- `resources/*.yml`
- `src/**/*.py`, `src/**/*.sql`
- Pipeline configuration blocks (often inline in `resources/pipelines.yml`)
- App `app.yml`, `app.yaml`, `config/*.json` if they reference catalog/schema vars

| Find | Replace |
|---|---|
| `${var.catalog}` | `${var.client_catalog}` |
| `${var.schema}` | `${var.client_schema}` |
| `${var.warehouse_id}` | (unchanged) |
| `spark.conf.get("demo.catalog")` (Python bronze) | `spark.conf.get("demo.client_catalog")` |
| `spark.conf.get("demo.schema")` | `spark.conf.get("demo.client_schema")` |

After applying, **grep clean**:

```bash
# Both of these MUST return empty (no orphaned old-style refs):
grep -rE '\$\{var\.(catalog|schema)\}\b' .
grep -rE 'spark\.conf\.get\("demo\.(catalog|schema)"\)' .
```

This is enforced as a hard-fail check in `client-handoff.md` Step 5 — don't skip it.

Why `client_catalog` / `client_schema` instead of keeping `catalog` / `schema`? Two reasons: (1) the new names self-document the intent ("set this to YOUR catalog, client") so the placeholder defaults `<your_catalog>` read consistently; (2) the Genie Code skill's discovery-and-write flow uses these exact names — keeping them prevents the skill's edit from accidentally clobbering an unrelated `catalog` var if the demo ever grew one.

## 1 — Reshape `databricks.yml` to the targets pattern

The final shape:

```yaml
bundle:
  name: {{demo-slug}}

include:
  - resources/*.yml

variables:
  run_with_synthetic_data:
    description: "yes = use bundled synthetic data generator; no = read from <client_catalog>.<client_schema>"
    default: "yes"
  client_catalog:
    description: "Your Unity Catalog catalog (where the demo will create tables)"
    default: "<your_catalog>"
  client_schema:
    description: "Your schema (created inside client_catalog if it doesn't exist)"
    default: "<your_schema>"
  warehouse_id:
    description: "SQL Warehouse ID for queries and dashboard"
    default: "<your_warehouse_id>"
  # ... add other demo-specific vars (model endpoints, vs_endpoint_name, etc.) below ...

targets:
  # Default target — edit values below for your workspace, then:
  #   databricks bundle deploy
  #   databricks bundle run {{job-name}}
  #
  # Genie Code can auto-detect these via the `{{demo-slug}}-adaptation` skill —
  # ask it: "set this up for my workspace"
  client:
    default: true
    # Omit `mode:` — DAB defaults to production behavior (no resource-name prefixing).
    # Do NOT set `mode: development` here: it would prepend `dev_<username>_` to every
    # schema/volume/job/pipeline/dashboard, breaking the client's expected names AND
    # diverging from the un-prefixed `${var.client_schema}` substitution.
    workspace:
      host: https://<your-workspace>.cloud.databricks.com
    variables:
      client_catalog: "<your_catalog>"
      client_schema: "<your_schema>"
      warehouse_id: "<your_warehouse_id>"
      run_with_synthetic_data: "yes"
```

Notes:
- **Only the `client:` target ships in the handoff package.** The SA's working `databricks-dev` (or similar) target is stripped per IP-strip rules — the client doesn't need to see it.
- `workspace.host` is included with a placeholder for documentation purposes. The client's CLI profile (e.g., `databricks auth login --host ...`) is what actually deploys; `host:` is a hint, not a hard requirement.
- The `include: - resources/*.yml` line lets you split job/pipeline/dashboard definitions into separate files under `resources/`. Keeps the main file scannable.

## 2 — Wire the data-generation task to the toggle

The demo's synthetic data generator typically lives at `src/data_generation/`. Gate it on `run_with_synthetic_data`.

### Pattern A — job task with `condition_task` (preferred)

```yaml
resources:
  jobs:
    {{job-key}}:
      tasks:
        - task_key: gate_synth
          condition_task:
            op: EQUAL_TO
            left: ${var.run_with_synthetic_data}
            right: "yes"
        - task_key: generate_synthetic_data
          depends_on:
            - task_key: gate_synth
              outcome: "true"
          notebook_task:
            notebook_path: src/data_generation/generate_customers.py
```

### Pattern B — early return inside the notebook

```python
import os
if os.environ.get("RUN_WITH_SYNTHETIC_DATA", "yes") == "no":
    dbutils.notebook.exit("Skipped — using client data")
```

Pass the env var via the task config:
```yaml
- task_key: generate_synthetic_data
  notebook_task:
    notebook_path: src/data_generation/generate_customers.py
    base_parameters:
      RUN_WITH_SYNTHETIC_DATA: ${var.run_with_synthetic_data}
```

Pattern A is cleaner; use Pattern B when the demo's job structure can't accommodate `condition_task` without rewriting.

## 3 — Wire the pipeline data source

SDP SQL `read_files()` can't interpolate Spark conf vars, so use Python bronze:

```python
# src/pipeline/bronze.py
import dlt

@dlt.table
def bronze_customers():
    run_synth = spark.conf.get("demo.run_with_synthetic_data", "yes")
    if run_synth == "yes":
        return spark.read.table(
            f"{spark.conf.get('demo.client_catalog')}."
            f"{spark.conf.get('demo.client_schema')}.synth_customers"
        )
    client_catalog = spark.conf.get("demo.client_catalog")
    client_schema = spark.conf.get("demo.client_schema")
    return spark.read.table(f"{client_catalog}.{client_schema}.customers")
```

Pass through via pipeline configuration:
```yaml
resources:
  pipelines:
    {{pipeline-key}}:
      configuration:
        demo.run_with_synthetic_data: ${var.run_with_synthetic_data}
        demo.client_catalog: ${var.client_catalog}
        demo.client_schema: ${var.client_schema}
```

## 4 — Add TODO markers where automation can't be perfect

When the demo's structure doesn't fit Patterns A or B cleanly, leave a `TODO(client-handoff)` comment so the SA knows what to verify manually. Example:

```yaml
# TODO(client-handoff): verify this notebook reads from ${var.client_catalog}/${var.client_schema}
#                       — pattern doesn't gate cleanly via condition_task
```

## 5 — Validate after applying

After patching, the SA should run:

```bash
databricks bundle validate
databricks bundle summary -t client
```

The `summary` output should show every variable resolved to either a sensible default (`"yes"` for `run_with_synthetic_data`) or a placeholder the client will fill in (`<your_catalog>`, etc.). If any required variable still has an empty default and no placeholder, that's a gap — fix it.

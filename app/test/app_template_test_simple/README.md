# app_template_test_simple — Simple-demo dogfood harness

A minimal, runnable copy of the **simple** LuxeBeauty example's data-gen +
dashboard, for testing the simple path end-to-end (mirrors how
`app_template_test/` dogfoods the full demo).

```
src/
├── data_generation/generate_data.py   # copy of example-luxebeauty-simple's generator
└── dashboard/dashboard.json            # copy of example-luxebeauty-simple's dashboard
```

Both files are byte-for-byte copies of
`.claude/skills/databricks-solution-builder/references/example-luxebeauty-simple/`
— keep them in sync when the skill reference changes.

## Run it

```bash
# 1. Generate data into a scratch schema (Spark via databricks-connect)
cd src/data_generation
DATABRICKS_CONFIG_PROFILE=<profile> \
  DEMO_CATALOG=<catalog> DEMO_SCHEMA=<scratch_schema> \
  python3 generate_data.py        # add LUXE_PIN_TIME=1 for a reproducible run

# 2. Create + publish a dashboard from that data (ALWAYS pass the dataset
#    catalog/schema — lakeview create/update strips them otherwise)
databricks lakeview create \
  --json @<(python3 - <<'PY'
import json
print(json.dumps({
  "display_name": "LuxeBeauty Simple Test",
  "parent_path": "/Workspace/Users/<you>",
  "warehouse_id": "<wh>",
  "serialized_dashboard": open("../dashboard/dashboard.json").read(),
}))
PY
) --dataset-catalog <catalog> --dataset-schema <scratch_schema> -p <profile>

databricks lakeview publish <dashboard_id> --warehouse-id <wh> -p <profile>
```

The generator produces raw → silver → gold; the dashboard reads the gold
tables directly (no metric view — that's the full demo). Verified end-to-end on
e2-demo-west.

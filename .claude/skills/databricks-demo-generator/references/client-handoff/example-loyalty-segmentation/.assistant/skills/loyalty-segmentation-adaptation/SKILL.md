---
name: loyalty-segmentation-adaptation
description: Configure and run the Harvestly Co. loyalty segmentation demo in the user's Databricks workspace. Use when the user is working in (or has imported) the loyalty-segmentation project AND says any of "run in my workspace", "set this up", "configure for my workspace", "configure for my catalog/schema", "deploy this demo", "make this work in my workspace", OR asks about adapting the demo's structure, data contract, swapping synthetic data for real data, or how to point it at their own customer tables.
---

# Harvestly Loyalty Segmentation Adaptation

## What this project is
The Harvestly Co. loyalty segmentation demo: a Databricks DAB that segments an 800K-member loyalty base into Champions, New Loyalists, Cooling Off, and Win-Back tiers via RFM (Recency-Frequency-Monetary) signals, and pairs each tier with playbook tactics from the Customer Marketing Playbook PDF.

## Key files
- `databricks.yml` — bundle config; toggle `run_with_synthetic_data` and customer-data variables here
- `src/data_generation/` — synthetic data generator (Faker-based)
- `src/pipeline/` — SDP pipeline (bronze → silver → gold)
- `src/deploy/` — Genie Space, KA, MAS deployers (if applicable)
- `dashboard/` — Lakeview dashboard JSON (if applicable)

## How to adapt
Edit `targets.client.variables` in `databricks.yml`: keep `run_with_synthetic_data: "yes"` for first-run (the demo runs end-to-end on synthetic data so the client experiences it immediately); set `client_catalog`, `client_schema`, and `warehouse_id` to values that exist in their workspace. Then deploy: `databricks bundle deploy && databricks bundle run loyalty_segmentation_job`. Once the client has the demo running, swap to real data by flipping `run_with_synthetic_data: "no"` and pointing at their own customer table.

## Auto-detecting and writing workspace config — "run in my workspace"

When the user asks for help configuring `databricks.yml` (e.g., "run in my workspace", "set this up for my workspace", "configure for my catalog"), follow this pattern. **Always default `run_with_synthetic_data: "yes"`** so the first run works end-to-end without real data.

### Step 1 — Auto-detect what you can

Run this discovery snippet in a notebook in the client's workspace:

```python
workspace_url = spark.conf.get("spark.databricks.workspaceUrl")
current_user = spark.sql("SELECT current_user()").collect()[0][0]
current_catalog = spark.sql("SELECT current_catalog()").collect()[0][0]
current_schema = spark.sql("SELECT current_database()").collect()[0][0]
print({"workspace_url": workspace_url, "user": current_user, "current_catalog": current_catalog, "current_schema": current_schema})
```

For the warehouse, run `SHOW WAREHOUSES` (Python: `spark.sql("SHOW WAREHOUSES").collect()`) and pick the first **running** serverless warehouse — or any running warehouse if no serverless one is running.

### Step 2 — Decide which values to use vs ask about

Classify each discovered value:

| Value | If detection returns... | What to do |
|---|---|---|
| `workspace_url` | Any non-empty string | Trust it (this is the workspace they're in) — confirmation only, don't hardcode into `workspace.host` |
| `current_catalog` | `samples` / `hive_metastore` / `main` / empty | **Ask the user**: "Which catalog should this demo land in?" Don't blindly use defaults. |
| `current_catalog` | A specific user-owned catalog (anything that's not `samples` / `hive_metastore` / `main`) | Use it, but **confirm** with the user before writing |
| `current_schema` | `default` / empty | **Ask the user** what schema name to use; offer to create one (e.g., `loyalty_segmentation_demo`) |
| `current_schema` | A user-specified schema | Confirm with the user |
| `warehouse_id` | A running warehouse exists | Use it; confirm choice with the user |
| `warehouse_id` | No running warehouses found | **Ask the user** which warehouse to use (offer to start one if they have permission) |

**Always confirm before writing.** Present the proposed values in a table and explicitly ask "Apply these?" rather than auto-writing.

### Step 3 — Write the edit

Once the user confirms the values, **use your file-editing capability to actually apply the edit to `databricks.yml`** — don't just print a diff. Update `targets.client.variables`:
- `client_catalog: <confirmed catalog>`
- `client_schema: <confirmed schema>`
- `warehouse_id: <confirmed warehouse ID>`
- `run_with_synthetic_data: "yes"` ← keep this; do NOT change it on first-run

Present as an Accept/Reject UI so the client can decline.

### Step 4 — Deploy

Run:

```bash
databricks bundle validate
databricks bundle deploy
databricks bundle run loyalty_segmentation_job
```

Confirm: validate succeeds, deploy creates the resources in the chosen catalog/schema, the synth-data job populates the bronze/silver/gold tables (`customers`, `transactions`, `loyalty_redemptions`, `segments`, `segment_summary`, `campaign_performance`), and the dashboard/Genie/agents come online. Provide the user with workspace links to inspect each created resource.

### Step 5 — Re-runs and idempotency

If `databricks.yml` already has values that match the current workspace + the user's chosen catalog/schema (i.e., from a prior run of this skill), verify rather than blindly re-writing — say "no edits needed, ready to redeploy" and point at the deploy command.

## Common gotchas
- The RFM thresholds (Champions = top 10% by spend; New Loyalists = joined <6 months & ≥3 orders; Cooling Off = last order 30–90 days; Win-Back = dormant >90 days) live as SQL constants in `src/pipeline/silver/segments.sql` — if the user's loyalty program has different cutoffs, propose edits there too.
- The dashboard's `dataset_catalog` / `dataset_schema` resolve from the same DAB variables — no separate dashboard edit needed.
- The Knowledge Assistant is loaded with the Customer Marketing Playbook PDF; for real-data use, the client can swap it for their own playbook in `raw_data/pdf/`.

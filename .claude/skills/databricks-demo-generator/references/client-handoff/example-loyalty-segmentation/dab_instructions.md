# Deploying the Harvestly Loyalty Segmentation Demo

This is the client-facing deploy guide. The project is configured to run on synthetic data out of the box — no catalog or schema edits required for the first deploy.

## Prerequisites

- A Databricks workspace where you have permissions to create catalogs/schemas, tables, pipelines, dashboards, and serving endpoints.
- **Serverless compute enabled** (default for workspaces created after early 2025) — the skill-install job uses serverless.

You don't need a local Databricks CLI install. All commands below run in a **Databricks web terminal** opened inside the imported git folder; auth is pre-baked.

## Import the project

In the Databricks UI: Workspace → "+ Create" → "Git folder" → paste this repo's URL. The project appears as a folder in your Workspace.

## Install the Genie Code helper (one-time, ~10 sec)

From a web terminal opened in the imported folder, paste these three lines verbatim — no edits:

```bash
USER_EMAIL=$(databricks current-user me | python3 -c 'import sys,json;print(json.load(sys.stdin)["userName"])')
databricks workspace mkdirs "/Workspace/Users/$USER_EMAIL/.assistant/skills"
databricks workspace import-dir .assistant/skills "/Workspace/Users/$USER_EMAIL/.assistant/skills" --overwrite
```

Copies the adaptation skill from `.assistant/skills/loyalty-segmentation-adaptation/` to `/Workspace/Users/<your-username>/.assistant/skills/loyalty-segmentation-adaptation/`. Genie Code auto-loads skills from that path in any new chat.

## First run (synthetic data — zero config)

The default `client` target ships with `run_with_synthetic_data: "yes"` so the demo populates a synthetic dataset on first deploy. Run:

```bash
databricks bundle deploy --target client
databricks bundle run loyalty-segmentation-job --target client
```

The first command provisions the bundle's resources (job, pipeline, dashboard, Genie space, KA, MAS). The second runs the orchestration job which generates synthetic data and refreshes the pipeline.

Once it completes, open the workspace UI to inspect:
- The dashboard ("Harvestly Loyalty Cockpit").
- The Genie Space ("Harvestly Loyalty Analytics").
- The Knowledge Assistant ("Harvestly Customer Marketing Playbook KA").
- The Multi-Agent Supervisor endpoint.

## App + Lakebase setup (if applicable)

If this demo includes a Databricks App backed by Lakebase Postgres:

```bash
cd app
./scripts/lakebase-setup.sh           # one-time: provisions the Lakebase branch + database
databricks bundle deploy              # back at project root
```

The Lakebase scripts are referenced here, not as new bundle resources, so they don't pollute the DAB definition.

## Switching to your real data

When you're ready to run the demo on your own customer data, the Genie Code skill in this project will help. Open Genie Code in your workspace (top nav → Genie Code → New chat) and type exactly:

> `run in my workspace`

The adaptation skill (auto-loaded after you ran the setup target above) walks you through detecting your catalog/schema/warehouse and edits `databricks.yml` for you.

Full instructions: [`ADAPTATION_GUIDE.md`](ADAPTATION_GUIDE.md).

## What's bundled

- **`databricks.yml`** — bundle definition, single `client` target. Variables: `run_with_synthetic_data`, `client_catalog`, `client_schema`, `warehouse_id`.
- **`resources/`** — job, pipeline, dashboard, and agent endpoint definitions for the demo.
- **`src/`** — the synthetic data generator and SDP bronze/silver/gold pipeline.
- **`raw_data/pdf/`** — Customer Marketing Playbook PDF (Knowledge Assistant source).
- **`.assistant/skills/loyalty-segmentation-adaptation/`** — Genie Code skill carrier. The `skill_setup` job copies this to the workspace-canonical path at deploy time.
- **`ADAPTATION_GUIDE.md`** — guided walk-through for swapping synth→real data.

## Updates from the publisher

When the SA pushes a new version of this repo, run `git pull` in this folder, then re-run the 3-line helper install snippet (Step 2 above). That refreshes the Genie Code skill at the canonical path. Your `databricks.yml` edits are preserved.

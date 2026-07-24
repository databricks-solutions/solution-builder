---
name: Lakeflow Jobs
category: lakeflow
disabled: false
buildable: true
skill: databricks-jobs
---

# Lakeflow Jobs

Native **orchestrator** for all Databricks workloads with retries, conditional logic and deep observability.

## Pain

Airflow + cron + ad-hoc scripts = no single view of what's running, failed, late, or breaking. Debugging a failed daily batch means grepping logs across three tools and guessing dependencies.

## Key Features

- **Multi-task workflows** — notebooks, SQL, pipelines, ML in one DAG
- **Control flow** — branching, loops, conditional execution
- **File/table triggers** — start jobs on data arrival
- **Repair and retry** — partial reruns, automatic recovery
- **Cost controls** — budgets, timeouts, cluster policies

## Position

Closing the loop: "Here's how you run this in production every 5 minutes, with alerts and cost control."

## Implementation

The `databricks-jobs` Databricks Agent Skill (DAS) covers implementation details. Specs should specify WHAT to build and WHY (demo story), not HOW.

## Demo Tips

- **Usually mentioned, rarely shown live** — orchestration is "boring" but essential
- For the "how does this run in production?" question
- Triggers: "pipeline runs automatically when new data lands"
- **Repair and retry**: "if step 3 fails, you don't re-run steps 1 and 2"
- In demo narratives, Jobs keeps data fresh for the dashboard/Genie
- Show workflow DAG briefly if customer asks about scheduling

## URL

https://www.databricks.com/product/data-engineering/lakeflow-jobs

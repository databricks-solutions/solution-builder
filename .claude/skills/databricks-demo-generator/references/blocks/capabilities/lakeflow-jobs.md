---
name: Lakeflow Jobs
category: lakeflow
disabled: false
buildable: true
---

# Lakeflow Jobs

Native **orchestrator** for all Databricks workloads with retries, conditional logic and deep observability.

## Pain

Airflow + cron + ad-hoc scripts = no single view of what's running, what failed, what's late and what it breaks. Debugging a failed daily batch means grepping logs across three tools and guessing dependencies.

## Key Features

- **Multi-task workflows** - notebooks, SQL, pipelines, ML in one DAG
- **Control flow** - branching, loops, conditional execution
- **File/table triggers** - start jobs on data arrival
- **Repair and retry** - partial reruns, automatic recovery
- **Cost controls** - budgets, timeouts, cluster policies

## Position

Closing the loop: "Here's how you run this in production every 5 minutes, with alerts and cost control."

## How It Works

- **Create a job with tasks**: Each task can be a notebook, SQL query, SDP pipeline, dbt project, or Python script
- **Define dependencies**: Task B runs after Task A — visualized as a DAG
- **Triggers**: Time-based (cron), file arrival (new files in S3/ADLS), or table update (new rows in Delta table)
- **Control flow**: Branching (`IF` conditions), loops (`FOR EACH` over a list), parameter passing between tasks
- **Repair on failure**: If task 3 fails, fix it and re-run from task 3 — don't re-run tasks 1 and 2
- **Cost controls**: Set budgets, timeouts, and cluster policies to prevent runaway jobs

## Demo Tips

- **Usually mentioned, rarely shown live** — orchestration is "boring" but essential
- Good for the "how does this run in production?" question
- Mention triggers: "pipeline runs automatically when new data lands"
- Emphasize **repair and retry**: "if step 3 fails, you don't re-run steps 1 and 2"
- In demo narratives, Jobs is what keeps the data fresh for the dashboard/Genie
- Can show the workflow DAG briefly if customer asks about scheduling

## URL

https://www.databricks.com/product/data-engineering/lakeflow-jobs

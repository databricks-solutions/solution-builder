# Meta Prompt for Demo Implementation

Use this prompt to start a new session and implement the demo:

---

I have a set of instruction files in the `instructions/` folder that describe a demo I want to build on Databricks.

**Phase 1 - Understand**: Read all instruction files starting with `00-demo-overview.md` to understand the full demo scope, story, and technical requirements.

**Phase 2 - Plan**: Create a task list based on the build order in the overview. Each task should be a concrete implementation step (create file, upload data, create resource, validate). For each task, identify which skill to use (check `/skills` to see available skills - there's likely one for each type of task like data generation, pipelines, dashboards, Genie, KA, MAS).

**Phase 3 - Implement**: Work through the task list one by one:
- Before starting each task, load the relevant skill to get the latest patterns and best practices
- Create all files locally first (Python scripts, SQL files, configs)
- Upload to Databricks (volumes for data, workspace for code)
- Create Databricks resources via APIs (not DAB)
- Validate after each step that creates data or tables
- If validation fails, fix the issue before moving to the next task

**Phase 4 - Test End-to-End**: Once all resources are created, test the full demo flow as described in the instructions. Verify the demo story works and all components interact correctly. If something doesn't work, go back and fix it.

**Before starting**: Run the pre-flight check to ensure required infrastructure exists. Ask me if any resources already contain data.

---

## Resource Tracking

**IMPORTANT**: Maintain a `resources.json` file in the instructions folder to track all created Databricks resources. This makes it easy to reference IDs across steps and recover the demo state.

Create this file at the start of Phase 3 and update it after each resource is created:

```json
{
  "catalog": "dbdemos_ai_gen",
  "schema": "luxebeauty_returns",
  "volume_path": "/Volumes/dbdemos_ai_gen/luxebeauty_returns/raw_data",
  "workspace_folder": "/Workspace/Users/.../luxebeauty_demo",
  "pipeline_id": null,
  "dashboard_id": null,
  "genie_space_id": null,
  "knowledge_assistant_id": null,
  "multi_agent_supervisor_id": null
}
```

Update each `*_id` field immediately after creating the corresponding resource. This ensures you can always find and reference resources without searching.

---

## Troubleshooting

**PyPI failures**: If pip/uv fails to install packages, use the internal Databricks proxy:
```bash
--index-url https://pypi-proxy.dev.databricks.com/simple/
```

---

Begin with Phase 1 - read all the instruction files.

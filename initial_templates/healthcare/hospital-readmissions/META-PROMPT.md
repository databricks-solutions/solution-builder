# Meta Prompt for Demo Implementation

Use this prompt to start a new session and implement the demo.

---

## Quick Start

I have a set of spec files in the `specifications/` folder that describe a demo I want to build on Databricks.

**Phase 1 - Understand**: Read all spec files starting with `README.md` to understand the full demo scope, story, and technical requirements.

**Phase 2 - Plan**: Create a task list based on the build order below. Each task should be a concrete implementation step.

**Phase 3 - Implement**: Work through the task list one by one:
- **IMPORTANT - Check skills first**: Before starting each task, check if any relevant skills exist.
- Create all files locally first (Python scripts, SQL files, configs)
- Upload to Databricks (volumes for data, workspace for code)
- Create Databricks resources via APIs (not DAB)
- Validate after each step that creates data or tables

**Phase 4 - Test End-to-End**: Test the full demo flow as described in the walkthrough.

**Before starting**: Run the pre-flight check to ensure required infrastructure exists.

---

## Databricks Infrastructure

### Resource Names

| Resource | Name |
|----------|------|
| **Catalog** | `lakeside_health` |
| **Schema** | `quality_analytics` |
| **Workspace Folder** | `/Workspace/Users/{user}/ai_demos/readmissions_demo/` |

Derived paths:
- **Raw Data Volume**: `/Volumes/{catalog}/{schema}/raw_data/`
- **Clinical Docs Volume**: `/Volumes/{catalog}/{schema}/raw_data/clinical_docs/`

---

## Build Order

| Step | Task | Spec File | Output |
|------|------|------------------|--------|
| 1 | Create catalog, schema, volume | (infrastructure) | Databricks resources |
| 2 | Generate synthetic data | `01-data-generation.md` | Parquet files in volume |
| 3 | Generate clinical docs | `02-unstructured-docs.md` | PDFs in volume |
| 4 | Create SDP pipeline | `03-pipelines.md` | Bronze/Silver/Gold tables |
| 5 | Create Genie Space | `04-genie-space.md` | Genie with smart instructions |
| 6 | Create dashboard | `05-dashboard.md` | Dashboard with Genie embedded |
| 7 | Create Knowledge Assistant | `06-knowledge-assistant.md` | KA indexing clinical docs |
| 8 | Create Multi-Agent Supervisor | `07-multi-agent-supervisor.md` | MAS routing to Genie + KA |
| 9 | Test demo flow | `README.md` | Working end-to-end demo |

---

## Resource Tracking

```json
{
  "catalog": "lakeside_health",
  "schema": "quality_analytics",
  "volume_path": "/Volumes/lakeside_health/quality_analytics/raw_data",
  "workspace_folder": "/Workspace/Users/.../readmissions_demo",
  "pipeline_id": null,
  "dashboard_id": null,
  "genie_space_id": null,
  "knowledge_assistant_id": null,
  "multi_agent_supervisor_id": null
}
```

---

## Validation After Each Step

| After Step | What to Check |
|------------|---------------|
| Data generation | Parquet files exist, row counts match spec |
| Pipeline | Tables populated, heart failure patients show ~24% readmission rate |
| Genie | "Why are readmissions high?" returns meaningful analysis |
| Dashboard | Spike visible at a glance, filters work |
| KA | "Protocol change for heart failure?" returns the clinical memo |
| MAS | Routes correctly between Genie and KA |

---

## Begin

Start with Phase 1 - read all the spec files beginning with `README.md`.

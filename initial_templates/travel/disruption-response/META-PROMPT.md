# Meta Prompt for Demo Implementation

Use this prompt to start a new session and implement the demo.

---

## Quick Start

I have a set of spec files in the `specifications/` folder that describe a demo I want to build on Databricks.

**Phase 1 - Understand**: Read all spec files starting with `README.md`.

**Phase 2 - Plan**: Create a task list based on the build order below.

**Phase 3 - Implement**: Work through the task list one by one.

**Phase 4 - Test End-to-End**: Test the full demo flow as described in the walkthrough.

---

## Databricks Infrastructure

### Resource Names

| Resource | Name |
|----------|------|
| **Catalog** | `skywest_airlines` |
| **Schema** | `ops_control` |
| **Workspace Folder** | `/Workspace/Users/{user}/ai_demos/disruption_demo/` |

Derived paths:
- **Raw Data Volume**: `/Volumes/{catalog}/{schema}/raw_data/`
- **Engineering Docs Volume**: `/Volumes/{catalog}/{schema}/raw_data/engineering_docs/`

---

## Build Order

| Step | Task | Spec File | Output |
|------|------|------------------|--------|
| 1 | Create catalog, schema, volume | (infrastructure) | Databricks resources |
| 2 | Generate synthetic data | `01-data-generation.md` | Parquet files in volume |
| 3 | Generate engineering docs | `02-unstructured-docs.md` | PDFs in volume |
| 4 | Create SDP pipeline | `03-pipelines.md` | Bronze/Silver/Gold tables |
| 5 | Create Genie Space | `04-genie-space.md` | Genie with smart instructions |
| 6 | Create dashboard | `05-dashboard.md` | Dashboard with Genie embedded |
| 7 | Create Knowledge Assistant | `06-knowledge-assistant.md` | KA indexing engineering docs |
| 8 | Create Multi-Agent Supervisor | `07-multi-agent-supervisor.md` | MAS routing to Genie + KA |
| 9 | Test demo flow | `README.md` | Working end-to-end demo |

---

## Resource Tracking

```json
{
  "catalog": "skywest_airlines",
  "schema": "ops_control",
  "volume_path": "/Volumes/skywest_airlines/ops_control/raw_data",
  "workspace_folder": "/Workspace/Users/.../disruption_demo",
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
| Pipeline | Tables populated, N7xx aircraft show delay code 41 |
| Genie | "Why so many delays?" returns meaningful analysis |
| Dashboard | OTP drop visible at a glance, filters work |
| KA | "APU software issues?" returns the engineering bulletin |
| MAS | Routes correctly between Genie and KA |

---

## Begin

Start with Phase 1 - read all the spec files beginning with `README.md`.

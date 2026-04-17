# Meta Prompt for Demo Implementation

Use this prompt to start a new session and implement the demo.

---

## Quick Start

I have a set of instruction files in the `instructions/` folder that describe a demo I want to build on Databricks.

**Phase 1 - Understand**: Read all instruction files starting with `README.md`.

**Phase 2 - Plan**: Create a task list based on the build order below.

**Phase 3 - Implement**: Work through the task list one by one.

**Phase 4 - Test End-to-End**: Test the full demo flow as described in the walkthrough.

---

## Databricks Infrastructure

### Resource Names

| Resource | Name |
|----------|------|
| **Catalog** | `freshmart` |
| **Schema** | `supply_chain` |
| **Workspace Folder** | `/Workspace/Users/{user}/ai_demos/demand_forecasting_demo/` |

Derived paths:
- **Raw Data Volume**: `/Volumes/{catalog}/{schema}/raw_data/`
- **Event Docs Volume**: `/Volumes/{catalog}/{schema}/raw_data/event_docs/`

---

## Build Order

| Step | Task | Instruction File | Output |
|------|------|------------------|--------|
| 1 | Create catalog, schema, volume | (infrastructure) | Databricks resources |
| 2 | Generate synthetic data | `01-data-generation.md` | Parquet files in volume |
| 3 | Generate event docs | `02-unstructured-docs.md` | PDFs in volume |
| 4 | Create SDP pipeline | `03-pipelines.md` | Bronze/Silver/Gold tables |
| 5 | Create Genie Space | `04-genie-space.md` | Genie with smart instructions |
| 6 | Create dashboard | `05-dashboard.md` | Dashboard with Genie embedded |
| 7 | Create Knowledge Assistant | `06-knowledge-assistant.md` | KA indexing event docs |
| 8 | Create Multi-Agent Supervisor | `07-multi-agent-supervisor.md` | MAS routing to Genie + KA |
| 9 | Test demo flow | `README.md` | Working end-to-end demo |

---

## Resource Tracking

The `resources.json` file at the project root tracks capabilities and all created Databricks resources. Update its `created_resources` object after each resource is created:

```json
{
  "capabilities": { "buildable": [...], "talking_track": [...] },
  "created_resources": {
    "catalog": "freshmart",
    "schema": "supply_chain",
    "workspace_folder": "/Workspace/Users/.../demand_forecasting_demo",
    "pipeline_id": "<id>",
    "dashboard_id": "<id>",
    "genie_space_id": "<id>",
    "knowledge_assistant_id": "<id>",
    "multi_agent_supervisor_id": "<id>"
  }
}
```

---

## Validation After Each Step

| After Step | What to Check |
|------------|---------------|
| Data generation | Parquet files exist, row counts match spec |
| Pipeline | Tables populated, Metro East stores show 4x demand |
| Genie | "Why are stockouts high?" returns meaningful analysis |
| Dashboard | Spike visible at a glance, filters work |
| KA | "Events in Metro East?" returns the concert report |
| MAS | Routes correctly between Genie and KA |

---

## Begin

Start with Phase 1 - read all the instruction files beginning with `README.md`.

# Full Platform Architecture: How All Products Work Together

This reference shows how ALL Databricks capabilities connect. Products are grouped by layer and listed in data flow order. Most demos use a subset — pick what fits your story.

**Buildable column**: "Yes" means we create actual resources for this capability (dashboards, Genie spaces, pipelines, etc.). "No" means it's a talking point in the demo story — mentioned to sell the platform, but no deployment instructions generated.

---

## Block: `lakeflow` — Lakeflow (Data Engineering)

Data ingestion and transformation — how data enters and flows through the lakehouse.

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| `streaming` | Streaming | No | Structured Streaming, Auto Loader, Kafka ingestion for near-real-time data arrival. | Feeds `sdp` Bronze streaming tables |
| `zerobus-ingest` | Zerobus Ingest | No | Push-based API (gRPC/REST/OTLP) for real-time ingestion direct to Delta tables. Serverless. | Receives pushes from apps/devices |
| `synthetic-data-gen` | Synthetic Data Gen | Yes | Generate realistic demo datasets with Spark + Faker. Encodes anomalies, distributions, event injection. | Produces raw data for `sdp` Bronze layer |

---

## Block: `compute` — Compute

Infrastructure that runs workloads. Products in other blocks rely on these.

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| `serverless-compute` | Serverless Compute | No | On-demand compute for notebooks, interactive/EDA, ML training. No cluster management. | Powers `sdp`, `model-training-mlflow`, notebooks |
| `sql-warehouse` | SQL Warehouse | No | Serverless data warehouse. Photon engine for fast queries. | Powers `databricks-sql`, `dashboards`, `genie` |
| `classic-compute` | Classic Compute | No | Traditional clusters with manual sizing. Legacy — prefer `serverless-compute`. | Legacy alternative to `serverless-compute` |

---

## Block: `data-processing` — Data Processing

Transform raw data into analytics-ready tables.

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| `sdp` | SDP (Spark Declarative Pipelines) | Yes | Declarative ETL: Bronze → Silver → Gold. Streaming + batch, auto-optimization. | Consumes from data ingestion |
| `ai-functions` | AI Functions | No | SQL-native AI (`ai_classify`, `ai_extract`, `ai_summarize`) for enriching data at scale. | Enriches tables within a `sdp` pipeline or ad-hoc queries |
| `metric-views` | Metric Views | Yes | Semantic layer: define metrics once (e.g., `fraud_rate`), use everywhere. Auto-materialized / aggregated for fast BI (cube). | Sits on top of Silver/Gold tables from `sdp` |

---

## Block: `analytics` — Analytics

Query and visualize data for business insights.

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| `aibi-dashboards` | AI/BI Dashboards | Yes | Interactive visualizations. The "5-second test" — anomaly obvious at a glance. | Visualizes queries; runs on `sql-warehouse` |
| `genie` | AI/BI Genie | Yes | Natural language queries over structured data. Answers the WHAT. | Queries via `sql-warehouse` |

---

## Block: `ai-ml` — Agent Bricks (AI / ML)

AI Agents executing task, Train models, serve predictions, answer questions from documents.

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| `model-serving` | Model Serving | No | Serverless endpoints for real-time inference. Auto-scaling, pay-per-token. Guardrails + tracing. | Serves models registered in MLflow |
| `vector-search` | Vector Search | Yes | Managed embeddings + similarity search. Manual setup for custom RAG. | Indexes docs from `unity-catalog` Volumes |
| `knowledge-assistant` | Knowledge Assistant | Yes | Fully managed RAG — point at docs, get Q&A. Answers the WHY with citations. | Reads docs from `unity-catalog` Volumes |
| `supervisor-agent` | Supervisor Agent (MAS) | Yes | Orchestrates multiple agents into one interface. Routes to the right agent. | Routes to `genie`, `knowledge-assistant`, mcps, `model-serving` models |

**Note:** Knowledge Assistant is the managed path (no vector search setup). Vector Search is for custom RAG with control over chunking/retrieval.

---

## Block: `apps` — Applications

Ship internal tools powered by the lakehouse.

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| `lakebase` | Lakebase | Yes | Managed Postgres for operational workloads. App state, transactions, low-latency reads. | Syncs bidirectionally with `sdp` tables, powers `databricks-app` |
| `databricks-apps` | Databricks Apps | Yes | Serverless app runtime (Streamlit, Gradio, Dash, React). SSO + UC governance. | app OLTP leverages `lakebase`, get realtime ML inference from `model-serving`, chatbot/assistant connected to `supervisor-agent`, embedd `ai-bi-dashboards`, sends query to `sql-warehouse` |

---

## Block: `orchestration` — Orchestration

Run everything in production with reliability.

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| `lakeflow-jobs` | Lakeflow Jobs | Yes | Native orchestrator: multi-task workflows, retries, file/table triggers, cost controls. | Orchestrates all Databricks: triggers `sdp`, ML jobs, SQL queries |

---

## Block: `governance` — Governance (Unity Catalog)

Governs ALL components above — data, models, metrics, dashboards, apps.

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| `unity-catalog` | Unity Catalog | No | Unified catalog: permissions, lineage, audit logs across clouds. Fine-grained access, ABAC, data classification, quality monitoring. | Governs all blocks |

---

## Default Demo Combination

The recommended starting point for most demos:

| ID | Product | Purpose |
|----|---------|---------|
| `sdp` | SDP | Data transformation (Bronze → Silver → Gold) |
| `aibi-dashboards` | AI/BI Dashboards | Visual analytics with 5-second test |
| `genie` | AI/BI Genie | Natural language queries (the WHAT) |
| `knowledge-assistant` | Knowledge Assistant | Document Q&A (the WHY) |
| `supervisor-agent` | Supervisor Agent | Multi-agent orchestration |
| `unity-catalog` | Unity Catalog | Governance: lineage, permissions, audit |

This covers the full investigation story: transform → visualize → ask questions → get context, all governed by Unity Catalog.

---

## When to Use This Reference

- **Designing demos**: Pick the subset that fits your story
- **Explaining dependencies**: Show how products connect via "Relationship"
- **Answering "what else?"**: Point to capabilities not yet in the demo

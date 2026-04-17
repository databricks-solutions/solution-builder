# Full Platform Architecture: How All Products Work Together

This reference shows how ALL Databricks capabilities connect. Most demos use a subset — pick what fits your story.

**Buildable**: "Yes" = we create actual resources (dashboards, pipelines, etc.). "No" = talking point in the demo narrative.

## All Capabilities

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| **Lakeflow — Data ingestion, how data enters the lakehouse** |||||
| `synthetic-data-gen` | Synthetic Data Generation | Yes | Generate realistic fake data for demos. Required for most use cases — simulates what real connectors would ingest | Feeds `sdp` with demo data |
| `lakeflow-connect` | Lakeflow Connect | No | Managed connectors for SaaS apps, DBs, files (Salesforce, Workday, SAP, etc.) | Pulls from external systems |
| `zerobus-ingest` | Zerobus Ingest | No | Push-based API (gRPC/REST/OTLP) for real-time ingestion direct to Delta tables | Receives pushes from apps/devices |
| `delta-sharing` | Delta Sharing | No | Zero-copy sharing of live data from partners, consortiums, other orgs | Shares from external Databricks workspaces |
| `marketplace` | Databricks Marketplace | No | Subscribe to third-party datasets, AI models, solution accelerators | Subscribes to marketplace providers |
| **Compute — Infrastructure that runs workloads** |||||
| `serverless-compute` | Serverless Compute | No | On-demand compute for notebooks, ML training. No cluster management | Powers `sdp`, `model-training-mlflow`, notebooks |
| `sql-warehouse` | SQL Warehouse | No | Serverless data warehouse. Photon engine for fast queries | Powers `dashboards`, `genie` |
| `classic-compute` | Classic Compute | No | Traditional clusters with manual sizing. Legacy — prefer `serverless-compute` | Legacy alternative |
| **Data Processing — Transform raw data into analytics-ready tables** |||||
| `sdp` | SDP (Spark Declarative Pipelines) | Yes | Declarative ETL: Bronze → Silver → Gold. Streaming + batch, auto-optimization. Uses Auto Loader for incremental cloud storage ingestion | Consumes from ingestion |
| `ai-functions` | AI Functions | No | SQL-native AI (`ai_classify`, `ai_extract`, `ai_summarize`) for enriching data | Enriches tables within `sdp` |
| `metric-views` | Metric Views | Yes | Semantic layer: define metrics once, use everywhere. Auto-materialized for fast BI | Sits on top of Silver/Gold tables |
| **Analytics — Query and visualize data for business insights** |||||
| `databricks-one` | Databricks One | No | Simplified interface for business users: personalized home, domain browsing, unified search | Front door for consumers |
| `genie-code` | Genie Code | No | AI coding partner: autocomplete, chat, error diagnosis — all UC-aware | Assists development across all surfaces |
| `notebooks-eda` | Notebooks & EDA | No | Interactive data exploration, profiling, visualization. Multi-language | Explores data from `sdp` |
| `aibi-dashboards` | AI/BI Dashboards | Yes | Interactive visualizations. The "5-second test" — anomaly obvious at a glance | Visualizes queries via `sql-warehouse` |
| `genie` | AI/BI Genie | Yes | Natural language queries over structured data. Answers the WHAT | Queries via `sql-warehouse` |
| **Agent Bricks — AI agents, models, and document understanding** |||||
| `model-training-mlflow` | MLflow | Yes | Experiment tracking, model registry, lifecycle management. Classic ML or fine-tuning | Trains on data from `sdp` |
| `model-serving` | Model Serving | No | Serverless endpoints for real-time inference. Auto-scaling, pay-per-token. Guardrails + tracing | Serves models from `model-training-mlflow` |
| `vector-search` | Vector Search | Yes | Managed embeddings + similarity search. Manual setup for custom RAG | Indexes docs from UC Volumes |
| `knowledge-assistant` | Knowledge Assistant | Yes | Fully managed RAG — point at docs, get Q&A. Answers the WHY with citations | Reads docs from UC Volumes |
| `information-extraction` | Information Extraction | Yes | Document-to-table agent: extract structured data from PDFs, images, text | Reads docs from UC Volumes; outputs to tables |
| `supervisor-agent` | Supervisor Agent (MAS) | Yes | Orchestrates multiple agents into one interface. Routes to the right agent | Routes to `genie`, `knowledge-assistant`, `model-serving` |
| `ai-gateway` | AI Gateway | No | Central governance for LLMs: routing, guardrails, rate limits, usage tracking | Governs all `model-serving` endpoints |
| **Apps — Ship internal tools powered by the lakehouse** |||||
| `lakebase` | Lakebase | Yes | Managed Postgres for operational workloads. App state, transactions, low-latency reads | Syncs with `sdp` tables, powers apps |
| `databricks-apps` | Databricks Apps | Yes | Serverless app runtime (Streamlit, Gradio, Dash, React). SSO + UC governance | Leverages `lakebase`, `model-serving`, `supervisor-agent` |
| **Orchestration — Run everything in production with reliability** |||||
| `lakeflow-jobs` | Lakeflow Jobs | Yes | Native orchestrator: multi-task workflows, retries, file/table triggers, cost controls | Orchestrates `sdp`, notebooks, ML jobs |
| **Governance — Unity Catalog governs ALL components** |||||
| `unity-catalog` | Unity Catalog | No | Unified catalog: permissions, lineage, audit logs across clouds | Governs all capabilities |
| `data-quality` | Data Quality Monitoring | Yes | Lakehouse Monitoring: auto-detect freshness/completeness anomalies, profile tables | Monitors tables in UC schemas |
| `abac` | ABAC | Yes | Attribute-based access: tag-based policies, row filters, column masks | Controls access based on tags |
| `data-classification` | Data Classification | Yes | Auto-tag sensitive data (PII, PHI, financial) | Tags columns in `unity-catalog` |

**Note:** Knowledge Assistant is the managed RAG path (no vector search setup). Vector Search is for custom RAG with control over chunking/retrieval.

---

## Default Demo Combination

**Buildable:** `sdp`, `aibi-dashboards`, `genie`, `knowledge-assistant`, `supervisor-agent`

**Talking track:** `lakeflow-connect`, `unity-catalog`, `databricks-one`, `genie-code` (should be almost always there)

Data flows from external systems (Lakeflow Connect) through SDP transformation, visualized in Dashboards, explored via Genie (the WHAT) and Knowledge Assistant (the WHY), orchestrated by Supervisor Agent — all governed by Unity Catalog, with Databricks One as the business user entry point and Genie Code assisting development.

---

## Example Capability Selections

All demos need `synthetic-data-gen` to create realistic fake data.

**Customer 360 demo** (generic, use defaults):
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `aibi-dashboards`, `genie`, `knowledge-assistant`, `supervisor-agent`, `unity-catalog`, `databricks-one`, `genie-code`

**IoT sensor streaming demo**:
`synthetic-data-gen`, `lakeflow-connect`, `zerobus-ingest` (real-time push), `sdp`, `aibi-dashboards`, `genie`, `unity-catalog`, `genie-code`

**Fraud detection with app**:
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `aibi-dashboards`, `genie`, `knowledge-assistant`, `supervisor-agent`, `model-training-mlflow`, `model-serving` (real-time scoring), `databricks-apps`, `lakebase`, `unity-catalog`, `genie-code`

**Document processing pipeline**:
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `information-extraction`, `aibi-dashboards`, `knowledge-assistant`, `supervisor-agent`, `databricks-one`, `unity-catalog`, `genie-code`

**ML-powered recommendations**:
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `model-training-mlflow`, `model-serving`, `aibi-dashboards`, `genie`, `unity-catalog`, `databricks-one`, `genie-code`

# Full Platform Architecture: How All Products Work Together

This reference shows how ALL Databricks capabilities connect. Most demos use a subset — pick what fits your story.

**Buildable**: "Yes" = we create actual resources (dashboards, pipelines, etc.). "No" = talking point in the demo narrative.

## All Capabilities

| ID | Product | Buildable | What It Does | Relationship |
|----|---------|-----------|--------------|--------------|
| **Lakeflow — Agentic data engineering: how data enters + is transformed (governed by Unity Catalog)** |||||
| `synthetic-data-gen` | Synthetic Data Generation | Yes | Generate realistic fake data for demos. Required for most use cases — simulates what real connectors would ingest | Feeds `sdp` with demo data |
| `lakeflow-connect` | Lakeflow Connect | No | A few-click interface to connect and ingest data from 100+ sources — SaaS apps, DBs, files & knowledge mgmt (Salesforce, Workday, SAP, Jira, GitHub, Confluence, SharePoint…) | Pulls from external systems |
| `lakeflow-designer` | Lakeflow Designer | No | Drag-and-drop, no-code ETL on Spark Declarative Pipelines, with zero translation loss; pairs with Genie Code | Visual front-end to `sdp` |
| `zerobus-ingest` | Lakeflow Zerobus | No | Push-based API (gRPC/REST/OTLP) for near-real-time ingestion direct to Delta tables — <5s latency, up to 10GB/s per table; Real-Time Mode down to ~5ms | Receives pushes from apps/devices |
| `delta-sharing` | Delta Sharing | No | Zero-copy sharing of live data from partners, consortiums, other orgs | Shares from external Databricks workspaces |
| `marketplace` | Databricks Marketplace | No | Subscribe to third-party datasets, AI models, solution accelerators, and native partner Apps | Subscribes to marketplace providers |
| **Compute — Infrastructure that runs workloads** |||||
| `serverless-compute` | Serverless Compute | No | On-demand compute for notebooks, ML training. No cluster management | Powers `sdp`, `ml-training-serving`, notebooks |
| `sql-warehouse` | Lakehouse (SQL Warehouse) | No | Serverless data warehouse (Photon). "Lakehouse" is the current name for the SQL Warehouse — the two are used interchangeably | Powers `aibi-dashboards`, `genie` |
| `lakehouse-rt` | Lakehouse Real Time (SQL Warehouse on Reyden) | No | The real-time SQL Warehouse, powered by the **Reyden** engine: millisecond queries (sub-100ms at ~12,000 q/s) directly on Delta/Iceberg — no separate serving layer, no data movement | Real-time serving for `aibi-dashboards`, apps, agents |
| `classic-compute` | Classic Compute | No | Traditional clusters with manual sizing. Legacy — prefer `serverless-compute` | Legacy alternative |
| **Data Processing — Transform raw data into analytics-ready tables** |||||
| `sdp` | SDP (Spark Declarative Pipelines) | Yes | Declarative ETL: Bronze → Silver → Gold. Streaming + batch, auto-optimization, Auto Loader for incremental cloud-storage ingestion; **Real-Time Mode** for millisecond latency | Consumes from ingestion |
| `ai-functions` | AI Functions | No | SQL-native AI (`ai_classify`, `ai_extract`, `ai_parse_document`, `ai_summarize`) for enriching data + document intelligence | Enriches tables within `sdp` or using `notebooks-eda` |
| `metric-views` | Metrics | Yes | The governed semantic / metrics layer: define KPIs once with richer semantic modeling, multi-fact relationships, and materialization — used everywhere | Sits on Silver/Gold tables from `sdp`; used by `aibi-dashboards` + Genie; created via SQL on a `sql-warehouse`, saved in a notebook |
| **Analytics — Query and visualize data for business insights** |||||
| `genie-one` | Genie One | No | The enterprise AI coworker: business teams ask in natural language, get governed answers, and trigger actions across 50+ tools (Slack/Teams/Jira/email…). Grounded in Genie Ontology + Unity Catalog access controls; mobile + cross-platform with company branding | Front door for business consumers |
| `genie-code` | Genie Code | No | A copilot that lets anyone — including non-technical business or analyst users — build data pipelines, dashboards, apps and more directly on Databricks: describe what you want, Genie Code builds it for you | Builds across all surfaces |
| `notebooks-eda` | Notebooks & EDA | No | Interactive data exploration, profiling, visualization. Multi-language | Explores data from `sdp` |
| `aibi-dashboards` | AI/BI Dashboards | Yes | Interactive visualizations. The "5-second test" — anomaly obvious at a glance | Visualizes queries via `sql-warehouse` |
| **Agent Bricks — the managed agent platform (AI agents, models, document understanding)** |||||
| `agent-bricks` | Agent Bricks | No | The umbrella managed agent platform — bundles Knowledge Assistant, Supervisor Agent and the other agent building blocks. Choice (any model), Context (Genie Ontology + agentic search + Lakebase agent memory), Control (Unity AI Gateway) | Orchestrates the agent components below |
| `genie` | AI/BI Genie Agent (Genie Spaces) | Yes | Conversational analytics agent: natural-language Q&A turned into governed SQL over the lakehouse; "trusted answers" (verified SQL) keep domain answers accurate; embed in spaces, dashboards, or via API | Queries via `sql-warehouse` |
| `ml-training-serving` | ML Training & Serving | Yes | MLflow tracking + UC registry + batch scoring + real-time Model Serving. One capability, full lifecycle | Trains on data from `sdp`; batch/endpoint consumed by dashboards, apps, agents |
| `vector-search` | Vector Search | Yes | Managed embeddings + similarity search. Manual setup for custom RAG | Indexes docs from UC Volumes |
| `knowledge-assistant` | Knowledge Assistant | Yes | Fully managed RAG — point at docs, get Q&A. Answers the WHY with citations | Reads docs from UC Volumes; orchestrated by a `supervisor-agent` |
| `information-extraction` | Information Extraction | Yes | Document-to-table agent: extract structured data from PDFs, images, text (`ai_parse_document`/`ai_extract`) | Reads docs from UC Volumes; outputs to tables; orchestrated by a `supervisor-agent` |
| `supervisor-agent` | Supervisor Agent | Yes | Orchestrates multiple agents into one interface. Routes to the right agent (KA, Genie, custom model, AI functions, MCP…) | Routes to `genie`, `knowledge-assistant`, `ml-training-serving`, custom models, AI functions, MCP tools |
| `genie-zeroops` | Genie ZeroOps | No | Autonomous background agent on production data + AI: detect → assess (UC-lineage root-cause) → remediate (uses your GitHub PRs / Jira) → verify (zero-copy sandbox clone). Human approval required | Watches `sdp`, ML, serving in production |
| `omnigent` | Managed Omnigent | No | Open-source (Apache-2.0) meta-harness above your agents — combine/control/share Claude Code, Codex, Pi & custom agents through one interface (swap harnesses with one-line changes; stateful cost/security policies; share live sessions by URL) | Orchestrates agent harnesses |
| `ai-gateway` | Unity AI Gateway | No | Access and govern all the main models (Anthropic, OpenAI, Gemini, Grok and OSS), agents, MCP services and skills in one layer: unified AI spend + hard spend caps, smart quality/cost routing, end-to-end agent tracing | Governs all serving endpoints + agents |
| **Apps — Ship internal tools + agentic apps powered by the lakehouse** |||||
| `lakebase` | Lakebase | Yes | Serverless Postgres for operational workloads + the agent system of record of choice. OLTP workloads, low latency, high throughput. Instant stop/start, git-style database branching, instant backup & restore | Syncs with `sdp` tables, powers apps + agent memory |
| `databricks-apps` | Databricks Apps | Yes | Serverless app runtime (Streamlit, Gradio, Dash, React). SSO + UC governance | Leverages `lakebase`, `ml-training-serving`, `supervisor-agent` |
| `app-builder` | App Builder | No | The no/low-code experience for building Databricks Apps faster | Produces `databricks-apps` |
| `lakewatch` | LakeWatch | No | Agentic SIEM on the lakehouse — unifies security/IT/business telemetry (open OCSF schema) in one governed environment; security agents automate rule authoring/normalization/triage; sub-second detection | Consumes governed telemetry |
| `customer-lake` | CustomerLake | No | Agentic CDP embedded in Databricks — Profile Agents build Customer-360 "Golden Context", Campaign Agents run always-on "Infinity Campaigns"; governed by Unity Catalog | Built on the lakehouse |
| **Orchestration — Run everything in production with reliability** |||||
| `lakeflow-jobs` | Lakeflow Jobs | Yes | Native orchestrator: multi-task workflows, retries, file/table triggers, cost controls | Orchestrates `sdp`, `notebooks-eda`, `ml-training-serving` jobs |
| **Governance — Unity Catalog governs ALL components** |||||
| `unity-catalog` | Unity Catalog | No | Unified governance for the agentic era — permissions, lineage, audit across clouds, now governing models, agents & MCP too (Glossary, Domains, Metrics, ABAC/RBAC, external lineage) | Governs all capabilities |
| `genie-ontology` | Genie Ontology | No | Continuous-learning business semantic layer (fiscal calendars, org structure, metric defs, synonyms, decision rationale) — one shared source of meaning for every agent / Genie Space. The Context pillar of Agent Bricks, grounded in Unity Catalog | Grounds every agent + Genie |
| `data-quality` | Data Quality Monitoring | Yes | Lakehouse Monitoring: auto-detect freshness/completeness anomalies, profile tables | Monitors tables in UC schemas |
| `abac` | ABAC | Yes | Attribute-based access: tag-based policies, row filters, column masks | Controls access based on tags |
| `data-classification` | Data Classification | Yes | Auto-tag sensitive data (PII, PHI, financial) | Tags columns in `unity-catalog` |

**Note:** Knowledge Assistant is the managed RAG path (no vector search setup). Vector Search is for custom RAG with control over chunking/retrieval. **Agent Bricks** is the umbrella over Knowledge Assistant + Supervisor Agent + the other agent building blocks — use it when you want to talk about the managed agent platform as a whole.

---

## Default Demo Combination

**Buildable:** `synthetic-data-gen`, `sdp`, `aibi-dashboards`, `genie`

**Talking track:** `lakeflow-connect`, `unity-catalog`, `genie-one` (Genie One), `genie-code` (should be almost always there)

Data flows from external systems (Lakeflow Connect) through SDP transformation, visualized in Dashboards, explored via the AI/BI Genie Agent — all governed by Unity Catalog, with **Genie One** (`genie-one`) as the business-user entry point and Genie Code assisting development. Add `knowledge-assistant` + `supervisor-agent` only when the story explicitly needs unstructured-doc lookup or multi-agent routing.

---

## Example Capability Selections

All demos need `synthetic-data-gen` to create realistic fake data.

**Customer 360 demo** (generic, use defaults — add KA + supervisor-agent only when the story actually needs unstructured-doc lookup or multi-agent routing):
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `aibi-dashboards`, `genie`, `unity-catalog`, `genie-one`, `genie-code`

**IoT sensor streaming demo**:
`synthetic-data-gen`, `lakeflow-connect`, `zerobus-ingest` (real-time push), `sdp`, `aibi-dashboards`, `genie`, `unity-catalog`, `genie-code`

**Fraud detection with app**:
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `aibi-dashboards`, `genie`, `knowledge-assistant`, `supervisor-agent`, `ml-training-serving` (real-time scoring via endpoint), `databricks-apps`, `lakebase`, `unity-catalog`, `genie-code`

**Document processing pipeline**:
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `information-extraction`, `aibi-dashboards`, `knowledge-assistant`, `supervisor-agent`, `genie-one`, `unity-catalog`, `genie-code`

**ML-powered recommendations**:
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `ml-training-serving`, `aibi-dashboards`, `genie`, `unity-catalog`, `genie-one`, `genie-code`

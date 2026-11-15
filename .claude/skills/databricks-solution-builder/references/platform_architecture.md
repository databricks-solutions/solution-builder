# Databricks Capability Catalog: How the Products Work Together

This reference lists ALL Databricks capabilities, grouped by the job they do, and shows how they connect. Most demos use a subset — pick what fits your story.

**Buildable**: "Yes" = we create actual resources (dashboards, pipelines, etc.). "No" = talking point in the demo narrative.

**Diagram component**: the component id used by the architecture diagram (the `CATALOG` in the app's `platform-architecture.ts`). Blank = no diagram tile exists for that capability.

## All Capabilities

| ID | Product | Buildable | What It Does | Relationship | Diagram component |
|----|---------|-----------|--------------|--------------|-------------------|
| **Ingest — get data into the lakehouse (governed by Unity Catalog)** ||||||
| `synthetic-data-gen` | Synthetic Data Generation | Yes | Generate realistic fake data for synthetic demos (no real data to build on). Simulates what real connectors would ingest | Feeds `sdp` with demo data | |
| `lakeflow-connect` | Lakeflow Connect | No | A few-click interface to connect and ingest data from 100+ sources — SaaS apps, DBs, files & knowledge mgmt (Salesforce, Workday, SAP, Jira, GitHub, Confluence, SharePoint…) | Pulls from external systems | `lakeflow-connect` |
| `zerobus-ingest` | Lakeflow Zerobus | No | Push-based API (gRPC/REST/OTLP) for near-real-time ingestion direct to Delta tables — <5s latency, up to 10GB/s per table; Real-Time Mode down to ~5ms | Receives pushes from apps/devices | `zerobus-ingest` |
| `delta-sharing` | Delta Sharing | No | Zero-copy sharing of live data from partners, consortiums, other orgs | Shares from external Databricks workspaces | `delta-sharing` |
| `marketplace` | Databricks Marketplace | No | Subscribe to third-party datasets, AI models, solution accelerators, and native partner Apps | Subscribes to marketplace providers | `marketplace` |
| **Processing — transform raw data into analytics-ready tables** ||||||
| `lakeflow-designer` | Lakeflow Designer | No | Drag-and-drop, no-code ETL on Lakeflow Spark Declarative Pipelines, with zero translation loss; pairs with Genie Code | Visual front-end to `sdp` | |
| `sdp` | Lakeflow Spark Declarative Pipelines (SDP) | Yes | Declarative ETL: Bronze → Silver → Gold. Streaming + batch, auto-optimization, Auto Loader for incremental cloud-storage ingestion; **Real-Time Mode** for millisecond latency | Consumes from ingestion | `sdp` |
| **Compute — infrastructure that runs workloads** ||||||
| `serverless-compute` | Serverless Compute | No | On-demand compute for notebooks, ML training. No cluster management | Powers `sdp`, `ml-training-serving`, notebooks | |
| `sql-warehouse` | Lakehouse (SQL Warehouse) | No | Serverless SQL compute (Photon) for BI + ad-hoc SQL over governed lakehouse tables. Databricks now surfaces this as the "Lakehouse" in the product UI (the compute behind dashboards + Genie) | Powers `ai-bi-dashboard`, `genie` | `sql-lakehouse` |
| `lakehouse-rt` | Lakehouse Real Time (SQL Warehouse on Reyden) | No | The real-time SQL Warehouse, powered by the **Reyden** engine: millisecond queries (sub-100ms at ~12,000 q/s) directly on Delta/Iceberg — no separate serving layer, no data movement | Real-time serving for `ai-bi-dashboard`, apps, agents | `sql-lakehouse` |
| `classic-compute` | Classic Compute | No | Traditional clusters with manual sizing. Legacy — prefer `serverless-compute` | Legacy alternative | |
| **Analytics & BI — query, visualize, and ask questions of governed data** ||||||
| `metric-views` | Metric Views | Yes | The governed semantic / metrics layer: define KPIs once with richer semantic modeling, multi-fact relationships, and materialization — used everywhere | Sits on Silver/Gold tables from `sdp`; used by `ai-bi-dashboard` + Genie; created via SQL on a `sql-warehouse`, saved in a notebook | |
| `ai-bi-dashboard` | AI/BI Dashboards | Yes | Interactive visualizations. The "5-second test" — anomaly obvious at a glance | Visualizes queries via `sql-warehouse` | `ai-bi-dashboard` |
| `genie` | Genie Agent (formerly Genie Spaces) | Yes | Conversational analytics agent: natural-language Q&A turned into governed SQL over the lakehouse; "trusted answers" (verified SQL) keep domain answers accurate; embed in spaces, dashboards, or via API. Agent mode also answers from PDFs in an attached UC volume | Queries via `sql-warehouse`; reads documents from `unstructured-documents` volumes | `genie` |
| `genie-one` | Genie One | No | The enterprise AI coworker: business teams ask in natural language, get governed answers, and trigger actions across 50+ tools (Slack/Teams/Jira/email…). Grounded in Genie Ontology + Unity Catalog access controls; a mobile app and a simplified interface for business users to access their data knowledge | Front door for business consumers | `genie-one` |
| `genie-code` | Genie Code | No | A copilot that lets anyone — including non-technical business or analyst users — build data pipelines, dashboards, apps and more directly on Databricks: describe what you want, Genie Code builds it for you | Builds across all surfaces | `genie-code` |
| `notebooks-eda` | Notebooks & EDA | No | Interactive data exploration, profiling, visualization. Multi-language | Explores data from `sdp` | `notebooks-eda` |
| **AI & agents — Agent Bricks, ML, vector search, and document AI** ||||||
| `agent-bricks` | Agent Bricks | No | The umbrella managed agent platform (AI agents, models, document understanding). Choice (any model), Context (Genie Ontology + agentic search + Lakebase agent memory), Control (Unity AI Gateway) | Orchestrates the agent components below | |
| `omnigent` | Managed Omnigent | No | Open-source (Apache-2.0) meta-harness above your agents — combine/control/share Claude Code, Codex, Pi & custom agents through one interface (swap harnesses with one-line changes; stateful cost/security policies; share live sessions by URL) | Orchestrates agent harnesses | |
| `ml-training-serving` | ML Training & Serving | Yes | MLflow tracking + UC registry + batch scoring + real-time Model Serving. One capability, full lifecycle | Trains on data from `sdp`; batch/endpoint consumed by dashboards, apps, agents | `ml-training-serving` |
| `vector-search` | Vector Search | Yes | Managed embeddings + similarity search. Manual setup for custom RAG | Indexes docs from UC Volumes | `vector-search` |
| `ai-functions` | AI Functions | No | SQL-native AI (`ai_classify`, `ai_extract`, `ai_parse_document`, `ai_summarize`) for enriching data + document intelligence | Enriches tables within `sdp` or `notebooks-eda`; the engine under `document-parsing` (`ai_parse_document`), `information-extraction` (`ai_extract`), and `text-classification` (`ai_classify`) | |
| `unstructured-documents` | Unstructured documents (PDF) | Yes | Policies, procedures, manuals, and incident reports that the Genie agent answers from, with citations. PDFs live in a dedicated UC volume attached to the agent. Answers the WHY behind the numbers | Attached to `genie`; reads docs from UC Volumes | `uc-volume` |
| `document-parsing` | Document Parsing | Yes | Extract structured content from documents — text, tables, and metadata. Uses `ai_parse_document` under the hood (an `ai-functions` agent) | Reads docs from UC Volumes; outputs structured content; pairs with `information-extraction` | `document-parsing` |
| `information-extraction` | Information Extraction | Yes | Pull specific data points, entities, and fields from unstructured text. Uses `ai_extract` under the hood (an `ai-functions` agent) | Reads parsed/unstructured text; outputs to tables; queried by `genie` | `information-extraction` |
| `text-classification` | Text Classification | Yes | Categorize text into predefined or dynamic labels. Uses `ai_classify` under the hood (an `ai-functions` agent) | Classifies records/documents; outputs labels to tables; queried by `genie` | `text-classification` |
| **Apps — ship internal tools + agentic apps powered by the lakehouse** ||||||
| `lakebase` | Lakebase | Yes | Serverless Postgres for operational workloads + the agent system of record of choice. OLTP workloads, low latency, high throughput. Instant stop/start, git-style database branching, instant backup & restore | Syncs with `sdp` tables, powers apps + agent memory | `lakebase` |
| `databricks-apps` | Databricks Apps | Yes | Serverless app runtime (Streamlit, Gradio, Dash, React). SSO + UC governance | Leverages `lakebase`, `ml-training-serving`, `genie` | `databricks-apps-work` (legacy tile: `databricks-apps`) |
| `app-builder` | App Builder | No | The no/low-code experience for building Databricks Apps faster | Produces `databricks-apps` | |
| `customer-lake` | CustomerLake | No | Agentic CDP embedded in Databricks — Profile Agents build Customer-360 "Golden Context", Campaign Agents run always-on "Infinity Campaigns"; governed by Unity Catalog | Built on the lakehouse | `customerlake` |
| **Orchestration — run everything in production with reliability** ||||||
| `lakeflow-jobs` | Lakeflow Jobs | Yes | Native orchestrator: multi-task workflows, retries, file/table triggers, cost controls | Orchestrates `sdp`, `notebooks-eda`, `ml-training-serving` jobs | `lakeflow-jobs` |
| `genie-zeroops` | Genie ZeroOps | No | Autonomous background agent on production data + AI: detect → assess (UC-lineage root-cause) → remediate (uses your GitHub PRs / Jira) → verify (zero-copy sandbox clone). Human approval required | Watches `sdp`, ML, serving in production | |
| **Governance & security — Unity Catalog governs ALL components** ||||||
| `unity-catalog` | Unity Catalog | No | Unified governance for the agentic era — permissions, lineage, audit across clouds, now governing models, agents & MCP too (Glossary, Domains, Metrics, ABAC/RBAC, external lineage) | Governs all capabilities | `unity-catalog` |
| `genie-ontology` | Genie Ontology | No | Continuous-learning business semantic layer (fiscal calendars, org structure, metric defs, synonyms, decision rationale) — one shared source of meaning for every agent / Genie Agent. The Context pillar of Agent Bricks, grounded in Unity Catalog | Grounds every agent + Genie | `governance-block` |
| `ai-gateway` | Unity AI Gateway | No | Access and govern all the main models (Anthropic, OpenAI, Gemini, Grok and OSS), agents, MCP services and skills in one layer: unified AI spend + hard spend caps, smart quality/cost routing, end-to-end agent tracing | Governs all serving endpoints + agents | `ai-gateway` |
| `data-quality` | Data Quality Monitoring | Yes | Lakehouse Monitoring: auto-detect freshness/completeness anomalies, profile tables | Monitors tables in UC schemas | `data-quality` |
| `abac` | ABAC | Yes | Attribute-based access: tag-based policies, row filters, column masks | Controls access based on tags | `abac` |
| `data-classification` | Data Classification | Yes | Auto-tag sensitive data (PII, PHI, financial) | Tags columns in `unity-catalog` | `data-classification` |
| `lakewatch` | LakeWatch | No | Agentic SIEM on the lakehouse — unifies security/IT/business telemetry (open OCSF schema) in one governed environment; security agents automate rule authoring/normalization/triage; sub-second detection | Ingests high-volume security/telemetry logs (identity, endpoint, network) into UC-governed tables; feeds SOC detection + threat hunting | `lakewatch` |

**Note:** `unstructured-documents` is the document path (no vector search setup): PDFs in a managed UC volume attached to a Genie agent. Vector Search is for custom RAG with control over chunking/retrieval. Knowledge Assistant and Supervisor Agent are deprecated and must not be created for new demos.

---

## Default Demo Combination

A synthetic demo (built on generated data) defaults to:

**Buildable:** `synthetic-data-gen`, `sdp`, `ai-bi-dashboard`, `genie`

**Talking track:** `lakeflow-connect`, `unity-catalog`, `genie-one` (Genie One), `genie-code` (include in almost every demo)

Data flows from external systems (Lakeflow Connect) through SDP transformation, visualized in Dashboards, explored via the AI/BI Genie Agent — all governed by Unity Catalog, with **Genie One** (`genie-one`) as the business-user entry point and Genie Code assisting development. Add `unstructured-documents` only when the story explicitly needs document lookup (policies, manuals, incident reports) next to the data.

A grounded demo (built on the user's real tables) does not use this default: it drops `synthetic-data-gen`, the ingest capabilities, and `sdp`, and builds read-only on the real tables instead (see `stages/03.1r-build-on-real.md`).

---

## Example Capability Selections

Synthetic demos (no real data to build on) use `synthetic-data-gen` to create realistic fake data. Grounded demos (built on the user's real tables) do NOT use `synthetic-data-gen`: they build read-only on the real tables instead of generating or copying data (see `stages/03.1r-build-on-real.md`). The examples below are synthetic demos.

**Customer 360 demo** (generic, use defaults — add `unstructured-documents` only when the story actually needs document lookup):
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `ai-bi-dashboard`, `genie`, `unity-catalog`, `genie-one`, `genie-code`

**IoT sensor streaming demo**:
`synthetic-data-gen`, `lakeflow-connect`, `zerobus-ingest` (real-time push), `sdp`, `ai-bi-dashboard`, `genie`, `unity-catalog`, `genie-code`

**Fraud detection with app**:
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `ai-bi-dashboard`, `genie`, `unstructured-documents`, `ml-training-serving` (real-time scoring via endpoint), `databricks-apps`, `lakebase`, `unity-catalog`, `genie-code`

**Document processing pipeline**:
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `information-extraction`, `ai-bi-dashboard`, `genie`, `unstructured-documents`, `genie-one`, `unity-catalog`, `genie-code`

**ML-powered recommendations**:
`synthetic-data-gen`, `lakeflow-connect`, `sdp`, `ml-training-serving`, `ai-bi-dashboard`, `genie`, `unity-catalog`, `genie-one`, `genie-code`

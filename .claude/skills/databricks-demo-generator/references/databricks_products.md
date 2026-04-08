# Databricks Product Reference

Use this to decide **which products to combine in a demo**, what pain each solves, and how to position them.

---

## Default Demo Stack

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Lakeflow   │ →  │     SDP     │ →  │   DW/SQL    │ →  │   Genie     │ →  │   Agents    │ →  │    Apps     │
│   Connect   │    │  Pipelines  │    │  Dashboard  │    │   AI/BI     │    │   MAS/KA    │    │  Lakebase   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
   Ingestion        Processing         Analytics          NL Queries         AI Agents         Delivery
```

**Unity Catalog** underpins governance across the whole stack.

---

## Data Processing

### Lakeflow Connect

Fully managed **connectors + pipelines** from SaaS apps, DBs and files into governed lakehouse tables.

**Pain:** New source = new bespoke pipeline, custom scripts, separate ingestion tool, manual monitoring. Data engineering time vanishes into plumbing. Business users wait weeks for "just get me Salesforce into the warehouse."

**Key features:**
- **200+ connectors** - Salesforce, Workday, SAP, ServiceNow, databases, files
- **Incremental sync** - CDC, change tracking, efficient updates
- **Schema inference** - auto-detect and evolve schemas
- **Error recovery** - automatic retries, dead-letter handling

**Position:** Any "can you pull from Salesforce / Workday / SQL Server / GA4 / ServiceNow?" moment. Great opener for Day 0: click-to-ingest → data appears in UC → pipeline auto-runs.

**URL:** https://www.databricks.com/product/data-engineering/lakeflow-connect

---

### Spark Declarative Pipelines (SDP)

**Declarative ETL** for batch + streaming: describe the tables you want, it figures out execution, scheduling, retries and data quality.

**Pain:** Hand-rolled Spark/SQL jobs are snowflakes: each has its own orchestration, error handling, incremental logic. One bad schema change breaks 20 downstream jobs. Nobody wants to touch legacy pipelines. "Only three people understand our ETL."

**Key features:**
- **Streaming tables** - real-time ingestion with exactly-once semantics
- **Materialized views** - auto-refreshed aggregations
- **Data quality expectations** - built-in validation, quarantine bad records
- **Auto-optimization** - partitioning, compaction, indexing handled
- **Pipeline observability** - data flow visualization, metrics, alerts

**Position:** Operational analytics, near-real-time scenarios (fraud, risk monitoring, IoT). Anytime they complain about "pipeline sprawl."

**URL:** https://www.databricks.com/product/data-engineering/spark-declarative-pipelines

---

### Lakeflow Jobs

Native **orchestrator** for all Databricks workloads with retries, conditional logic and deep observability.

**Pain:** Airflow + cron + ad-hoc scripts = no single view of what's running, what failed, what's late and what it breaks. Debugging a failed daily batch means grepping logs across three tools and guessing dependencies.

**Key features:**
- **Multi-task workflows** - notebooks, SQL, pipelines, ML in one DAG
- **Control flow** - branching, loops, conditional execution
- **File/table triggers** - start jobs on data arrival
- **Repair and retry** - partial reruns, automatic recovery
- **Cost controls** - budgets, timeouts, cluster policies

**Position:** Closing the loop: "Here's how you run this in production every 5 minutes, with alerts and cost control."

**URL:** https://www.databricks.com/product/data-engineering/lakeflow-jobs

---

## AI/BI

### AI/BI Dashboards

**AI-assisted dashboards** on governed data - build and share interactive views without extra BI tooling or per-seat fees.

**Pain:** Adding "one more cut" of a metric means a Jira ticket to BI team and 2-3 week wait. By the time the dashboard lands, the window to act is gone. BI licenses are rationed; many users only see screenshots.

**Key features:**
- **No per-seat licensing** - everyone on Databricks can view/build
- **AI-assisted creation** - describe what you want, get a chart
- **Live on lakehouse** - always fresh, governed data
- **Embedded Genie** - drill down with natural language

**Position:** Start with 5-second test: show dashboard where anomaly is obvious at a glance. "We replaced separate BI licenses; everyone can see and build dashboards."

**URL:** https://www.databricks.com/product/business-intelligence

---

### AI/BI Genie

**GenAI BI analyst**: business users ask questions in natural language, Genie answers from governed data and metrics.

**Pain:** A VP's "simple question" ("Which segment is driving this spike?") triggers tickets → backlog → weeks of delay → opportunity lost. Analysts become helpdesk. Backlog of tiny asks never gets done. Business users stop asking and steer by gut.

**Key features:**
- **Natural language queries** - no SQL required
- **Governed answers** - uses UC metrics and definitions
- **Visualizations** - auto-generates charts and tables
- **Conversation memory** - follow-up questions in context
- **Trusted data** - cites sources, shows SQL generated

**Position:** *"Today, to get this view you'd open a ticket and wait weeks. With Genie, you type the question and get an answer in seconds."* FSI: RMs exploring client portfolios, risk exposures live.

**URL:** https://www.databricks.com/product/business-intelligence/genie

---

### Metric Views

**Centralized semantic layer** for defining metrics once and using them consistently across dashboards, Genie, alerts and external BI tools.

**Pain:** "Revenue" means different things to different teams. Marketing calculates it one way, Finance another, and the CEO dashboard shows a third number. Every new report triggers debates about "which number is right." Complex metrics like ratios or distinct counts break when re-aggregated. Teams create dozens of pre-baked views for every possible slice, yet still can't answer ad-hoc questions.

**Key features:**
- **Define once, use everywhere** - single source of truth for business metrics
- **Flexible dimensions** - query any metric across any dimension at runtime
- **Complex calculations** - ratios, distinct counts, time-over-time that aggregate correctly
- **Auto-materialization** - pre-compute and incrementally update aggregations for performance
- **UC governed** - metrics inherit permissions, show in lineage, are auditable

**Position:** When consistency matters: "Your Genie answers and dashboards all draw from the same metric definitions - no more spreadsheet reconciliation." FSI: regulatory metrics that must match across reports. Retail: consistent revenue/margin definitions across regions.

**URL:** https://docs.databricks.com/en/metric-views/

---

### Databricks SQL

**Serverless data warehouse** on the lakehouse with AI-assisted SQL and best-in-class price/performance.

**Pain:** Legacy DWHs choke on semi-structured, streaming and AI workloads, and charge heavily for compute and storage. Analysts pull data into "side systems" for ML or GenAI, fragmenting definitions and governance.

**Key features:**
- **Serverless** - instant startup, auto-scaling, pay per query
- **Photon engine** - vectorized execution, 10-50x faster
- **AI-assisted SQL** - natural language to SQL in editor
- **BI integrations** - native connectors for Tableau, Power BI, Looker
- **Query federation** - query external sources without moving data

**Position:** BI, reporting, self-service analytics. Especially when they mention Snowflake/Redshift/Synapse. Show fast queries over open tables.

**URL:** https://www.databricks.com/product/databricks-sql

---

## ML

### Notebooks + Managed MLflow

**EDA + experiment + lifecycle workbench**: collaborative notebooks plus MLflow tracking, registry and deployment.

**Pain:** EDA happens in local notebooks, BI tools, ad-hoc scripts - no consistent lineage or reproducibility. Model experiments tracked in spreadsheets and filenames. Nobody can say which run is in prod or how it was trained.

**Key features:**
- **Collaborative notebooks** - real-time co-editing, version control
- **Experiment tracking** - parameters, metrics, artifacts logged automatically
- **Model registry** - staging, production, archived with approvals
- **Lineage** - trace model back to training data and code
- **One-click deployment** - notebook to serving endpoint

**Position:** "How do your data scientists actually work?" - import data, EDA in notebook, log runs, compare, register best model, deploy. FSI: stress reproducibility + auditability for risk/churn/fraud models.

**URL:** https://www.databricks.com/product/managed-mlflow

---

### Genie Code

Autonomous **AI pair-engineer** for data teams: plans, writes and runs code, fixes errors, maintains notebooks and pipelines.

**Pain:** Experts spend huge time on boilerplate: discovering tables, writing the 20th "join + aggregate", debugging Spark errors, wiring ETL → ML → dashboards. New joiners take months to be productive. Seniors become permanent bottlenecks.

**Key features:**
- **Agentic execution** - plans multi-step workflows, runs them
- **Code generation** - Spark, SQL, Python from natural language
- **Error fixing** - diagnoses and repairs failures automatically
- **Context-aware** - understands your catalog, schemas, code

**Position:** Single prompt → full workflow: "Do EDA on @transactions, build a churn model, log to MLflow, create summary notebook." Watch it generate, run, iterate. "This is how we make your whole team 2-3x faster."

**URL:** https://www.databricks.com/product/genie-code

---

## AI/GenAI

### Model Serving

**Serverless endpoints** for any model - foundation models, fine-tuned models, or custom agents - with pay-per-token pricing.

**Pain:** Self-hosting LLMs means GPU procurement, infra ops, scaling headaches, and no cost visibility. Teams spin up separate endpoints for each model, each with its own auth and logging.

**Key features:**
- **Serverless** - instant startup, auto-scaling, no GPU management
- **Pay-per-token** - cost transparency, no idle spend
- **Any model** - foundation models, fine-tuned, external via AI Gateway
- **Guardrails** - input/output filtering, PII detection
- **Tracing** - full observability of every call

**Position:** "Host any model with one click, pay only for what you use, and see every call in traces." Foundation for all agent/RAG work.

**URL:** https://www.databricks.com/product/model-serving

---

### Vector Search

**Managed embeddings + similarity search** for RAG applications, fully integrated with Unity Catalog.

**Pain:** DIY vector DBs mean separate infra, syncing nightmares when source data changes, and no governance. Embeddings drift out of sync with tables, and nobody knows which version is live.

**Key features:**
- **Managed index** - auto-sync with Delta tables
- **Incremental updates** - embeddings stay fresh as data changes
- **UC governed** - same permissions as source tables
- **Hybrid search** - combine semantic + keyword for better recall
- **Scale** - billions of vectors, low-latency queries

**Position:** Any RAG / copilot scenario. "Your knowledge base stays in sync automatically - no ETL to vector DB. Governed by the same UC permissions as your tables."

**URL:** https://www.databricks.com/product/vector-search

---

### Knowledge Assistant

**Fully managed RAG agent** that turns your documents into accurate, grounded answers with page-level citations.

**Pain:** Building RAG from scratch means chunking strategies, embedding pipelines, retrieval tuning, prompt engineering - months of work before you know if it even helps. Basic similarity search misses context, gives wrong answers, or hallucinates.

**Key features:**
- **Instructed Retriever** - 70% higher answer quality than basic RAG
- **Page-level citations** - every answer cites its source, reducing hallucinations
- **Supported formats** - PDF, DOCX, PPTX, MD, TXT from UC Volumes
- **Natural language feedback** - improve quality by telling it what's wrong
- **Managed lifecycle** - ingestion, updates, retrieval, inference all handled

**Position:** "Point it at your policy docs, product manuals, or research papers - get a Q&A bot in minutes, not months." FSI: compliance docs, policy search. Healthcare: clinical guidelines. Legal: contract analysis.

**URL:** https://docs.databricks.com/en/generative-ai/agent-bricks/knowledge-assistant

---

### Supervisor Agent

**Managed orchestration layer** that coordinates multiple agents - Genie Spaces, Knowledge Assistants, UC functions, and MCP servers - to handle complex tasks.

**Pain:** Real business questions span structured and unstructured data: "What's our exposure to this client and what do our contracts say about it?" Single agents can't handle this. DIY orchestration means building routing logic, managing state, handling failures - and no governance.

**Key features:**
- **Dynamic routing** - analyzes questions, picks the right agent(s)
- **Multi-agent coordination** - Genie for SQL, KA for docs, functions for actions
- **On-Behalf-Of auth** - uses the human's UC permissions, not a service account
- **MCP integration** - connect external tools and systems
- **Natural language tuning** - improve routing with expert feedback

**Position:** "One agent that knows when to query your data warehouse, when to search your documents, and when to call an external API - all governed by your existing permissions." FSI: RM copilot spanning client data + research + compliance docs.

**URL:** https://docs.databricks.com/en/generative-ai/agent-bricks/multi-agent-supervisor

---

## Governance

### Unity Catalog

**Unified, open governance** for all data, AI models, metrics and dashboards across clouds and formats.

**Pain:** Each warehouse, lake, BI tool and ML platform has its own ACLs and catalog. Answering "who can see this?" or "where did this KPI come from?" takes weeks. Audits (GDPR, SOX, DORA) become multi-month fire drills. Security blocks new use cases because exposure is unclear.

**Key features:**
- **Fine-grained access control** - column/row-level security, dynamic data masking
- **Attribute-based access (ABAC)** - policies based on tags, not just roles
- **Data classification** - automatic tagging of PII, sensitive data
- **Automated lineage** - trace any metric back to source tables and transformations
- **Audit logs** - every access, query, and permission change logged
- **Data quality monitoring** - detect drift, anomalies, freshness issues
- **Cross-cloud federation** - one catalog across AWS, Azure, GCP

**Position:** Any mention of compliance, sensitive data, regulators, cross-cloud, or "we have 5 warehouses." Always show lineage + fine-grained access at least once.

**URL:** https://www.databricks.com/product/unity-catalog

---

### Delta Sharing

Open protocol for **zero-copy sharing** of live data, views, volumes and models across orgs, platforms and clouds.

**Pain:** B2B data exchange today = S3 buckets, SFTP, CSVs, custom APIs. Feeds break, go stale, and once data leaves, governance is gone. Every new partner is a mini-integration project.

**Key features:**
- **Zero-copy** - no data movement, query in place
- **Cross-platform** - works with any Delta/Iceberg client
- **Live data** - always current, no sync lag
- **Governed** - access controls, audit logs preserved
- **Volumes & models** - share files and ML models, not just tables

**Position:** FSI: bureaus, partners, regulators, consortiums. Retail/MFG: supply-chain, joint-venture analytics. "We share this table with a partner → they live-query it in their own tool."

**URL:** https://www.databricks.com/product/delta-sharing

---

## Apps

### Databricks Apps

**Serverless app runtime** on the lakehouse: build secure internal data/AI apps in Python or JS, governed by Unity Catalog and SSO.

**Pain:** Most POCs die as notebooks and dashboards. Turning them into apps means new infra (Kubernetes, API gateways, auth, logging) and a new project with security/IT. Business users never get a "real" tool - just exports and screenshots.

**Key features:**
- **No infra** - serverless, managed runtime
- **Python & JS** - Streamlit, Gradio, Dash, React
- **UC integration** - app inherits data permissions
- **SSO/OAuth** - enterprise auth out of the box
- **Secrets management** - secure credential handling

**Position:** Last 5 minutes of demo: the pipeline/model you just built appears as a real app ("RM Copilot", "Claims Triage App") with auth and governance. "We don't just make insights - we ship internal products."

**URL:** https://www.databricks.com/product/databricks-apps

---

### Lakebase (Databricks Postgres)

Fully managed **Postgres for operational workloads**, integrated with the lakehouse.

**Pain:** Operational DBs live on islands: analytics teams ETL data out, app teams can't leverage analytics/AI, every change creates fragile pipelines. Spinning up new stores for AI agents/apps requires separate ops, security, governance.

**Key features:**
- **Managed Postgres** - familiar API, zero ops
- **Autoscaling** - scale to zero, burst on demand
- **Instant branching** - dev/test environments in seconds
- **Lakehouse sync** - bidirectional with Delta tables
- **UC governed** - same permissions as rest of platform

**Position:** When they need "low-latency transactions / HTAP / agent needs to store state." Show Lakebase powering an app, then same data visible in UC and SQL/AI.

**URL:** https://www.databricks.com/product/lakebase

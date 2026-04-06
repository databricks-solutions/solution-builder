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

## Platform & Governance

### Data Intelligence Platform

Unified platform that turns all your data into an **AI-ready lakehouse** with governance and AI built in.

**Pain:** Data lives in 5-10 systems (DWH, lake, ML platform, BI, point AI tools). Every project means copying data, reconciling schemas, re-implementing security. Slow time-to-value, duplicated spend, "which number is right?" fights.

**Position:** Any "end-to-end data + AI" or platform consolidation story. Open with this when positioning Databricks vs "tool zoo".

**URL:** https://www.databricks.com/product/data-intelligence-platform

---

### Unity Catalog

**Unified, open governance** for all data, AI models, metrics and dashboards across clouds and formats.

**Pain:** Each warehouse, lake, BI tool and ML platform has its own ACLs and catalog. Answering "who can see this?" or "where did this KPI come from?" takes weeks. Audits (GDPR, SOX, DORA) become multi-month fire drills. Security blocks new use cases because exposure is unclear.

**Key features to highlight:**
- **Fine-grained access control** - column/row-level security, dynamic data masking
- **Attribute-based access (ABAC)** - policies based on tags, not just roles
- **Automated lineage** - trace any metric back to source tables and transformations
- **Audit logs** - every access, query, and permission change logged
- **Data quality monitoring** - detect drift, anomalies, freshness issues
- **Cross-cloud federation** - one catalog across AWS, Azure, GCP

**Position:** Any mention of compliance, sensitive data, regulators, cross-cloud, or "we have 5 warehouses." Always show lineage + fine-grained access at least once.

**URL:** https://www.databricks.com/product/unity-catalog

---

## Storage

### Lakehouse Storage (Delta Lake & Iceberg)

Open **ACID tables on cheap cloud storage**, auto-optimized for performance and AI workloads.

**Pain:** Raw object storage is cheap but fragile: schema drift, no ACID, random performance. Traditional warehouses are fast but closed and expensive. Teams end up with separate systems for BI, data science, streaming - all holding copies of the same data.

**Key features:**
- **Liquid clustering** - automatic data layout optimization
- **Predictive optimization** - ML-driven compaction and indexing
- **Time travel** - query any point in history, easy rollback
- **Schema evolution** - add columns without breaking consumers
- **Open format** - Delta + Iceberg, no lock-in

**Position:** Modernization / consolidation stories (Snowflake/Teradata → lakehouse). FSI: long-history trade data, risk simulations. Retail: clickstream + transactions in one place.

**URL:** https://www.databricks.com/product/delta-lake-on-databricks

---

## Ingestion

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

## Processing

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

## Analytics

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

## Workbench & ML

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

## AI / GenAI

### Mosaic AI (Model Serving, Vector Search, Agents)

End-to-end **agent platform**: host any model, add RAG with Vector Search, trace and evaluate agents, govern through Unity Catalog.

**Pain:** DIY GenAI = separate vector DB, model gateway, tracing, evaluators, governance, each with own ACLs and logs. Hard to move from "cool POC" to production because nobody trusts outputs or can explain them to compliance.

**Key features:**
- **Model Serving** - serverless endpoints for any model, pay-per-token
- **Vector Search** - managed embeddings + similarity search for RAG
- **Agent Framework** - build multi-step agents with tools
- **Agent Evaluation** - measure quality, detect hallucinations
- **Tracing** - full observability of agent reasoning
- **Guardrails** - input/output filtering, PII detection

**Position:** Any RAG / copilot / agent request. Show data → Vector Search → agent → evaluation + tracing. FSI: KYC copilots, policy search, claims triage - emphasize evaluation + governance.

**URL:** https://www.databricks.com/product/artificial-intelligence

---

## Apps & Delivery

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

### Marketplace

Open **data & AI marketplace**: subscribe to external datasets, models and notebooks directly into your lakehouse.

**Pain:** Buying external data = S3 drops, custom ingestion, schema wrangling, separate contracts. Most teams under-use purchased data because it's too hard to operationalize.

**Position:** When enriching with market / demographic / alt data strengthens the story. Quick mention: "This dataset could come from Marketplace - one-click subscription, no ETL."

**URL:** https://www.databricks.com/product/marketplace

---

## Security

### Lakewatch

Open, **agentic SIEM** on the lakehouse: ingest all security telemetry, run threat-hunting and automation with AI agents at petabyte scale.

**Pain:** Traditional SIEMs charge by ingest; orgs drop logs to save money and fly blind. Rules-only detection can't keep up with evolving threats. SOCs drown in alert fatigue and manual triage.

**Key features:**
- **Unlimited ingest** - lakehouse economics, no data limits
- **Detection-as-code** - version-controlled, testable rules
- **AI agents** - automated triage, investigation, response
- **Open format** - your data, your lake, full SQL access
- **UC governed** - same security model as rest of platform

**Position:** Security-focused deals, CISO/SOC in the room. "No data limits, open lake, governance via UC, and you fight agents with agents built on your own telemetry."

**URL:** https://www.databricks.com/product/lakewatch

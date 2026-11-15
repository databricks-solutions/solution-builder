# Component catalog and icon bank

Read this when you need a component's type id, default title, ports, wiring or an icon key.


<!-- BEGIN: generated-catalog -->

<!-- AUTO-GENERATED from CATALOG in app/.../lib/platform-architecture.ts
     by `bun run scripts/gen-architecture-skill.ts` — DO NOT EDIT BY HAND. -->

Use the `type` id; the renderer supplies the icon, label, description text and size (size is the SAME in both themes — slide changes only what's drawn inside a node, never its box). **`theme:"slide"` never renders a catalog tile's or source's description** (label + icon do the work on a slide; only `type:"logo"` nodes show `desc` with `showDesc:true`), so a tile `desc` renders only in `theme:"technical"`; override `label`/`desc` only when story-specific. Composite blocks carry their own internal layout — treat each as ONE node (don't also add its sub-parts).

### Agentic Data `agentic-data`

*The data foundation — ingest + the medallion pipeline (bronze→silver→gold) + the lakehouse / Lakebase it lands in. Where the demo's data comes IN and is refined.*

| type | default title | available description (technical; slide hides it) | size | when to use |
|------|---------------|-----------------------------------------|------|-------------|
| `lakeflow-block` | Lakeflow | One block: managed ingest (Lakeflow Connect), real-time streams (Zerobus) and direct file landing, all flowing into a declarative bronze → silver → gold pipeline. | 268×148 | The whole ingest + bronze→silver→gold SDP in one block (no Genie Code framing). Contains SDP — never add a separate sdp tile beside it. OPTIONS (params, all optional strings): `bronze_desc` / `silver_desc` / `gold_desc` — a SHORT caption under that layer's cylinder (e.g. `gold_desc:"Business marts + metrics"`); the block grows to fit. Keep each to a few words. |
| | | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps · `in-zerobus` ← realtime streams / sensors · `in-direct` ← files: PDF / CSV / Parquet · `r` → the compute layer |
| | | | | **wiring:** ingests from `sources (via @in-* ports)` · feeds gold tables to `sql-lakehouse` · syncs gold tables to `lakebase` |
| `lakeflow-genie-block` | Lakeflow + Genie | Lakeflow ingest + declarative pipeline, with Genie Code building and maintaining it — one box, end to end. | 360×208 | The PREFERRED data-layer block — ingest + bronze→silver→gold SDP, built/maintained by Genie Code. It IS the data layer; contains SDP + Genie Code, so never add separate sdp / genie-code tiles beside it. OPTIONS (params, all optional strings): `bronze_desc` / `silver_desc` / `gold_desc` — a SHORT caption under that layer's cylinder; the block grows to fit. Keep each to a few words. |
| | | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps · `in-zerobus` ← realtime streams / sensors · `in-direct` ← files: PDF / CSV / Parquet · `r` → the compute layer |
| | | | | **wiring:** ingests from `sources (via @in-* ports)` · feeds gold tables to `sql-lakehouse` · syncs gold tables to `lakebase` |
| `lakeflow-connect` | Lakeflow Connect | A few-click interface to connect and ingest data from 100+ sources — SaaS apps, databases, files and knowledge systems. | 230×54 |  |
| | | | | **wiring:** ingests from `external connectors / SaaS / DBs` · lands raw tables into `sdp` |
| `zerobus-ingest` | Lakeflow Zerobus | Real-time, direct ingest of streaming events into the lakehouse. | 230×54 |  |
| | | | | **wiring:** receives push from `streaming / live events (apps, devices)` · lands raw tables into `sdp` |
| `sdp` | Lakeflow SDP | Spark Declarative Pipelines — declarative bronze → silver → gold that self-heal and scale. | 230×112 |  |
| | | | | **wiring:** reads ingested data from `lakeflow-connect` · reads streams from `zerobus-ingest` · reads files from (Auto Loader) `uc-volume` · orchestrated by `lakeflow-jobs` *(optional)* |
| `uc-volume` | UC Volume | Governed file storage in Unity Catalog — where raw documents (PDFs) land. | 230×54 |  |
| | | | | **wiring:** stores `files / documents (PDF, CSV, images)` |
| `lakeflow-jobs` | Lakeflow Jobs | The orchestrator for any workflow — ingestion, SDP pipelines, notebooks, SQL queries, ML training/scoring, and deployment — on a schedule or trigger. | 230×54 | The workspace orchestrator. It can run ANY component as a task: data ingestion (Lakeflow Connect, notebooks, SDP), SQL queries, ML training/scoring, and deployment steps — chained with dependencies, on a schedule or trigger. Wire an `orchestrates` edge from Lakeflow Jobs to every step it runs. |
| | | | | **wiring:** orchestrates `sdp` · orchestrates `ml-training-serving` · orchestrates `notebooks-eda` · orchestrates `lakeflow-connect` |
| `notebooks-eda` | Notebooks | Interactive exploration and analysis on governed data. | 230×54 |  |
| | | | | **wiring:** explores tables from `sdp` |
| `delta-sharing` | Delta Sharing | Open, cross-org data sharing with no copies. | 230×54 |  |
| `marketplace` | Marketplace | Discover and consume third-party data and AI assets. | 230×54 |  |
| `lakebase` | Lakebase | Managed Postgres for app state — reads/writes the live queue. | 230×54 |  |
| | | | | **wiring:** syncs with Delta — EITHER reverse-ETL Delta→Postgres, OR live app writes Postgres→Delta for analysis `sdp` · powers state + agent memory for `databricks-apps` |
| `sql-lakehouse` | Lakehouse | One copy of governed data for BI + AI — real-time queries at scale (SQL Warehouse; RT = Lakehouse Real Time). | 230×54 |  |
| | | | | **wiring:** queries gold tables from `sdp` · serves queries to `ai-bi-dashboard` · serves queries to `genie` |

### Agentic Work `agentic-work`

*The intelligence layer — models, agents, RAG, ML lifecycle, and the entry points (Genie, Genie One) that answer questions and act on the governed data.*

| type | default title | available description (technical; slide hides it) | size | when to use |
|------|---------------|-----------------------------------------|------|-------------|
| `databricks-apps-work` | Databricks Apps | Deploy business apps | 230×54 | The custom business app — PREFERRED over the legacy databricks-apps tile. Runs on Lakebase; can embed the dashboard + Genie Agent. |
| | | | | **wiring:** reads/writes app state from `lakebase` · calls (Genie Agent: data + documents) `genie` *(optional)* · calls `model-serving` *(optional)* · model calls governed by `ai-gateway` *(optional)* |
| `genie-one` | Genie One | The enterprise AI coworker — the simplified Databricks front door where business users reach dashboards, Genie, and apps without technical expertise (formerly Databricks One). | 230×78 | The business-user entry point / front door. It has a Business-users persona built IN (a small user icon docked above the Genie One mark) — so you do NOT need a separate file:persona/user node beside it. Wire Genie One --> dashboard / Genie Agent / app (auto-arrows; leave `arrow` out). |
| | | | | **wiring:** fronts / opens `databricks-apps-work` · fronts / opens `genie` · fronts / opens `ai-bi-dashboard` · fronts / opens `lakewatch` *(optional)* · fronts / opens `customerlake` *(optional)* |
| `genie` | Genie Agent | ask anything about your data and your documents | 230×54 | The ONE agent for questions over structured data AND documents. Attach the governed tables (SQL answers) and, for PDFs / DOCX / PPTX, a dedicated MANAGED UC volume (document answers, cited to the file). It replaces Knowledge Assistant and Supervisor Agent for document Q&A and for routing between data and documents. Draw `src-pdf` → `uc-volume` → `genie` (edge label 'content search') when documents are in the story; an app or Genie One sits in front of it. |
| | | | | **wiring:** runs governed SQL over `sql-lakehouse` · answers document questions from (content search) `uc-volume` *(optional)* · grounded in (semantics) `genie-ontology` *(optional)* |
| `ml-training-serving` | ML Models | Train, register, and serve models on governed data. | 230×54 | Two consumption patterns, same model: BATCH — score over Delta → a gold predictions table that dashboards/Genie/apps read (simplest, a good default); REAL-TIME endpoint when per-request scoring fits the story (fraud at auth, rec at page-load). Lean batch unless the demo needs live scoring. |
| | | | | **wiring:** trains on gold features from `sdp` · trains on features from `feature-store` · batch predictions written back to a gold table of (default path) `sdp` · real-time endpoint called by `databricks-apps-work` *(optional)* |
| `ml-model` | Machine Learning Model | A trained model on governed data — classification, forecasting, recommendations, and more. | 230×54 |  |
| | | | | **wiring:** trains on gold features from `sdp` |
| `model-training` | Model Training | Train + track experiments with MLflow — parameters, metrics, and artifacts, all governed. | 230×54 |  |
| | | | | **wiring:** trains on gold features from `sdp` · trains on features from `feature-store` · registers trained model to `uc-model-registry` · feedback loop from `model-serving` |
| `mlops` | MLOps | The full model lifecycle — train, evaluate, register, deploy, and monitor, governed end to end. | 230×54 |  |
| `bronze-layer` | Bronze | Raw ingested data, landed as-is. | 230×54 |  |
| `silver-layer` | Silver | Cleaned, conformed, deduplicated. | 230×54 |  |
| `gold-layer` | Gold | Curated, business-ready aggregates. | 230×54 |  |
| `medallion-table` | Medallion Table | Bronze → Silver → Gold in one block — the medallion refinement of a governed table. | 268×96 | The whole medallion (bronze → silver → gold) as ONE block, with the metal-toned layer marks and an internal flow. Prefer this over three separate bronze/silver/gold tiles when you just want to show the layered data itself. OPTIONS (params): `feature_store` and `metric_views` (booleans) — each adds a fork off the GOLD layer (Feature Store above, Metric Views below) shown inside the block, and exposes an extra right-side OUTPUT handle so you can wire it: `@out-gold` (always), `@out-fs` (when feature_store), `@out-mv` (when metric_views). Also `bronze_desc` / `silver_desc` / `gold_desc` (optional strings) — a SHORT caption under each layer (e.g. `gold_desc:"Business marts + metrics"`); the block grows to fit. Keep each to a few words. |
| | | | | **ports:** `l` ← sources / ingest · `out-gold` → gold output · `out-fs` → feature store (when enabled) · `out-mv` → metric views (when enabled) |
| | | | | **wiring:** reads raw data from `sources / ingest (@l)` · gold consumed by (@out-gold) `sql-lakehouse` · gold trains model (@out-gold / @out-fs) `model-serving` |
| `feature-store` | Feature Store | Governed, reusable features for training and real-time serving — consistent offline and online. | 230×54 |  |
| | | | | **wiring:** computes features from gold tables of `sdp` |
| `uc-model-registry` | UC Model Registry | Version, stage, and govern models in Unity Catalog with full lineage. | 230×54 |  |
| | | | | **wiring:** registers models from `model-training` · loads model into `model-serving` · loads model into (batch scoring) `lakeflow-jobs` |
| `model-serving` | Model Serving Endpoint | Serve a custom model behind a governed, autoscaling REST endpoint for real-time inference. | 230×54 | A deployed serving endpoint (real-time inference over a custom/registered model). Best fit when the story needs per-request scoring (fraud at authorization, rec at page-load). For a plain train→register→batch-score story, batch is usually simpler — the model writes a gold predictions table (via ml-training-serving / the medallion) that dashboards/apps read; reach for a live endpoint when real-time matters. |
| | | | | **wiring:** loads registered model from `uc-model-registry` · called for real-time predictions by `databricks-apps-work` *(optional)* |
| `hosted-mcps` | Hosted MCPs | Managed MCP servers that let agents call external tools — Genie, Atlassian, GitHub, Slack, SharePoint, Gmail, and more. | 230×54 | The governed tool/connector layer for agents — hosted MCP servers (Genie / Atlassian / GitHub / Slack / SharePoint / Gmail …). Use when the demo's agent reaches OUT to external systems via MCP. |
| | | | | **wiring:** exposes as tools `external tools (Genie, GitHub, Slack, …)` |
| `vector-search` | Vector Search | Embeddings | 230×54 | Two build modes: (a) MANAGED — auto-sync an index FROM a Delta table (data must land in Delta first via sdp; easiest, higher latency); (b) STANDALONE — a direct index updated via a real-time API to add/remove entries (low latency). Pick the one the demo's freshness needs. |
| | | | | **wiring:** auto-syncs index from a Delta table of (managed mode) `sdp` · direct add/remove entries (standalone mode, low-latency) `realtime API` |
| `information-extraction` | Information Extraction | Pull specific data points, entities, and fields from unstructured text (ai_extract). | 230×54 |  |
| | | | | **wiring:** reads unstructured text from `uc-volume` |
| `document-parsing` | Document Parsing | Extract structured content from documents — text, tables, and metadata (ai_parse_document). | 230×54 |  |
| | | | | **wiring:** reads documents from `uc-volume` |
| `text-classification` | Text Classification | Categorize text into predefined or dynamic labels (ai_classify). | 230×54 | Two typical shapes: (a) INLINE in the pipeline — a bi-directional arrow with `sdp` (enriches tables in place with ai_classify, usually drawn just below SDP); or (b) a STANDALONE job reading docs from a `uc-volume` and writing labels to a table. Pick per demo. |
| | | | | **wiring:** enriches tables in-pipeline (bi-directional, ai_classify) `sdp` · standalone job reads docs from `uc-volume` |
| `genie-code` | Built with Genie Code | Autonomous AI coding partner built into every Databricks surface (notebooks, pipelines, dashboards, MLflow) — Unity Catalog–aware, so it writes code against your real tables. | 360×112 | The 'built/maintained by Genie Code' beat — an AI coding partner for developers/practitioners (business users get the simpler no-code experience via Genie One). No need to add it separately when you're already using lakeflow-genie-block (that block has the Genie Code footer built in). |

### Agentic Apps `agentic-apps`

*The delivery surface — dashboards and custom apps the business actually opens. Reach here for what a user SEES and clicks.*

| type | default title | available description (technical; slide hides it) | size | when to use |
|------|---------------|-----------------------------------------|------|-------------|
| `databricks-apps` | Databricks Apps | Custom web app where the team does the work — queue, actions, all in one place. | 230×54 | LEGACY app tile — prefer `databricks-apps-work` for the custom business app. Kept for back-compat; use it only when an existing diagram already references it. |
| | | | | **wiring:** reads/writes app state from `lakebase` · calls (Genie Agent: data + documents) `genie` *(optional)* · calls `model-serving` *(optional)* · model calls governed by `ai-gateway` *(optional)* |
| `ai-bi-dashboard` | AI/BI Dashboard | Governed dashboards on the same data — one set of numbers, one page. | 230×54 |  |
| | | | | **wiring:** queries (SQL Warehouse) `sql-lakehouse` *(optional)* |
| `lakewatch` | LakeWatch | Agentic SIEM on the lakehouse — unify security logs + telemetry (OCSF), AI agents detect, investigate and respond at machine speed. | 230×54 | The security app: an agentic SIEM built ON the lakehouse. Use for security / SOC / threat-detection stories. Consumes governed telemetry from the data layer; SOC analysts + threat hunters use it. |
| | | | | **wiring:** reads security logs + telemetry (OCSF) from `sdp` · opened by (SOC analysts) `genie-one` *(optional)* |
| `customerlake` | CustomerLake | Agentic customer data platform embedded in Databricks — unify profiles into a Customer 360, run always-on campaigns, no data copies. | 230×54 | The marketing app: an agentic CDP on the lakehouse. Use for customer-360 / marketing / personalization / campaign stories. Consumes customer data from the data layer; marketers + analytics teams use it. |
| | | | | **wiring:** builds Customer 360 from governed data of `sdp` · opened by (marketers) `genie-one` *(optional)* |

### Unified Governance `unified-governance`

*The control plane over everything — Unity Catalog, the AI Gateway, and the Databricks-platform banner. Prefer the one `governance-block` bar over the loose tiles unless spotlighting a single feature.*

| type | default title | available description (technical; slide hides it) | size | when to use |
|------|---------------|-----------------------------------------|------|-------------|
| `governance-block` | Unified Governance | One control plane for data + AI: Unity Catalog governs access/lineage/audit (ACL · ABAC); the Unity AI Gateway governs every foundation-model call (OpenAI, Anthropic, Gemini, …); Genie Ontology is the shared semantic layer. | 570×92 | One governance bar with up to three surfaces: Access control (ACL · ABAC · Audit across Data + AI) + Unity AI Gateway (access any model) + Genie Ontology. Prefer over the loose unity-catalog / ai-gateway / data-quality / abac / data-classification tiles (use those only to spotlight one feature). OPTIONS (params, booleans, all default TRUE — set false to HIDE that surface): `access_control` / `ai_gateway` / `genie_ontology`; the bar tightens to the surfaces shown. Governance SPANS everything (data, jobs, dashboards, apps, end-user access…), so show it STRUCTURALLY — `pin` it as a bar across the top or bottom of the platform box; its position implies it governs all tiles under it, so draw NO per-tile edges. DEFAULT: the one-line spanning bar with NO edges — keep it low-touch, don't map it to every component. If a surface DOES need wiring, each shown one has a top+bottom handle (`@acl` / `@ai-gateway` / `@ontology`, + `-b`) and typically connects to: `@acl` → the DATA layer (medallion/lakehouse; the compute layer too if needed); `@ontology` → Genie (Genie Space / Genie agents); `@ai-gateway` → apps or model-serving (the frontier-model callers). Wire only the one or two that the story calls for, not all three. Any edge touching this block renders as a plain DASHED line with NO flow animation (governance governs, it doesn't flow data) — automatic, don't set `flow`/`dashed`. |
| | | | | **ports:** `acl` ↑ access control (ACL · ABAC · Audit) · `acl-b` ↓ access control (bottom) · `ai-gateway` ↑ Unity AI Gateway · `ai-gateway-b` ↓ Unity AI Gateway (bottom) · `ontology` ↑ Genie Ontology · `ontology-b` ↓ Genie Ontology (bottom) |
| `db-platform` | Databricks Platform | The Databricks Data + AI platform — one governed foundation for all data + AI. | 380×60 | Title banner (the Databricks wordmark). The first child of the platform box, usually at the left of a banner row with the governance block at the right (`justify:"between"`) → reads as 'all of this is the platform'. |
| `unity-catalog` | Unity Catalog | One governed catalog — access, lineage, and semantics across data + AI. | 230×54 | Governs EVERYTHING — data, jobs, dashboards, apps, end-user access. So don't wire it to every tile (overkill/noise). Best default: the spanning governance bar (this tile or `governance-block`) pinned top/bottom of the platform box, NO edges — position implies it governs all. If you use the single tile with edges (to spotlight governance), link only the 1–2 MAIN anchors (e.g. the data layer, or end-user access), not everything. Follow the user if they ask to show it governing something specific. |
| `ai-gateway` | Unity AI Gateway | Security, governance, cost and rate limits. | 240×104 | The Unity AI Gateway tile with a row of foundation-model logos (OpenAI · Anthropic · Gemini · Grok · Kimi) across the top — conveys 'govern + access ANY model' at a glance. Use standalone; the Unified Governance bar already embeds a compact gateway if you want the whole control plane. It governs the model calls that apps / model-serving endpoints make — wire it to whatever actually makes those calls (an app or model endpoint typically routes through it), labeled 'model calls governed by'. Keep that edge SHORT and adjacent to what it governs; don't drag the tile far away and route a long line across unrelated tiles (that reads as if the source 'calls the gateway' — the confusion to avoid). |
| | | | | **wiring:** governs model calls of `databricks-apps-work` · governs `model-serving` |
| `data-quality` | Data Quality | Expectations and monitors keep bad data out of the gold layer. | 230×54 |  |
| `abac` | ABAC | Attribute-based access control — fine-grained, policy-driven permissions. | 230×54 |  |
| `data-classification` | Data Classification | Automatically tag and govern sensitive data. | 230×54 |  |

> Sources are demo-authored (not in this catalog): use `type:"source"` with a vendor `icon` (`file:vendor/<name>`; see the icon bank below) and wire the edge to the Lakeflow block's ingest port via an explicit `@in-*` handle.

<!-- END: generated-catalog -->

### Sources
`type:"source"` with a vendor `icon` (`file:vendor/<name>` — e.g. `postgresql`, `kafka`, `sap`, `salesforce`, `shopify`). Generic fallbacks: `pdfLogo`, `csv`, `parquet`, `sensorSource`, `inputData`, `unstructuredData`. A persona: `file:persona/user` as a `logo`.

Show the sources the ask names, as real systems, never a lone "Synthetic data" placeholder.
- **Follow the user first:** if they named sources, use exactly those, and no others.
- **Not named:** draw the one to three the use-case cannot work without, as the kind of source it implies (a card-payments fraud model needs the transactions; a streaming ask needs its sensor or event feed), wired to the matching ingest port: database (`postgresql`/`mysql` → `@in-lakeflow-connect`), SaaS app (`salesforce`/`shopify` → `@in-lakeflow-connect`), sensor/IoT (`sensorSource` → `@in-zerobus`), documents (`pdfLogo` → `@in-direct`). Use a vendor name only when the ask or the industry makes that system unavoidable. Never fill a source column to a set count.
- **Kafka and Zerobus:** Zerobus is Databricks' direct app/device → lakehouse ingest — an alternative to a broker, not a consumer of one. A Kafka source the customer runs today wires to `@in-lakeflow-connect`; **never draw Kafka into `@in-zerobus`**. Zerobus can still serve other real-time sources (sensors, devices, app events). With no signal and a streaming need, prefer sensor/IoT → `@in-zerobus` over inventing a Kafka broker.
- `file:vendor/custom-source` only for a source with no real-world product behind it.

### Source groups — `multi-source`
When the sources column has many systems, group related ones into ONE titled box (a child of that column) (e.g. "Operational databases", "SaaS apps with a managed connector", "Events / message streams"):
```json
{ "id": "grp-op-db", "type": "multi-source",
  "label": "Operational databases",
  "params": { "note": "high-volume · need deletes + source-column lineage" },
  "sources": [
    { "icon": "text", "label": "SITS", "note": "student SOR" },
    { "icon": "text", "label": "PeopleSoft Financials" },
    { "icon": "file:vendor/microsoft-sql-server", "label": "SQL Server / Oracle / Postgres" }
  ] }
```
- `label` = group title. `sources` = a first-class array of `{ icon, label, note?, wrap? }`: `icon` any mark key (`"text"` for a name-only badge — never invent a logo); `note` a short muted qualifier; `wrap:true` moves that item's note below the name and lets it wrap (the box height adapts).
- `params.note` = optional one-line description under the title; wraps and the height adapts.
- **Wiring:** ONE edge from the group into its ingest method, not one per system. Group by ingest characteristic (databases vs managed-connector SaaS vs connector-less SaaS vs streams vs files).
- `style.fill` tints the background (e.g. `#F8FAFC`).

### Available logos (icon bank)

<!-- BEGIN: generated-icons -->

<!-- AUTO-GENERATED from the icon bank (reference/icons.tsv + ui/icons/icon-concepts.json) — DO NOT EDIT BY HAND. -->

**Pick an icon.** Take the key from the preferred table below. For anything else run `grep -i "<word>" reference/icons.tsv` (columns: key, tier, set, flags, aliases, concepts) and use the lowest-tier match. Never invent a key; every key here and in icons.tsv is validated at build.

**Precedence (fixed):** T1 named third-party or cloud product (`file:vendor/*`, `file:cloud/*`) → T2 Databricks line pictogram (`file:databricks-line/*`, navy; set `style.icon` for a colour, e.g. the Databricks orange `#FF5F46`) → T3 Databricks UI icon (`file:db/*`, 16 px, capped at 32px; only when T1-T2 has no fit for the concept) → T4 filled product mark, built-in glyph or generic person (`file:brand/*` Databricks marks, bare built-in names, `file:persona/user`) → T5 `lucide:<name>` (abstract shape only) → T6 `file:vendor/custom-source` (unnamed source).

**Aliases.** Some keys are aliases: they render the art of a canonical key (for example `dashboard` → `file:databricks-line/dashboards`, `file:db/notebook` → `file:databricks-line/notebook`). Write the canonical key in new diagrams; alias keys stay valid in existing ones. The `aliases` column of icons.tsv lists them.

**Colour.** Any node may set its icon colour with `style.icon` (hex) to tint a monochrome line or UI icon (logo, card, source and catalog tile icons), e.g. `style: {icon: "#FF5F46"}` for the Databricks orange. Brand and partner logos keep their own colour.

**Slides vs technical diagrams.** Slide-style diagrams may still use the filled Databricks brand marks (`file:brand/*`, `*Brand`) for Databricks products. Line and workspace art is the default for technical diagrams.

**Preferred icon per concept:**

| Concept | Key |
|---|---|
| notebook | `file:databricks-line/notebook` |
| dashboard (AI/BI) | `file:databricks-line/dashboards` |
| SQL warehouse | `file:databricks-line/data-warehouse` |
| Delta table | `file:databricks-line/delta-table` |
| Delta Lake | `file:databricks-line/delta-lake` |
| Delta Sharing | `file:databricks-line/data-sharing` |
| Unity Catalog | `file:databricks-line/unity-catalog` |
| catalog store / metastore | `file:databricks-line/catalog-store` |
| Lakeflow Connect / ingestion | `file:databricks-line/lakeflow-connect` |
| Jobs and pipelines | `file:databricks-line/data-pipelines` |
| declarative pipeline (SDP / DLT) | `file:databricks-line/delta-live-tables` |
| scheduled job | `file:databricks-line/scheduled-jobs` |
| feature store | `file:databricks-line/feature-store` |
| machine learning / ML model | `file:databricks-line/machine-learning` |
| model registry | `file:databricks-line/model-registry` |
| MLOps | `file:databricks-line/mlops` |
| model serving | `file:db/serving` |
| MLflow / experiments | `file:db/experiment` |
| AI gateway | `file:db/ai-gateway` |
| Lakebase | `file:db/lakebase` |
| Genie | `file:db/genie-agent` |
| agents / multi-agent supervisor | `file:db/agents` |
| knowledge base / knowledge assistant | `file:databricks-line/knowledge-base` |
| Databricks Apps | `file:databricks-line/apps-services` |
| governance | `file:databricks-line/governance` |
| security / compliance | `file:databricks-line/enterprise-security` |
| chat / conversation | `file:databricks-line/chat` |
| webhook | `file:databricks-line/webhook` |
| people / team | `file:databricks-line/3-people` |
| generic user (persona) | `file:persona/user` |
| data analyst | `file:databricks-line/data-analyst-persona` |
| data engineer | `file:databricks-line/data-engineer-persona` |
| data scientist | `file:databricks-line/data-scientist-persona-1` |
| ML engineer | `file:databricks-line/ml-engineer-persona` |
| business decision maker | `file:databricks-line/business-decision-maker-persona` |
| Kafka | `file:vendor/kafka` |
| PostgreSQL | `file:vendor/postgresql` |
| Amazon S3 | `file:cloud/aws/storage/s3` |
| Azure Blob / ADLS | `file:cloud/azure/storage/blob-storage` |
| unnamed source system | `file:vendor/custom-source` |
| catalog (UC object) | `file:db/catalog` |
| schema | `file:db/schema` |
| table | `file:db/table` |
| view | `file:db/view` |
| metric view | `file:db/metric-view` |
| function (UDF) | `file:db/function` |
| stored procedure | `file:db/stored-procedure` |
| volume | `file:db/volume` |
| registered model (UC) | `file:db/registered-model` |
| streaming table | `file:db/streaming-table` |
| vector index | `file:db/vector-index` |
| MCP server | `file:db/mcp` |
| materialized view | `file:db/materialized-view` |
| foreign / federated table | `file:db/foreign-table` |
| feature spec | `file:db/feature-spec` |
| feature function | `file:db/feature-function` |
| LakeWatch (agentic SIEM) | `lakeWatchBrand` |
| CustomerLake (agentic CDP) | `customerLakeBrand` |

**Sets** (635 rows): built-in 26, lucide 50, Databricks brand marks 5, Databricks line 92 (one navy key per icon; set style.icon for a colour, e.g. the Databricks orange #FF5F46), Databricks UI icons 151 (workspace UI, 16 px), vendor 139 (incl. remote), cloud 170, persona 1. Full list: `reference/icons.tsv`.

Also: `file:persona/user` (a person — normally the business-user persona is built into the `genie-one` component, but you can place it as a standalone `logo` node if needed).

**Azure ML has TWO marks — pick by what the node IS, not by which looks newer.** `file:cloud/azure/ml/machine-learning` is the STANDALONE Azure ML service (cyan; pack `10166`) — use it for an Azure ML workspace, pipeline, registry or managed endpoint. `file:cloud/azure/ml/machine-learning-foundry` is Azure ML **as an AI Foundry surface** (purple; pack `038470510`, one of the Foundry family alongside Foundry Agent Service / Control Plane / Models) — use it only when the node really sits inside Foundry. Microsoft ships BOTH in the current pack, so neither supersedes the other. For the Foundry platform itself use `file:cloud/azure/ml/ai-foundry`.

<!-- END: generated-icons -->


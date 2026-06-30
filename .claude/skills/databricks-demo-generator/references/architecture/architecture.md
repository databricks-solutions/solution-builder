# Architecture Diagram — Schema & Authoring Reference

`architecture.md` (the **project file**, at the project root) drives an **interactive architecture canvas**: a Lucidchart-style ReactFlow editor. The file is a **flat list of the components you see** plus the **lines between them** — nothing else. A node is on the canvas iff it's in `nodes`; there is no visibility state, no bands, no catalog-diffing to reason about.

**Author STRUCTURE, not pixels.** You assign each node to a **column** (a left→right lane) and let the renderer compute coordinates; you draw **edges by node id** and the handle is inferred; you wrap a group of nodes in a **container box** that auto-sizes around them. You almost never write `x/y`. (You *may* pin a node with an explicit `at` — it overrides its column — for things like top banners. And once the user drags a node on the canvas, that position is saved as `at`.)

This folder ships **reference architectures** you start from:

- `architecture-complete.json` — the **default flagship** end-to-end shape (sources → Lakeflow+Genie → lakehouse+lakebase → dashboard/Genie/app → Genie One → user, on one platform box, governance over the top). See *The canonical end-to-end flow*.
- `architecture-complete.jsonc` — the SAME layout, annotated with `//` comments explaining every node + edge. Read it to learn the wiring; it is for you, not the renderer.
- `architecture-simple.json` — the minimal shape: one source → Lakeflow+Genie → lakehouse → a dashboard + app, with Genie.

To start from one, copy its `nodes`/`edges` into the project's `architecture.md` (wrapped in a ```json fence — see *Project file format*) and adapt. **Emit plain JSON — never copy the `//` comments from the `.jsonc`** (the canvas `JSON.parse`s the file; comments break it).

---

## The format

```json
{
  "name": "My Demo Architecture",
  "story": "One line framing the demo (optional).",
  "options": { "trademarkLogos": false },
  "columns": ["sources", "pipeline", "compute", "work", "entry", "user"],
  "custom_logos": [
    { "id": "acme", "svg": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#7C3AED' d='M12 2l3 7 7 .5-5 4.5 1.5 7L12 17l-6 4 1.5-7-5-4.5 7-.5z'/></svg>" }
  ],
  "nodes": [
    { "id": "src-erp", "type": "source", "col": "sources", "label": "ERP System", "icon": "file:vendor/sap", "ingest": "lakeflow-connect" },
    { "id": "src-acme", "type": "source", "col": "sources", "label": "ACME Corp", "icon": "custom:acme", "ingest": "lakeflow-connect" },
    { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "col": "pipeline" },
    { "id": "lakehouse", "type": "lakehouse", "col": "compute" },
    { "id": "aibi-dashboards", "type": "aibi-dashboards", "col": "work", "row": 1 },
    { "id": "genie", "type": "genie", "col": "work", "row": 2, "label": "Genie Room", "desc": "Ask anything about your data" },
    { "id": "genie-one", "type": "genie-one", "col": "entry", "rot": 90 },
    { "id": "user", "type": "logo", "col": "user", "icon": "file:persona/user", "text": "Business users", "size": [88, 88] },
    { "id": "governance-block", "type": "governance-block", "at": [1058, -178] },
    { "id": "platform-box", "type": "box", "z": -1, "wraps": ["src-erp", "lakeflow-genie-block", "lakehouse", "aibi-dashboards", "genie", "genie-one", "user"] }
  ],
  "edges": [
    { "id": "e1", "from": "src-erp", "to": "lakeflow-genie-block", "flow": true },
    { "id": "e2", "from": "lakehouse", "to": "genie", "flow": true },
    { "id": "e3", "from": "genie-one", "to": "aibi-dashboards" }
  ]
}
```

### Top level
| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Toolbar title. Defaults to "Solution architecture". |
| `story` | No | One-line caption under the title. |
| `options.trademarkLogos` | No | `true` → render real third-party brand logos. Default `false` (neutral badges). |
| `columns` | No | Ordered left→right **lane names**. Nodes reference one via `col`. Add/rename/insert lanes freely for a different shape — no fixed taxonomy. |
| `custom_logos` | No | `[{ id, svg }]` — inline SVG logos. Reference one from any node's `icon` as `"custom:<id>"`. See *Custom logos & images*. |
| `nodes` | Yes | The components on the canvas (see below). |
| `edges` | Yes | The lines between them. |

### A node
| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique node id. For a 2nd placement of the same component use `genie#2` (the `#N` suffix). |
| `type` | Yes | A **catalog component id** (`genie`, `lakehouse`, `lakeflow-genie-block`, `governance-block`, `db-platform`, … — see the catalog below; this folds in the old composite "kind") OR a special kind: `source` · `box` · `text` · `logo` · `image`. |
| `col` | placement | The lane (from `columns`) this node sits in. Nodes in a lane stack vertically, centered. **Primary way to place a node.** |
| `row` | No | Order within the lane (else order of appearance). |
| `wraps` | container | On a `type:"box"`: the node ids this box ENCLOSES. The box auto-sizes around them (+ `pad`, default 24). Nesting works (a box may wrap boxes) — see *Containers*. |
| `bounds` | container | On a `type:"box"`: per-side edge anchors `{ left?, right?, top?, bottom? }`. Each side = `"<nodeId>:<anchor>"` (anchor ∈ `left`/`right`/`center` for x, `top`/`bottom`/`center` for y), or `"col:<name>:<anchor>"` (a lane's edge/midpoint), or `"wrap"`. Lets the box edge cut HALFWAY through a node/column. Unspecified sides fall back to `wraps`. |
| `pin` | placement | Dock this node into a box corner (overrides `col`). An object `{ at, to?, pad?, float? }`: `at` = one of `top-left`·`top`·`top-right`·`left`·`center`·`right`·`bottom-left`·`bottom`·`bottom-right`; `to` = box id to dock into (default: the largest box); `pad` = inset px (default 16); `float` = `false`/omitted → **reserve a band** (the box GROWS so this never overlaps content — top pin pushes content down, bottom extends the box down), `true` → **overlay** at the corner (may sit over content). Use for banners / personas. |
| `at` | No | `[x, y]` **explicit** position (node center). **Overrides `col`/`pin`.** Use for fully manual placement. (A user drag also persists here.) |
| `size` | No | `[w, h]` if resized from the natural size. |
| `rot` · `scale` · `z` · `pad` | No | Rotation° (0/90/180/270), content scale, stacking order (negative = behind), container padding. |
| `group` | No | A shared string id stamped on several nodes → they form a GROUP: selecting one selects all, and they move together on the canvas. |
| `label` · `desc` · `icon` | No | Override the catalog default copy/icon (only when it differs). `icon` may be a built-in name, a `file:vendor/…`/`file:cloud/…` key, or a `custom:<id>` (see *Custom logos & images*). |
| `ingest` | source only | `lakeflow-connect` (default) · `zerobus` · `direct`. |
| `text`·`fontSize`·`bold`·`vAlign`·`hAlign`·`src` | box/text/logo/image | Annotation props — see *Annotations*. |
| `style` | No | `{ border, borderStyle, borderColor, radius, shadow, fill, font, opacity }` — visual overrides; emit only what differs. `border` = width px (0 = none); `borderStyle` = `solid`/`dashed`; `borderColor`/`fill`/`font` = hex; `radius` = corner px; `shadow` = 0–100 intensity (0 = none); `opacity` = 0–1. |

The **band** a component belongs to (which sets its tile color) is derived from its `type` — you never write it.

### An edge
`{ "id"?, "from": "<srcId>[@handle]", "to": "<tgtId>[@handle]", "flow"?, "arrow"?, "dashed"?, "shape"?, "flowStyle"?, "centerX"?, "label"? }`

- **Write `from`/`to` by node id; the `@handle` is INFERRED** from geometry: left→right ⇒ source `@r` → target `@l`; vertical ⇒ `@b`/`@t`. A **source** feeding the Lakeflow block routes to the right port from its `ingest` (`lakeflow-connect`→`in-lakeflow-connect`, `zerobus`→`in-zerobus`, `direct`→`in-direct`) automatically.
- Add an explicit **`@handle`** only to override the inference — a composite port (`in-lakeflow-connect`, `in-zerobus`, `in-direct`, `r`) or a side (`l`/`r`/`t`/`b`). E.g. force a vertical link with `@b`/`@t`.
- `flow: true` → animated "data flowing" line. Omit for a static line.
- `arrow`: omit/`"auto"` (default — auto-draws an arrowhead for edges touching the **user persona** or **Genie One**) · `"none"` · `"end"` · `"start"` · `"both"`. An explicit arrow is a static relationship line.
- `shape`: `smooth` (default) · `straight` · `step`. `flowStyle`: `dot`·`particles`·`docs`·`laser`.

### Containers (wrapper boxes)
A `type:"box"` with `wraps: [ids]` becomes a **labeled container** that auto-sizes to enclose those nodes (+ `pad`). It's how the big white **platform box** works (`wraps` the whole flow, `z:-1`). Nesting is recursive — model a cloud diagram by wrapping wrappers:

```json
{ "id": "aws", "type": "box", "label": "AWS", "wraps": ["vpc"], "pad": 28 },
{ "id": "vpc", "type": "box", "label": "VPC 10.0.0.0/16", "wraps": ["subnet-a"], "pad": 22 },
{ "id": "subnet-a", "type": "box", "label": "Private subnet", "wraps": ["app", "db"], "pad": 16 },
{ "id": "app", "type": "databricks-apps-work", "col": "compute" },
{ "id": "db",  "type": "lakebase", "col": "compute" }
```

The inner nodes get placed (by `col` or `at`); each box sizes itself around its members, innermost first. You never compute a box's `at`/`size`.

### Annotations (free-form, not catalog components)

Four `type`s let you add labels and marks that aren't Databricks components:

| type | props | use |
|------|-------|-----|
| `text` | `text`, `fontSize`, `bold`, `vAlign`/`hAlign` | a free-floating text label. |
| `box` | `text`, `fontSize`, `vAlign`/`hAlign`, + `wraps`/`bounds`/`pad` | a labeled rectangle / container (the platform box, cloud/VPC boxes). |
| `logo` | `icon` (any icon key, incl. `file:…` or `custom:<id>`), `text` (caption below) | a standalone logo — e.g. the `file:persona/user` end-user marker. |
| `image` | `src` | a standalone image (URL or base64 — see below). |

> A `box` shows a 1px border by default; `text` shows none. The border is controlled ONLY by `style` — set `style.border` (px width, `0` = none), `style.borderColor`, `style.borderStyle` (`solid`/`dashed`). There is no separate border boolean.

### Custom logos & images

- **Custom SVG logos** — add inline SVGs in the top-level `custom_logos` array and reference them by id from ANY node's `icon`:
  ```json
  "custom_logos": [
    { "id": "acme", "svg": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#7C3AED' d='M12 2l3 7 7 .5-5 4.5 1.5 7L12 17l-6 4 1.5-7-5-4.5 7-.5z'/></svg>" }
  ]
  ```
  Then `"icon": "custom:acme"` on a `type:"source"` tile (a named data source with a custom brand) OR a `type:"logo"` node (a standalone mark). Custom logos are never trademark-gated — always shown. (Escape the SVG quotes for JSON, or use single quotes inside the SVG as above.)
- **Images (base64)** — a `type:"image"` node with `"src": "data:image/png;base64,…"` (or an http URL). **Standalone only** — an image is its own node; you can't use it as a component/source `icon` (use a `custom_logos` SVG for that).

---

## Generating an architecture — three entry points

You produce the same flat `nodes`/`edges` regardless of where the intent comes from:

1. **From a pasted conversation / free-text intent.** The user pastes a transcript or types "ingest ERP data into a business app." **Extract the main components** they imply (source systems, pipeline, serving layer, dashboard/app, agents), map each to a catalog `type`, and place them — start from `architecture-complete.json` (or `-simple.json`) and adapt positions + swap the sources. Don't invent a story.
2. **From an existing story + selected capabilities.** A demo has a `README.md`/`resources.json`. Place a node per chosen capability (use its slug as the `type`) plus the story's sources; give headline nodes story-tied `label`/`desc`.
3. **From a reference, then edited.** Start from a reference file and tweak.

Map the user's words to real catalog `type`s. For a source the catalog can't know, use `type:"source"` with a vendor `icon` + `ingest`.

---

## The canonical end-to-end flow (the "complete" shape)

`architecture-complete.json` is the flagship layout — copy it and adapt. Left → right:

```
sources (≈3 rows)  →  Lakeflow + Genie (one block)  →  lakehouse + lakebase
     →  dashboard + Genie Room + app  →  Genie One  →  the end user
```

- **Top-left:** the `db-platform` wordmark. **Top-right:** `governance-block` (Unity Catalog) over everything. **Everything sits inside ONE big white `box`** (`z:-1`) — that box *is* "the Databricks Platform".
- **The `lakeflow-genie-block` has THREE left ports** — wire each source to the one matching HOW it's ingested:
  - `in-lakeflow-connect` ← **databases / SaaS apps**: Postgres, ERP/SAP, Salesforce, MySQL…
  - `in-zerobus` ← **realtime streams / sensors / IoT / events**: Kafka, sensor data…
  - `in-direct` ← **files NOT supported by Connect**: PDFs, CSV/Parquet dumps on a UC Volume.
  - Right port `@r` → the compute layer. **Inside the block = Genie Code + SDP** (all bronze→silver→gold) — do NOT add separate `sdp`/`genie-code` nodes.
- **Compute** (both fed by `lakeflow-genie-block@r`): `lakehouse` (BI+AI) and `lakebase` (live app state).
- **Consumption:** `lakehouse` → `aibi-dashboards` + `genie`. `lakebase` → the `databricks-apps-work` app; the **app also consumes the Genie Room + dashboard**.
- **End user:** a `file:persona/user` `logo` (give it `"text": "Business users"` as the caption by default, and a slightly taller `size` like `[88, 88]` so icon + caption fit) reaches the resources **through `genie-one`**. Those edges are **relationship arrows** — leave `arrow` out (auto): user ==> Genie One, Genie One --> dashboard / Genie Room / app.

---

## Component catalog (dense reference)

<!-- BEGIN: generated-catalog -->

<!-- AUTO-GENERATED from CATALOG in app/.../lib/platform-architecture.ts
     by `bun run scripts/gen-architecture-skill.ts` — DO NOT EDIT BY HAND. -->

Use the `type` id; the renderer supplies the icon, label, default description and size. Override `label`/`desc` only when story-specific. Composite blocks carry their own internal layout — treat each as ONE node (don't also add its sub-parts).

### Agentic Data `agentic-data`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `lakeflow-block` | Lakeflow | 224×148 | The whole ingest + bronze→silver→gold SDP in one block (no Genie Code framing). Contains SDP — never add a separate sdp tile beside it. |
| | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps (ingest: lakeflow-connect) · `in-zerobus` ← realtime streams / sensors (ingest: zerobus) · `in-direct` ← files: PDF / CSV / Parquet (ingest: direct) · `r` → the compute layer |
| `lakeflow-genie-block` | Lakeflow + Genie | 360×208 | The PREFERRED data-layer block — ingest + bronze→silver→gold SDP, built/maintained by Genie Code. It IS the data layer; contains SDP + Genie Code, so never add separate sdp / genie-code tiles beside it. |
| | | | **ports:** `in-lakeflow-connect` ← databases / SaaS apps (ingest: lakeflow-connect) · `in-zerobus` ← realtime streams / sensors (ingest: zerobus) · `in-direct` ← files: PDF / CSV / Parquet (ingest: direct) · `r` → the compute layer |
| `lakeflow-connect` | Lakeflow Connect | 200×56 | Managed connectors ingest from databases and SaaS apps under governance. |
| `zerobus-ingest` | Lakeflow Zerobus | 200×56 | Real-time, direct ingest of streaming events into the lakehouse. |
| `sdp` | Lakeflow SDP | 230×112 | Spark Declarative Pipelines — declarative bronze → silver → gold that self-heal and scale. |
| `uc-volume` | UC Volume | 200×56 | Governed file storage in Unity Catalog — where raw documents (PDFs) land. |
| `lakeflow-jobs` | Lakeflow Jobs | 230×70 | Orchestrate the whole pipeline on a schedule or trigger. |
| `notebooks-eda` | Notebooks | 200×56 | Interactive exploration and analysis on governed data. |
| `delta-sharing` | Delta Sharing | 200×56 | Open, cross-org data sharing with no copies. |
| `marketplace` | Marketplace | 200×56 | Discover and consume third-party data and AI assets. |
| `lakebase` | Lakebase | 230×70 | Managed Postgres for app state — reads/writes the live queue. |
| `lakehouse` | Lakehouse | 230×70 | One copy of governed data for BI + AI — real-time queries at scale. |

### Agentic Work `agentic-work`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `databricks-apps-work` | Databricks Apps | 230×70 | The custom business app — PREFERRED over the legacy databricks-apps tile. Runs on Lakebase; can embed the dashboard + Genie Room. |
| `genie-one` | Genie One - Mobile app | 230×70 | The business-user / mobile entry point. Convention: a file:persona/user logo (caption 'Business users') to its right — user ==> Genie One, and Genie One --> dashboard / Genie Room / app. Those edges auto-render as arrows (leave `arrow` out). |
| `genie` | Genie Room | 230×70 | ask anything about your data |
| `knowledge-assistant` | Knowledge Assistant | 200×56 | Chat with your documents — grounded, cited answers from unstructured content. |
| `supervisor-agent` | Multi-Agent Supervisor | 200×56 | Routes a question to the right specialist agent and composes the answer. |
| `agent-bricks` | Agent Bricks | 230×170 | Managed MULTI-agent system: a Supervisor orchestrating Knowledge Assistant / Genie / MCP / Functions (with extraction·parsing·classification chips). Use when the agent layer is a supervisor routing to specialists; if the demo uses only one agent capability, use that single tile instead. |
| `ml-training-serving` | ML Models | 200×56 | Train, register, and serve models on governed data. |
| `vector-search` | Vector Search | 200×56 | Semantic search and retrieval that grounds agents in your data. |
| `information-extraction` | Information Extraction | 200×56 | Turn PDFs and documents into structured, queryable data. |
| `document-parsing` | Document Parsing | 200×56 | Parse PDFs and documents into clean, structured text + layout. |
| `classification` | Classification | 200×56 | Classify documents and records into governed categories. |
| `genie-code` | Built with Genie Code | 360×112 | Standalone 'describe it → Genie Code builds it' beat. Use only when NOT already using lakeflow-genie-block (which has the Genie Code footer built in). |

### Agentic Apps `agentic-apps`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `databricks-apps` | Databricks Apps | 200×56 | Custom web app where the team does the work — queue, actions, all in one place. |
| `aibi-dashboards` | AI/BI Dashboard | 230×70 | Governed dashboards on the same data — one set of numbers, one page. |

### Unified Governance `unified-governance`

| type | label | size | what it is / when to use |
|------|-------|------|--------------------------|
| `governance-block` | Unified Governance | 580×108 | One governance bar: Unity Catalog + Unity AI Gateway (access any model) + a live Genie Ontology graph. Prefer over the loose unity-catalog / ai-gateway / data-quality / abac / data-classification tiles (use those only to spotlight one feature). |
| `db-platform` | Databricks Platform | 380×60 | Title banner (the Databricks wordmark). Pin it top-left, usually paired with a big background box (z:-1) wrapping everything → reads as 'all of this is the platform'. |
| `unity-catalog` | Unity Catalog | 200×56 | One governed catalog — access, lineage, and semantics across data + AI. |
| `ai-gateway` | Unity AI Gateway | 200×56 | Every model and agent call governed — security, cost, and rate limits. |
| `data-quality` | Data Quality | 200×56 | Expectations and monitors keep bad data out of the gold layer. |
| `abac` | ABAC | 200×56 | Attribute-based access control — fine-grained, policy-driven permissions. |
| `data-classification` | Data Classification | 200×56 | Automatically tag and govern sensitive data. |

> Sources are demo-authored (not in this catalog): use `type:"source"` with a vendor `icon` (`file:vendor/<name>`) + an `ingest` path (see the icon bank below).

<!-- END: generated-catalog -->

### Sources
Use `type:"source"` with a vendor `icon` (`file:vendor/<name>` — e.g. `postgresql`, `kafka`, `sap`, `salesforce`, `shopify`) and an `ingest` path. Generic fallbacks: `pdfLogo`, `sensorSource`, `inputData`, `unstructuredData`. The `ingest` decides which Lakeflow port the source's edge targets (`lakeflow-connect`→`in-lakeflow-connect`, `zerobus`→`in-zerobus`, `direct`→`in-direct`). A custom shapes source: `file:vendor/custom-source`. A persona/user marker: `file:persona/user` (as a `logo` node).

Show **real, NAMED source systems** — never a single "Synthetic Data" / "synthetic" placeholder (it reads as fake and tells no story).
- **Follow the user first:** if they named their sources (one or many), use exactly those.
- **Default when you have no signal:** add **~4** plausible real systems with real vendor logos, spanning the three ingest paths so the Lakeflow block's three ports are used — e.g. a database (`postgresql`/`mysql`, `lakeflow-connect`), a SaaS app (`salesforce`/`shopify`, `lakeflow-connect`), **sensor / IoT data** (`sensorSource`, `zerobus`), and documents (`pdfLogo`, `direct`). Fit the industry if one is implied; otherwise this generic mix is fine. This is just the fallback — a demo that clearly wants one source should show one.
- For the streaming/`zerobus` path lead with **sensor data**, NOT Kafka — Zerobus is Databricks' direct ingest that *replaces* a Kafka-style broker, so showing Kafka alongside it is contradictory.
- Only use `file:vendor/custom-source` for a source that genuinely has no real-world product behind it.

### Available logos (icon bank)

<!-- BEGIN: generated-icons -->

<!-- AUTO-GENERATED from the icon bank (icons/vendor + icons/cloud) — DO NOT EDIT BY HAND. -->

Logos you can set as a node `icon`. Keys are self-explanatory; use them verbatim.

**Vendor / product logos** — `file:vendor/<name>`:

`adyen`, `agent-bricks`, `airbyte`, `airtable`, `amplitude`, `anthropic`, `apache-airflow`, `apache-couchdb`, `apache-flink`, `apache-hbase`, `apache-nifi`, `apache-spark`, `atlassian`, `bigcommerce`, `box`, `braze`, `brevo`, `cassandra`, `clickhouse`, `cockroachdb`, `confluence`, `couchbase`, `custom-source`, `databricks`, `databricks-wordmark`, `dbt`, `dropbox`, `duckdb`, `elasticsearch`, `gemini`, `genie-ontology`, `github`, `gitlab`, `glean`, `google-ads`, `google-analytics`, `google-docs`, `google-drive`, `google-sheets`, `grafana`, `hootsuite`, `hubspot`, `ibm`, `influxdb`, `informatica`, `intercom`, `jira`, `kafka`, `klarna`, `looker`, `mailchimp`, `mariadb`, `marketo`, `mastercard`, `meta`, `metabase`, `microsoft`, `microsoft-sql-server`, `mixpanel`, `mongodb`, `mqtt`, `mysql`, `neo4j`, `node-red`, `notion`, `openai`, `oracle`, `paypal`, `planetscale`, `postgresql`, `power-bi`, `prestashop`, `presto`, `pulsar`, `qlik`, `quickbooks`, `rabbitmq`, `redis`, `salesforce`, `sap`, `scylladb`, `segment`, `sendgrid`, `shopify`, `shopware`, `siemens`, `singlestore`, `slack`, `snapchat`, `snowflake`, `sqlite`, `square`, `stripe`, `supabase`, `superset`, `tableau`, `talend`, `teradata`, `tiktok`, `trino`, `twilio`, `visa`, `woocommerce`, `xero`, `youtube`, `zapier`, `zendesk`, `zeroops`, `zoho`

**Cloud logos** — `file:cloud/<provider>/<category>/<name>` (e.g. `file:cloud/aws/storage/s3`):

- **aws**: `analytics/athena`, `analytics/glue`, `analytics/redshift`, `compute/ec2`, `compute/lambda`, `database/dynamodb`, `database/rds`, `ml/sagemaker`, `networking/route53`, `networking/vpc`, `storage/s3`, `streaming/kinesis`
- **azure**: `analytics/data-factory`, `analytics/synapse`, `compute/functions`, `compute/virtual-machines`, `database/cosmos-db`, `database/sql-database`, `ml/machine-learning`, `networking/virtual-network`, `storage/blob-storage`, `streaming/event-hubs`
- **gcp**: `analytics/bigquery`, `analytics/dataflow`, `analytics/dataproc`, `compute/cloud-functions`, `compute/compute-engine`, `database/bigtable`, `database/cloud-sql`, `ml/vertex-ai`, `networking/vpc`, `storage/cloud-storage`, `streaming/pubsub`

Also: `file:persona/user` (a person — use as a `logo` node, caption "Business users"), `file:vendor/custom-source` (generic animated shapes source when no real logo fits).

<!-- END: generated-icons -->

---

## Project file format

The project file is `architecture.md` — **markdown with one fenced ```json block** holding the object above. The reference `.json` files are raw (unfenced); when you start from one, paste its content inside the fence:

````markdown
```json
{ "name": "...", "nodes": [ ... ], "edges": [ ... ] }
```
````

---

## Authoring rules

1. **Only list what's shown.** A node in `nodes` is on the canvas; anything else simply isn't there. No state, no hidden list.
2. **Map words → catalog `type`s.** Reuse catalog ids (so deep-links + `resources.json` line up). Use `type:"source"` for the demo's source systems.
3. **Prefer composites:** `lakeflow-genie-block` over `sdp`+`lakeflow-connect`; `governance-block` over the five governance tiles; `agent-bricks` for managed multi-agent.
4. **Place by `col`, not coordinates.** Declare `columns`, give each node a `col` (+ `row` to order within a lane). Let the renderer compute x/y. Use an explicit `at` only for off-flow banners (db-platform, governance) or to pin something. Don't invent pixel coordinates.
5. **Wrap groups in a `box` via `wraps`** — the platform box (the whole flow), or cloud/VPC/zone containers (nested). It auto-sizes; you never set its `at`/`size`.
6. **Edges by id; handles inferred.** Write `from`/`to` as plain ids — the `@handle` and source ingest port are inferred. Add `@handle` only to override (e.g. `@b`/`@t` for a vertical link).
7. **Descriptions are the point.** Make `desc`s demo-specific and human, not datasheet copy.
8. **Genie One / user edges are auto-arrows** (leave `arrow`/`flow` out). Pipeline edges use `flow: true`.

---

## Complete example

See `architecture-complete.json` (full, known-good) and `architecture-complete.jsonc` (the same, commented) in this folder; `architecture-simple.json` for the minimal shape.

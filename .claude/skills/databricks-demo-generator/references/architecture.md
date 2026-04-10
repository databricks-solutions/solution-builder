# Architecture Diagram Schema Reference

Generate architecture diagrams for Databricks demos using a simple JSON schema. The schema is automatically rendered as an interactive diagram.

## Schema Structure

```json
{
  "name": "Demo Name",
  "columns": [...],
  "edges": [...],
  "bars": [...]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Name of the architecture |
| `columns` | Yes | Array of vertical columns (left to right) |
| `edges` | Yes | Connections between nodes |
| `bars` | No | Horizontal foundation bars at bottom |

---

## Columns

Columns are positioned automatically left-to-right. Each column can contain nodes, vertical bars, or be wrapped in a group.

```json
{
  "columns": [
    { "nodes": [...] },
    { "group": {...}, "nodes": [...] },
    { "bars": [...] }
  ]
}
```

**IMPORTANT — Column ordering rules:**

Each tier/category belongs in its own column. Do NOT mix tiers in the same column.

**Typical column order (left to right):**
1. **Sources** — External data (tier: `source`)
2. **SDP Pipeline** — Bronze/Silver/Gold in a group (tiers: `bronze`, `silver`, `gold`)
3. **Compute** — SQL Warehouse, Notebooks (tier: `compute`)
4. **Analytics** — Dashboards, BI reports (tier: `analytics`)
5. **AI** — Genie, KA, MAS, ML Models (tier: `ai`)
6. **Interface** — Databricks One vertical bar (tier: `interface`)
7. **Consumer** — End users (tier: `consumer`)

Columns 3-5 can be reordered or merged depending on the demo, but **never put compute infrastructure (SQL Warehouse) in the same column/tier as AI components (Genie, KA)**.

---

## Nodes

```json
{
  "id": "unique-id",
  "label": "Display Name",
  "icon": "deltaTable",
  "tier": "bronze",
  "desc": "Optional subtitle",
  "row": 0
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier (used in edges) |
| `label` | Yes | Display name |
| `icon` | Yes | Icon key (see Available Icons) |
| `tier` | Yes | Color scheme (see Available Tiers) |
| `desc` | No | Short description shown below label |
| `row` | No | Vertical position (auto-increments if omitted). Use decimals for fine positioning (e.g., `0.5`, `2.5`) |

**Consumer nodes:** Always use `"label": "Users"` with `"desc": "End Users"` -- never use specific people's names.

---

## Groups

Wrap nodes in a dashed border container. Use for "SDP Pipeline" groupings.

```json
{
  "group": { "label": "SDP Pipeline", "tier": "sdp" },
  "nodes": [
    { "id": "bronze", "label": "Bronze Layer", "icon": "deltaTable", "tier": "bronze" },
    { "id": "silver", "label": "Silver Layer", "icon": "deltaTable", "tier": "silver" },
    { "id": "gold", "label": "Gold Layer", "icon": "deltaTable", "tier": "gold" }
  ]
}
```

---

## Vertical Bars

Use for interface elements like "Databricks One":

```json
{
  "bars": [
    { "id": "db-one", "label": "Databricks One", "tier": "interface", "vertical": true }
  ]
}
```

---

## Foundation Bars

Horizontal bars at the bottom of the diagram. Use `startColumn` and `endColumn` to control which columns the bar spans (0-indexed):

```json
{
  "bars": [
    { "label": "Databricks Workflows — Orchestration", "tier": "orchestration", "startColumn": 1, "endColumn": 4 },
    { "label": "Unity Catalog — Governance & Security", "tier": "governance", "startColumn": 0, "endColumn": 6 }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `label` | Yes | Display text for the bar |
| `tier` | Yes | Color scheme (orchestration, governance) |
| `startColumn` | No | First column to span (0-indexed, default: 1 to skip sources) |
| `endColumn` | No | Last column to span (0-indexed, default: stops before interface/consumer) |

---

## Edges

```json
{
  "from": "source-node-id",
  "to": "target-node-id",
  "label": "Optional label",
  "animated": true
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `from` | Yes | Source node ID |
| `to` | Yes | Target node ID |
| `label` | No | Edge label (use sparingly) |
| `animated` | No | Animated dashed line for active data flow |

---

## Available Icons

| Icon | Use For |
|------|---------|
| `inputData` | External data sources, inputs |
| `unstructuredData` | Documents, PDFs, unstructured data |
| `lakeflowConnect` | Lakeflow Connect, data ingestion |
| `deltaTable` | Delta Tables (Bronze/Silver/Gold layers) |
| `data` | Generic data storage |
| `deltaLake` | Delta Lake |
| `sdpPipeline` | SDP Pipelines, streaming |
| `sqlWarehouse` | SQL Warehouse (compute) |
| `notebooks` | Databricks Notebooks (compute) |
| `jobsPipelines` | Jobs, Pipelines, Workflows (compute) |
| `dashboard` | AI/BI Dashboards, visualizations (analytics) |
| `genie` | AI/BI Genie, natural language analytics (AI) |
| `knowledgeAssistant` | Knowledge Assistant, document search (AI) |
| `multiAgentSupervisor` | Multi-Agent Supervisor, routing (AI) |
| `agents` | AI Agents (AI) |
| `mlModel` | ML Models (AI) |
| `modelServing` | Model serving endpoints (compute) |
| `aiGateway` | AI Gateway (AI) |
| `unityCatalog` | Unity Catalog, governance |
| `businessUser` | End users (consumer) |

---

## Available Tiers

**CRITICAL -- Use the correct tier for each component:**

| Tier | Color | Use For |
|------|-------|---------|
| `source` | Gray | External data sources (SQL Server, PostgreSQL, S3, APIs) |
| `bronze` | Bronze/copper | Bronze layer (raw ingested data) |
| `silver` | Silver/gray | Silver layer (cleaned/joined data) |
| `gold` | Gold/amber | Gold layer (analytics-ready data) |
| `compute` | Violet/purple | **SQL Warehouse, Notebooks, Jobs/Pipelines, Model Serving** |
| `analytics` | Pink | **AI/BI Dashboards, reports, BI visualizations** |
| `ai` | Indigo | **Genie, Knowledge Assistant, Multi-Agent Supervisor, ML Models, AI Agents** |
| `consumer` | Emerald green | End users |
| `sdp` | Teal | SDP Pipeline groups (wraps bronze/silver/gold) |
| `governance` | Dark slate | Unity Catalog foundation bar |
| `orchestration` | Sky blue | Databricks Workflows foundation bar |
| `interface` | Rose/pink | Databricks One vertical bar |
| `ingest` | Blue | Ingestion layer (if separate from sources) |

---

## Complete Example

This is a reference example. **Adapt to match your demo's actual components.**

```json
{
  "name": "Meridian Bank Fraud Investigation",
  "columns": [
    {
      "nodes": [
        { "id": "src-banking", "label": "Core Banking", "icon": "inputData", "tier": "source", "desc": "Transactions" },
        { "id": "src-processor", "label": "Card Processor", "icon": "inputData", "tier": "source", "desc": "Auth Data" },
        { "id": "src-salesforce", "label": "Salesforce", "icon": "inputData", "tier": "source", "desc": "Merchants" },
        { "id": "src-docs", "label": "Security Audits", "icon": "unstructuredData", "tier": "source", "desc": "PDF Reports", "row": 3.5 }
      ]
    },
    {
      "group": { "label": "SDP Pipeline", "tier": "sdp" },
      "nodes": [
        { "id": "bronze", "label": "Bronze Layer", "icon": "deltaTable", "tier": "bronze", "desc": "Raw Data" },
        { "id": "silver", "label": "Silver Layer", "icon": "deltaTable", "tier": "silver", "desc": "Cleaned" },
        { "id": "gold", "label": "Gold Layer", "icon": "deltaTable", "tier": "gold", "desc": "Analytics Ready" },
        { "id": "volume", "label": "Document Volume", "icon": "unstructuredData", "tier": "bronze", "desc": "Unstructured", "row": 3.5 }
      ]
    },
    {
      "nodes": [
        { "id": "warehouse", "label": "SQL Warehouse", "icon": "sqlWarehouse", "tier": "compute", "desc": "Serverless" }
      ]
    },
    {
      "nodes": [
        { "id": "dashboard", "label": "AI/BI Dashboard", "icon": "dashboard", "tier": "analytics" },
        { "id": "genie", "label": "AI/BI Genie", "icon": "genie", "tier": "ai", "desc": "Natural Language", "row": 1.5 },
        { "id": "ka", "label": "Knowledge Assistant", "icon": "knowledgeAssistant", "tier": "ai", "desc": "Doc Search", "row": 2.5 }
      ]
    },
    {
      "nodes": [
        { "id": "mas", "label": "Multi-Agent Supervisor", "icon": "multiAgentSupervisor", "tier": "ai", "desc": "Routing", "row": 1 }
      ]
    },
    {
      "bars": [
        { "id": "db-one", "label": "Databricks One", "tier": "interface", "vertical": true }
      ]
    },
    {
      "nodes": [
        { "id": "user", "label": "Users", "icon": "businessUser", "tier": "consumer", "desc": "End Users", "row": 1 }
      ]
    }
  ],
  "edges": [
    { "from": "src-banking", "to": "bronze", "label": "Lakeflow Connect", "animated": true },
    { "from": "src-processor", "to": "bronze", "animated": true },
    { "from": "src-salesforce", "to": "bronze", "animated": true },
    { "from": "src-docs", "to": "volume", "label": "Auto Loader", "animated": true },
    { "from": "bronze", "to": "silver", "animated": true },
    { "from": "silver", "to": "gold", "animated": true },
    { "from": "gold", "to": "warehouse" },
    { "from": "warehouse", "to": "dashboard" },
    { "from": "warehouse", "to": "genie" },
    { "from": "volume", "to": "ka" },
    { "from": "genie", "to": "mas" },
    { "from": "ka", "to": "mas" },
    { "from": "dashboard", "to": "db-one" },
    { "from": "mas", "to": "db-one" },
    { "from": "db-one", "to": "user" }
  ],
  "bars": [
    { "label": "Databricks Workflows — Orchestration", "tier": "orchestration", "startColumn": 1, "endColumn": 4 },
    { "label": "Unity Catalog — Governance & Security", "tier": "governance", "startColumn": 0, "endColumn": 6 }
  ]
}
```

---

## Best Practices

1. **Flow left-to-right**: Sources -> SDP -> Compute -> Analytics -> AI -> Consumer
2. **One tier per column**: Don't mix compute, analytics, and AI in the same column
3. **SDP Pipeline group**: Always wrap Bronze/Silver/Gold in a group with `"tier": "sdp"`
4. **Animated edges**: Use `"animated": true` for data ingestion flows
5. **Edge labels**: Use sparingly (e.g., "Lakeflow Connect", "Auto Loader")
6. **Foundation bars**: Include Unity Catalog and Databricks Workflows at bottom
7. **Databricks One**: Use vertical bar between AI and consumer
8. **Node descriptions**: Keep short (1-2 words)
9. **Consumer nodes**: Always use "Users" -- never use specific people's names
10. **Row positioning**: Use decimals (e.g., `0.5`) to center single nodes vertically

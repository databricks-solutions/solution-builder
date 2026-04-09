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

Columns are positioned automatically left-to-right (220px apart). Each column can contain nodes, vertical bars, or be wrapped in a group.

```json
{
  "columns": [
    { "nodes": [...] },
    { "group": {...}, "nodes": [...] },
    { "bars": [...] }
  ]
}
```

**Typical column order:**
1. Sources (external data)
2. SDP Pipeline (Bronze/Silver/Gold with group)
3. AI/Analytics (Dashboard, Genie, KA)
4. Orchestration (Multi-Agent Supervisor)
5. Interface (Databricks One vertical bar)
6. Consumer (Business user)

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
    { "label": "Databricks Workflows — Orchestration", "tier": "orchestration", "startColumn": 1, "endColumn": 3 },
    { "label": "Unity Catalog — Governance & Security", "tier": "governance", "startColumn": 0, "endColumn": 5 }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `label` | Yes | Display text for the bar |
| `tier` | Yes | Color scheme (orchestration, governance) |
| `startColumn` | No | First column to span (0-indexed, default: 1 to skip sources) |
| `endColumn` | No | Last column to span (0-indexed, default: stops before interface/consumer) |

**Typical usage**:
- Workflows: `startColumn: 1, endColumn: 3` — spans SDP to MAS (not sources or consumer)
- Unity Catalog: `startColumn: 0, endColumn: 5` — full width for governance

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
| `dashboard` | AI/BI Dashboards, visualizations |
| `genie` | AI/BI Genie, natural language analytics |
| `knowledgeAssistant` | Knowledge Assistant, document search |
| `multiAgentSupervisor` | Multi-Agent Supervisor, routing |
| `agents` | AI Agents |
| `deltaTable` | Delta Tables (Bronze/Silver/Gold layers) |
| `data` | Generic data storage |
| `unstructuredData` | Documents, PDFs, unstructured data |
| `inputData` | External data sources, inputs |
| `businessUser` | Business users, consumers |
| `lakeflowConnect` | Lakeflow Connect, data ingestion |
| `sqlWarehouse` | SQL Warehouse, compute |
| `jobsPipelines` | Jobs, Pipelines, Workflows |
| `notebooks` | Databricks Notebooks |
| `sdpPipeline` | SDP Pipelines, streaming |
| `unityCatalog` | Unity Catalog, governance |
| `mlModel` | ML Models |
| `modelServing` | Model serving endpoints |
| `aiGateway` | AI Gateway |
| `deltaLake` | Delta Lake |

---

## Available Tiers

| Tier | Color | Use For |
|------|-------|---------|
| `source` | Gray | External data sources |
| `bronze` | Bronze/copper | Bronze layer (raw data) |
| `silver` | Silver/gray | Silver layer (cleaned data) |
| `gold` | Gold/amber | Gold layer (analytics ready) |
| `ai` | Indigo/purple | AI components (Genie, KA, MAS, Dashboard) |
| `consumer` | Emerald green | End users |
| `sdp` | Teal | SDP Pipeline groups |
| `governance` | Dark slate | Unity Catalog foundation bar |
| `orchestration` | Sky blue | Databricks Workflows foundation bar |
| `interface` | Rose/pink | Databricks One vertical bar |
| `ingest` | Blue | Ingestion layer |

---

## Complete Example

This is a reference example. **Adapt to match your demo's actual components:**
- Include only the data sources, pipelines, and AI components your demo uses
- Match node labels/descriptions to your demo's tables, dashboards, and agents
- Adjust columns and edges to reflect your data flow

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
        { "id": "dashboard", "label": "AI/BI Dashboard", "icon": "dashboard", "tier": "ai" },
        { "id": "genie", "label": "AI/BI Genie", "icon": "genie", "tier": "ai", "desc": "Natural Language" },
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
        { "id": "user", "label": "Sarah Chen", "icon": "businessUser", "tier": "consumer", "desc": "VP Fraud Ops", "row": 0.5 }
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
    { "from": "gold", "to": "dashboard" },
    { "from": "gold", "to": "genie" },
    { "from": "volume", "to": "ka" },
    { "from": "genie", "to": "mas" },
    { "from": "ka", "to": "mas" },
    { "from": "dashboard", "to": "db-one" },
    { "from": "mas", "to": "db-one" },
    { "from": "db-one", "to": "user" }
  ],
  "bars": [
    { "label": "Databricks Workflows — Orchestration", "tier": "orchestration", "startColumn": 1, "endColumn": 3 },
    { "label": "Unity Catalog — Governance & Security", "tier": "governance", "startColumn": 0, "endColumn": 5 }
  ]
}
```

---

## Best Practices

1. **Flow left-to-right**: Sources → Processing → AI → Consumer
2. **SDP Pipeline group**: Always wrap Bronze/Silver/Gold in a group with `"tier": "sdp"`
3. **Animated edges**: Use `"animated": true` for data ingestion flows
4. **Edge labels**: Use sparingly (e.g., "Lakeflow Connect", "Auto Loader")
5. **Foundation bars**: Include Unity Catalog and Databricks Workflows at bottom
6. **Databricks One**: Use vertical bar between AI and consumer
7. **Node descriptions**: Keep short (1-2 words)
8. **Row positioning**: Use decimals (e.g., `0.5`) to center single nodes vertically

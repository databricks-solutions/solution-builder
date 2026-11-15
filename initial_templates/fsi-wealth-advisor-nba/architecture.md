# Advisor Morning Book Architecture

Next-best action with suitability guardrails for Calder Pine Private Wealth (fictional).

```json
[
  {
    "name": "Advisor Morning Book Platform",
    "story": "Calder Pine Private Wealth. Core banking/custody accounts, CRM advisor notes, market rates and the product & suitability policy library land in Unity Catalog. AI Functions read the CRM notes for life events and flight risk; gold tables compute money-in-motion signals. An XGBoost propensity model registered in UC ranks next-best actions; deterministic suitability rules (Reg BI) gate them. The Advisor Morning Book app (Lakebase) preps meetings with the Genie agent (tables + policy documents) and writes decisions back to Delta; the wealth desk uses the AI/BI dashboard and Genie.",
    "aspect": "16:9",
    "frame": {
      "title": "Advisor Morning Book",
      "subtitle": "Calder Pine Private Wealth: next-best action with suitability guardrails"
    },
    "theme": "slide",
    "direction": "horizontal",
    "columns": [
      "sources",
      "ingest",
      "data",
      "intelligence",
      "apps"
    ],
    "nodes": [
      {
        "id": "src-custody",
        "type": "source",
        "col": "sources",
        "row": 0,
        "label": "Custody",
        "icon": "database",
        "desc": "Accounts, CDs, sweep"
      },
      {
        "id": "src-crm",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "CRM Notes",
        "icon": "database",
        "desc": "Advisor call notes"
      },
      {
        "id": "src-policy",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "Policy Library",
        "icon": "pdfLogo",
        "desc": "Suitability, disclosures"
      },
      {
        "id": "setup-job",
        "type": "lakeflow-jobs",
        "col": "ingest",
        "row": 0,
        "label": "Nightly Job"
      },
      {
        "id": "ai-notes",
        "type": "information-extraction",
        "col": "ingest",
        "row": 1,
        "label": "AI Functions"
      },
      {
        "id": "gold",
        "type": "medallion-table",
        "col": "data",
        "row": 0,
        "params": {
          "bronze_desc": "Accounts, flows, notes",
          "silver_desc": "Households + events",
          "gold_desc": "Money-in-motion signals"
        },
        "label": "Wealth Lakehouse"
      },
      {
        "id": "policy-volume",
        "type": "uc-volume",
        "col": "data",
        "row": 3,
        "label": "Policy Docs"
      },
      {
        "id": "nba-model",
        "type": "ml-model",
        "col": "intelligence",
        "row": 0,
        "label": "NBA Model"
      },
      {
        "id": "dashboard",
        "type": "ai-bi-dashboard",
        "col": "intelligence",
        "row": 1,
        "label": "Desk Dashboard"
      },
      {
        "id": "genie-desk",
        "type": "genie",
        "col": "intelligence",
        "row": 2,
        "label": "Genie Agent"
      },
      {
        "id": "app",
        "type": "databricks-apps-work",
        "col": "apps",
        "row": 0,
        "label": "Morning Book"
      },
      {
        "id": "lakebase",
        "type": "lakebase",
        "col": "apps",
        "row": 1,
        "label": "Lakebase"
      },
      {
        "id": "platform-box",
        "type": "box",
        "wraps": [
          "gold",
          "policy-volume",
          "nba-model",
          "dashboard",
          "genie-desk",
          "app",
          "lakebase"
        ]
      },
      {
        "id": "governance-block",
        "type": "governance-block",
        "pin": {
          "at": "top-left",
          "to": "platform-box"
        },
        "params": {
          "access_control": true,
          "ai_gateway": true,
          "genie_ontology": false
        }
      },
      {
        "id": "db-platform",
        "type": "db-platform",
        "pin": {
          "at": "top-right",
          "to": "platform-box"
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "src-custody",
        "to": "setup-job",
        "flow": true
      },
      {
        "id": "e2",
        "from": "src-crm",
        "to": "ai-notes",
        "flow": true
      },
      {
        "id": "e3",
        "from": "src-policy",
        "to": "policy-volume",
        "label": "Policies",
        "flow": true
      },
      {
        "id": "e4",
        "from": "setup-job",
        "to": "gold",
        "flow": true
      },
      {
        "id": "e5",
        "from": "ai-notes",
        "to": "gold",
        "label": "Life events",
        "flow": true
      },
      {
        "id": "e6",
        "from": "gold@out-gold",
        "to": "nba-model",
        "flow": true
      },
      {
        "id": "e7",
        "from": "policy-volume",
        "to": "genie-desk",
        "label": "RAG source",
        "flow": true
      },
      {
        "id": "e9",
        "from": "nba-model",
        "to": "app",
        "label": "Suitable actions",
        "flow": true
      },
      {
        "id": "e10",
        "from": "genie-desk",
        "to": "app",
        "label": "Analytics + cited policy"
      },
      {
        "id": "e11",
        "from": "app",
        "to": "lakebase",
        "label": "Decisions + audit"
      },
      {
        "id": "e8",
        "from": "nba-model",
        "to": "dashboard",
        "flow": true,
        "label": "Scores"
      }
    ],
    "rowGrid": true
  }
]
```

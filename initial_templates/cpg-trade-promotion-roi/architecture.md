# Trade Promo Copilot Architecture

Trade promotion post-event ROI and promo re-planning for Crestwood Snacks Co. (fictional salty-snacks CPG).

```json
[
  {
    "name": "Trade Promo Copilot Platform",
    "story": "Crestwood Snacks Co. (salty-snacks CPG). Retailer POS sell-out, ERP shipments and the trade promotion management system land in Unity Catalog. A UC-registered ML baseline model learns what each SKU sells without a promotion; the gold layer nets every past event for pantry loading, cannibalization and forward buying into true ROI and forecasts next quarter's promo plan. The Trade Promo Copilot app flags the money-losing events with evidence, checks the trade policy and ValuMax JBP through the Genie agent (gold tables + policy documents), proposes a re-plan and writes the approved plan to Lakebase; finance tracks trade spend and ROI in an AI/BI dashboard and Genie.",
    "aspect": "16:9",
    "frame": {
      "title": "Trade Promo Copilot",
      "subtitle": "Crestwood Snacks: post-event ROI, promo plan forecast and approved re-plan"
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
        "id": "src-pos",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "Retailer POS",
        "desc": "Weekly sell-out"
      },
      {
        "id": "src-ship",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Shipments",
        "icon": "sap",
        "desc": "Sell-in, deal units"
      },
      {
        "id": "src-tpm",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "TPM system",
        "desc": "Events + plan"
      },
      {
        "id": "src-docs",
        "type": "source",
        "col": "sources",
        "row": 5,
        "label": "Trade policy",
        "icon": "pdfLogo",
        "desc": "TPG, JBP, terms"
      },
      {
        "id": "setup-job",
        "type": "lakeflow-jobs",
        "col": "ingest",
        "row": 1,
        "label": "Setup Job"
      },
      {
        "id": "ml-baseline",
        "type": "ml-model",
        "col": "ingest",
        "row": 2,
        "label": "ML Baseline"
      },
      {
        "id": "medallion",
        "type": "medallion-table",
        "col": "data",
        "row": 1,
        "params": {
          "bronze_desc": "POS, shipments, events",
          "silver_desc": "ML baseline",
          "gold_desc": "Event ROI + plan"
        }
      },
      {
        "id": "docs-volume",
        "type": "uc-volume",
        "col": "data",
        "row": 5,
        "label": "Policy Docs"
      },
      {
        "id": "dashboard",
        "type": "ai-bi-dashboard",
        "col": "intelligence",
        "row": 1,
        "label": "ROI Dashboard"
      },
      {
        "id": "genie",
        "type": "genie",
        "col": "intelligence",
        "row": 2,
        "label": "Genie Agent"
      },
      {
        "id": "app",
        "type": "databricks-apps-work",
        "col": "apps",
        "row": 1,
        "label": "Promo Copilot"
      },
      {
        "id": "lakebase",
        "type": "lakebase",
        "col": "apps",
        "row": 2,
        "label": "Approved Plan"
      },
      {
        "id": "genie-one",
        "type": "genie-one",
        "col": "apps",
        "row": 3,
        "rot": 90
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
      },
      {
        "id": "platform-box",
        "type": "box",
        "wraps": [
          "medallion",
          "docs-volume",
          "dashboard",
          "genie",
          "app",
          "lakebase",
          "genie-one"
        ]
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "src-pos",
        "to": "setup-job",
        "label": "Sell-out",
        "flow": true
      },
      {
        "id": "e2",
        "from": "src-ship",
        "to": "setup-job",
        "label": "Sell-in",
        "flow": true
      },
      {
        "id": "e3",
        "from": "src-tpm",
        "to": "setup-job",
        "label": "Promo events",
        "flow": true
      },
      {
        "id": "e4",
        "from": "src-docs@b",
        "to": "docs-volume@b",
        "label": "Upload docs",
        "flow": true
      },
      {
        "id": "e5",
        "from": "setup-job",
        "to": "ml-baseline",
        "label": "Clean weeks",
        "flow": true
      },
      {
        "id": "e6",
        "from": "ml-baseline",
        "to": "medallion",
        "label": "Baseline units",
        "flow": true
      },
      {
        "id": "e7",
        "from": "docs-volume",
        "to": "genie",
        "label": "RAG source",
        "flow": true
      },
      {
        "id": "e8",
        "from": "medallion@out-gold",
        "to": "dashboard",
        "label": "Event ROI",
        "flow": true
      },
      {
        "id": "e9",
        "from": "medallion@b",
        "to": "genie",
        "flow": true
      },
      {
        "id": "e10",
        "from": "medallion@out-gold",
        "to": "app@t",
        "label": "Plan forecast",
        "flow": true
      },
      {
        "id": "e11",
        "from": "genie",
        "to": "app@b",
        "label": "Cited policy"
      },
      {
        "id": "e12",
        "from": "app",
        "to": "lakebase",
        "label": "Write re-plan"
      },
      {
        "id": "e13",
        "from": "genie-one",
        "to": "app"
      }
    ]
  }
]
```

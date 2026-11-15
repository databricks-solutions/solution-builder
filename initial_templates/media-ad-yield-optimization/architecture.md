# Ad Yield Copilot Architecture

Ad yield & pricing optimization and make-good recovery for Aurora Crest Media (fictional broadcast + streaming network).

```json
[
  {
    "name": "Ad Yield Copilot Platform",
    "story": "Aurora Crest Media (fictional broadcast network ACN + Crest+ streaming + FAST channels). Ad-server delivery and auction logs, the IO / order-management system and the rate card land in a governed Unity Catalog medallion; ai_forecast projects daily avails per product. Gold tables track pacing and make-good liability per IO, spare avails per audience, and programmatic eCPM vs rate card per floor group. The Ad Yield Copilot app builds a recovery plan (live SQL + the Genie agent over the rate card, floor policy, make-good policy and IO documents), rebalances an under-delivering IO onto spare premium inventory, restores the mis-priced floor and writes the plan back to Lakebase; the SVP Ad Revenue uses the AI/BI dashboard and Genie.",
    "aspect": "16:9",
    "frame": {
      "title": "Ad Yield Copilot",
      "subtitle": "Aurora Crest Media: avails forecast, pacing risk, yield leaks and make-good recovery"
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
        "id": "src-claims",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "Ad server",
        "desc": "Delivery + auction logs",
        "icon": "inputData"
      },
      {
        "id": "src-telemetry",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Order system",
        "icon": "file:vendor/salesforce",
        "desc": "IOs + line items"
      },
      {
        "id": "src-genealogy",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "Rate card",
        "desc": "CPMs + floor rules",
        "icon": "csv"
      },
      {
        "id": "src-docs",
        "type": "source",
        "col": "sources",
        "row": 5,
        "label": "IO docs",
        "icon": "pdfLogo",
        "desc": "IO terms, make-good policy"
      },
      {
        "id": "lakeflow-job",
        "type": "lakeflow-jobs",
        "col": "ingest",
        "row": 1,
        "label": "Setup Job"
      },
      {
        "id": "ai-classify",
        "type": "ml-model",
        "col": "ingest",
        "row": 2,
        "label": "ai_forecast"
      },
      {
        "id": "medallion",
        "type": "medallion-table",
        "col": "data",
        "row": 1,
        "params": {
          "bronze_desc": "Delivery, auctions, IOs",
          "silver_desc": "Inventory ledger",
          "gold_desc": "Pacing + yield leaks"
        }
      },
      {
        "id": "docs-volume",
        "type": "uc-volume",
        "col": "data",
        "row": 5,
        "label": "Docs Volume"
      },
      {
        "id": "dashboard",
        "type": "ai-bi-dashboard",
        "col": "intelligence",
        "row": 1,
        "label": "Ad Revenue BI"
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
        "label": "Ad Yield Copilot"
      },
      {
        "id": "lakebase",
        "type": "lakebase",
        "col": "apps",
        "row": 2,
        "label": "Yield Plans"
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
        "from": "src-claims",
        "to": "lakeflow-job",
        "label": "Delivery logs",
        "flow": true
      },
      {
        "id": "e2",
        "from": "src-telemetry",
        "to": "lakeflow-job",
        "label": "IOs + lines",
        "flow": true
      },
      {
        "id": "e3",
        "from": "src-genealogy",
        "to": "lakeflow-job",
        "label": "Rate card",
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
        "from": "lakeflow-job",
        "to": "ai-classify",
        "flow": true
      },
      {
        "id": "e6",
        "from": "ai-classify",
        "to": "medallion",
        "label": "Avails forecast",
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
        "label": "Yield KPIs",
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
        "label": "Pacing + spare avails",
        "flow": true
      },
      {
        "id": "e11",
        "from": "genie",
        "to": "app@b",
        "label": "IO terms"
      },
      {
        "id": "e12",
        "from": "app",
        "to": "lakebase",
        "label": "Approve plan"
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

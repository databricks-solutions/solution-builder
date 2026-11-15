# Underwriting Copilot Architecture

Commercial P&C underwriting copilot for Tidewell Specialty Insurance (fictional). Broker PDF packets are parsed with
ai_parse_document and ai_query into structured SOV and loss-run tables; a UC-registered risk model scores every submission
as submitted vs verified; the Underwriting Copilot app (state in Lakebase) checks appetite, cites the guidelines Knowledge
Assistant, prices each location, refers to the CUO above authority and writes decisions back to Delta (uw_decisions),
which the portfolio dashboard and Genie read.

```json
[
  {
    "name": "Underwriting Copilot Platform",
    "story": "Tidewell Specialty Insurance (fictional) commercial P&C underwriting desk. Broker packets (application, statement of values, loss run PDFs) land in a UC volume; ai_parse_document + ai_query turn them into structured SOV and loss-run tables; a UC-registered risk model trained on Tidewell's own book scores every submission as submitted vs verified. Gold tables show the hail-belt habitational loss ratio deteriorating on old roofs. The Underwriting Copilot app (Lakebase state) reconciles the documents, checks appetite rules, asks the Genie agent about the underwriting-guideline documents, prices each location, refers to the CUO above authority and writes issued decisions back to Delta, where the portfolio dashboard and Genie read them.",
    "aspect": "16:9",
    "frame": {
      "title": "Underwriting Copilot",
      "subtitle": "Tidewell Specialty Insurance: commercial P&C submission triage, pricing and decisions"
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
        "id": "src-packets",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "Broker PDFs",
        "icon": "pdfLogo",
        "desc": "ACORD apps, SOVs, loss runs"
      },
      {
        "id": "src-book",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Policies",
        "icon": "text",
        "desc": "Policies, premium, claims"
      },
      {
        "id": "src-guides",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "Guidelines",
        "icon": "pdfLogo",
        "desc": "Appetite, rating, authority"
      },
      {
        "id": "setup-job",
        "type": "lakeflow-jobs",
        "col": "ingest",
        "row": 2,
        "label": "Setup job"
      },
      {
        "id": "ai-functions",
        "type": "information-extraction",
        "col": "ingest",
        "row": 1,
        "label": "Doc AI"
      },
      {
        "id": "medallion",
        "type": "medallion-table",
        "col": "data",
        "row": 1,
        "params": {
          "bronze_desc": "PDFs, policies, claims",
          "silver_desc": "SOV rows, loss runs",
          "gold_desc": "Loss ratios, triaged queue",
          "metric_views": false
        }
      },
      {
        "id": "ml-model",
        "type": "ml-model",
        "col": "data",
        "row": 2,
        "label": "Risk model"
      },
      {
        "id": "guide-volume",
        "type": "uc-volume",
        "col": "data",
        "row": 3,
        "label": "UC volume"
      },
      {
        "id": "genie",
        "type": "genie",
        "col": "intelligence",
        "row": 1,
        "label": "Genie Agent"
      },
      {
        "id": "dashboard",
        "type": "ai-bi-dashboard",
        "col": "intelligence",
        "row": 2,
        "label": "Dashboard"
      },
      {
        "id": "app",
        "type": "databricks-apps-work",
        "col": "apps",
        "row": 1,
        "label": "UW app"
      },
      {
        "id": "lakebase",
        "type": "lakebase",
        "col": "apps",
        "row": 2,
        "label": "Lakebase"
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
          "setup-job",
          "ai-functions",
          "medallion",
          "ml-model",
          "guide-volume",
          "genie",
          "dashboard",
          "app",
          "lakebase"
        ]
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "src-packets",
        "to": "ai-functions",
        "label": "PDFs",
        "flow": true
      },
      {
        "id": "e2",
        "from": "src-book",
        "to": "setup-job",
        "label": "Book of business",
        "flow": true
      },
      {
        "id": "e3",
        "from": "src-guides",
        "to": "guide-volume",
        "label": "Documents",
        "flow": true
      },
      {
        "id": "e4",
        "from": "ai-functions",
        "to": "medallion",
        "label": "SOV + loss runs",
        "flow": true
      },
      {
        "id": "e5",
        "from": "setup-job",
        "to": "medallion",
        "label": "Raw tables",
        "flow": true
      },
      {
        "id": "e6",
        "from": "ml-model",
        "to": "medallion",
        "label": "Risk scores"
      },
      {
        "id": "e7",
        "from": "guide-volume",
        "to": "genie",
        "label": "RAG source",
        "flow": true
      },
      {
        "id": "e8",
        "from": "medallion@out-gold",
        "to": "genie",
        "label": "Gold"
      },
      {
        "id": "e9",
        "from": "ml-model",
        "to": "dashboard",
        "label": "Scores + LR"
      },
      {
        "id": "e10",
        "from": "genie",
        "to": "app",
        "label": "Data + cited rules"
      },
      {
        "id": "e13",
        "from": "lakebase",
        "to": "app",
        "label": "Queue"
      }
    ]
  }
]
```

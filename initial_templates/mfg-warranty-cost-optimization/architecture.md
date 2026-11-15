# Warranty Copilot Architecture

Warranty cost optimization and quality-event root cause for Brightwater Cycle Works (fictional e-bike maker).

```json
[
  {
    "name": "Warranty Copilot Platform",
    "story": "Brightwater Cycle Works (e-bike maker). Dealer warranty claims with free-text technician notes, connected-bike telemetry and plant lot genealogy land in a governed Unity Catalog medallion; AI Functions classify every technician note into a failure mode. Gold tables detect emerging failures per 1,000 bike-years and project remaining-warranty exposure. The Warranty Copilot app assembles the root-cause case (live SQL + the Genie agent over PPAPs, PCNs and the supplier quality agreement), prices containment and writes the quality case to Lakebase; the VP Quality uses the AI/BI dashboard and Genie.",
    "aspect": "16:9",
    "frame": {
      "title": "Warranty Copilot",
      "subtitle": "Brightwater Cycle Works: early warning, root cause, containment and supplier recovery"
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
        "label": "Claims",
        "desc": "Dealer tech notes"
      },
      {
        "id": "src-telemetry",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Telemetry",
        "icon": "sensorSource",
        "desc": "Fault codes (E21)"
      },
      {
        "id": "src-genealogy",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "Plant MES",
        "desc": "Serial to lot"
      },
      {
        "id": "src-docs",
        "type": "source",
        "col": "sources",
        "row": 5,
        "label": "PPAP / PCN",
        "icon": "pdfLogo",
        "desc": "PPAP, PCN, SQA"
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
        "type": "information-extraction",
        "col": "ingest",
        "row": 2,
        "label": "AI Functions"
      },
      {
        "id": "medallion",
        "type": "medallion-table",
        "col": "data",
        "row": 1,
        "params": {
          "bronze_desc": "Claims, units, lots",
          "silver_desc": "AI failure modes",
          "gold_desc": "Signals + exposure"
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
        "label": "VP Dashboard"
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
        "label": "Warranty Copilot"
      },
      {
        "id": "lakebase",
        "type": "lakebase",
        "col": "apps",
        "row": 2,
        "label": "Quality Cases"
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
        "label": "Daily claims",
        "flow": true
      },
      {
        "id": "e2",
        "from": "src-telemetry",
        "to": "lakeflow-job",
        "label": "Fault events",
        "flow": true
      },
      {
        "id": "e3",
        "from": "src-genealogy",
        "to": "lakeflow-job",
        "label": "Lot genealogy",
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
        "label": "Classified notes",
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
        "label": "KPIs",
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
        "label": "Root-cause evidence",
        "flow": true
      },
      {
        "id": "e11",
        "from": "genie",
        "to": "app@b",
        "label": "Cited clauses"
      },
      {
        "id": "e12",
        "from": "app",
        "to": "lakebase",
        "label": "Open quality case"
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

# IROPS Copilot Architecture

Autonomous disruption response & rebooking for Aeralis Airways (fictional) during Winter Storm Harlan at Chicago O'Hare.
Reservations, flight-ops and passenger-message data land in Unity Catalog; AI Functions classify every message; a
UC-registered detractor-risk model scores every disrupted passenger; the IROPS Copilot app (state in Lakebase)
re-accommodates in priority order within cost guardrails, cites policy from the Genie agent's documents and, after Duty
Manager approval, writes the committed rebookings back to Delta (rebooking_plans / rebooking_decisions), which the ops
dashboard and Genie read.

```json
[
  {
    "name": "IROPS Copilot Platform",
    "story": "Aeralis Airways (fictional) IROPS desk during Winter Storm Harlan at Chicago O'Hare. Reservations, flight-ops and passenger-message data land in a governed Unity Catalog medallion; AI Functions classify every passenger message; a UC-registered detractor-risk model scores every disrupted passenger. The IROPS Copilot app (Lakebase state) re-accommodates passengers in priority order within cost guardrails, asks the policy Genie agent's policy documents (EU261/DOT/UMNR rules), drafts notifications, and after Duty Manager approval writes committed rebookings back to Delta, where the ops dashboard and Genie read them.",
    "aspect": "16:9",
    "frame": {
      "title": "IROPS Copilot",
      "subtitle": "Aeralis Airways: autonomous disruption response & rebooking"
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
        "id": "src-pss",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "PSS",
        "icon": "text",
        "desc": "PNRs, SSR codes, tiers"
      },
      {
        "id": "src-ops",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Flight ops",
        "icon": "text",
        "desc": "Cancellations, seats, hotels"
      },
      {
        "id": "src-msgs",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "Messages",
        "icon": "text",
        "desc": "SMS, app, social"
      },
      {
        "id": "src-policy",
        "type": "source",
        "col": "sources",
        "row": 4,
        "label": "Policy PDFs",
        "icon": "pdfLogo",
        "desc": "IROPS, EU261, DOT"
      },
      {
        "id": "setup-job",
        "type": "lakeflow-jobs",
        "col": "ingest",
        "row": 1,
        "label": "Setup job"
      },
      {
        "id": "ai-functions",
        "type": "information-extraction",
        "col": "ingest",
        "row": 3,
        "label": "AI Functions"
      },
      {
        "id": "medallion",
        "type": "medallion-table",
        "col": "data",
        "row": 1,
        "params": {
          "bronze_desc": "Flights, PNRs, messages",
          "silver_desc": "AutoProtect holds",
          "gold_desc": "Recovery KPIs",
          "metric_views": true
        }
      },
      {
        "id": "ml-model",
        "type": "ml-model",
        "col": "data",
        "row": 3,
        "label": "Risk model"
      },
      {
        "id": "policy-volume",
        "type": "uc-volume",
        "col": "data",
        "row": 4,
        "label": "Policy volume"
      },
      {
        "id": "genie-ops",
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
        "label": "Ops dashboard"
      },
      {
        "id": "irops-app",
        "type": "databricks-apps-work",
        "col": "apps",
        "row": 1,
        "label": "IROPS app"
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
          "policy-volume",
          "genie-ops",
          "dashboard",
          "irops-app",
          "lakebase"
        ]
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "src-pss",
        "to": "setup-job",
        "label": "Bookings",
        "flow": true
      },
      {
        "id": "e2",
        "from": "src-ops",
        "to": "setup-job",
        "label": "Disruption",
        "flow": true
      },
      {
        "id": "e3",
        "from": "src-msgs",
        "to": "ai-functions",
        "label": "Messages",
        "flow": true
      },
      {
        "id": "e4",
        "from": "src-policy",
        "to": "policy-volume",
        "label": "Documents",
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
        "from": "ai-functions",
        "to": "medallion",
        "label": "Intent + urgency",
        "flow": true
      },
      {
        "id": "e7",
        "from": "ml-model",
        "to": "medallion",
        "label": "Risk scores"
      },
      {
        "id": "e8",
        "from": "policy-volume",
        "to": "genie-ops",
        "label": "RAG source",
        "flow": true
      },
      {
        "id": "e9",
        "from": "medallion@out-gold",
        "to": "genie-ops"
      },
      {
        "id": "e10",
        "from": "medallion@out-mv",
        "to": "dashboard"
      },
      {
        "id": "e11",
        "from": "medallion@out-gold",
        "to": "lakebase"
      },
      {
        "id": "e12",
        "from": "genie-ops",
        "to": "irops-app",
        "label": "Cited rules"
      },
      {
        "id": "e15",
        "from": "lakebase",
        "to": "irops-app",
        "label": "Seats"
      }
    ]
  }
]
```

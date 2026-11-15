```json
[
 {
  "name": "AML / SAR Copilot \u2014 Northwind Federal",
  "aspect": "16:9",
  "story": "Core-banking transactions, KYC and the rules-based TMS alert feed land in the lakehouse. Gold features + an entity-resolution network feed a GradientBoosting alert-risk model registered in Unity Catalog, which re-ranks the investigator queue. The Databricks App gives investigators the ML queue, the network graph and a SAR-drafting agent (Foundation Model API + tools on UC + the Genie agent for policy search over the documents volume); decisions are written back to Delta. Compliance leadership reads the same governed tables through an AI/BI dashboard and Genie.",
  "columns": [
   "sources",
   "pipeline",
   "lake",
   "ai",
   "apps"
  ],
  "nodes": [
   {
    "id": "src-core",
    "type": "source",
    "col": "sources",
    "row": 1,
    "label": "Core banking",
    "icon": "inputData",
    "desc": "Cash, wires, ACH, P2P"
   },
   {
    "id": "src-kyc",
    "type": "source",
    "col": "sources",
    "row": 2,
    "label": "KYC / CIF",
    "icon": "inputData",
    "desc": "Risk rating, identifiers"
   },
   {
    "id": "src-tms",
    "type": "source",
    "col": "sources",
    "row": 3,
    "label": "TMS alerts",
    "icon": "inputData",
    "desc": "Rules engine output"
   },
   {
    "id": "src-policy",
    "type": "source",
    "col": "sources",
    "row": 4,
    "label": "AML policy library",
    "icon": "pdfLogo",
    "desc": "BSA policy, red flags"
   },
   {
    "id": "lakeflow-genie-block",
    "type": "lakeflow-genie-block",
    "col": "pipeline",
    "desc": "Features, entity network and KPIs built into governed gold tables."
   },
   {
    "id": "sql-lakehouse",
    "type": "sql-lakehouse",
    "col": "lake",
    "row": 1,
    "desc": "Gold alert features, networks, queue + write-back case tables."
   },
   {
    "id": "uc-volume",
    "type": "uc-volume",
    "col": "lake",
    "row": 3,
    "desc": "Policy docs"
   },
   {
    "id": "ml-model",
    "type": "ml-model",
    "col": "ai",
    "row": 1,
    "label": "Alert-risk model",
    "desc": "P(SAR) re-ranks the queue"
   },
   {
    "id": "genie",
    "type": "genie",
    "col": "ai",
    "row": 2,
    "desc": "Data + policy documents",
    "label": "Genie Agent"
   },
   {
    "id": "databricks-apps",
    "type": "databricks-apps",
    "col": "apps",
    "row": 1,
    "label": "Investigator Copilot",
    "desc": "Queue, network, SAR agent"
   },
   {
    "id": "ai-bi-dashboard",
    "type": "ai-bi-dashboard",
    "col": "apps",
    "row": 2,
    "desc": "FP rate, SLA to file"
   },
   {
    "id": "governance-block",
    "type": "governance-block",
    "pin": {
     "at": "top-right",
     "to": "platform-box"
    }
   },
   {
    "id": "platform-box",
    "type": "box",
    "z": -1,
    "pad": 40,
    "wraps": [
     "src-core",
     "src-kyc",
     "src-tms",
     "src-policy",
     "lakeflow-genie-block",
     "sql-lakehouse",
     "uc-volume",
     "ml-model",
     "genie",
     "databricks-apps",
     "ai-bi-dashboard"
    ]
   }
  ],
  "edges": [
   {
    "id": "e1",
    "from": "src-core",
    "to": "lakeflow-genie-block@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e2",
    "from": "src-kyc",
    "to": "lakeflow-genie-block@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e3",
    "from": "src-tms",
    "to": "lakeflow-genie-block@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e4",
    "from": "src-policy",
    "to": "uc-volume",
    "flow": true
   },
   {
    "id": "e5",
    "from": "lakeflow-genie-block",
    "to": "sql-lakehouse",
    "flow": true
   },
   {
    "id": "e6",
    "from": "sql-lakehouse",
    "to": "ml-model",
    "label": "train + score"
   },
   {
    "id": "e7",
    "from": "uc-volume",
    "to": "genie"
   },
   {
    "id": "e8",
    "from": "sql-lakehouse",
    "to": "genie"
   },
   {
    "id": "e9",
    "from": "ml-model",
    "to": "databricks-apps",
    "label": "ranked queue"
   },
   {
    "id": "e10",
    "from": "genie",
    "to": "databricks-apps",
    "label": "policy search"
   }
  ],
  "direction": "horizontal",
  "frame": {
   "title": "AML monitoring & SAR automation \u2014 Northwind Federal",
   "subtitle": "ML-ranked alert queue \u00b7 entity networks \u00b7 SAR-drafting agent \u00b7 governed write-back"
  }
 }
]```

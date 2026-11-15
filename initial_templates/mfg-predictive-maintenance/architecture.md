```json
[
 {
  "name": "Predictive maintenance control room",
  "story": "Robot/CNC telemetry streams in via Zerobus while the CMMS (SAP PM) and MES land via Lakeflow Connect and the plant manuals land as files. One Lakeflow + Genie pipeline builds the governed medallion (OEE, MTBF, condition features). A failure-risk model registered in Unity Catalog scores the fleet daily; the Genie agent indexes the manuals; Genie and an AI/BI dashboard serve the plant manager. The PdM Control Room app (Lakebase) lets the reliability engineer's copilot explain the risk and book work orders + parts back into Lakebase. Out of scope: real-time model serving (scoring is batch/daily) and the OT network edge.",
  "aspect": "16:9",
  "theme": "slide",
  "direction": "horizontal",
  "options": {
   "trademarkLogos": false
  },
  "frame": {
   "title": "TechRobotics \u2014 Predictive Maintenance Control Room",
   "subtitle": "Sensor drift + maintenance history + manuals \u2192 explain the risk \u2192 book the fix"
  },
  "columns": [
   "sources",
   "data",
   "intel",
   "serve",
   "entry"
  ],
  "nodes": [
   {
    "id": "src-telemetry",
    "type": "source",
    "col": "sources",
    "row": 3,
    "label": "Robot & CNC telemetry",
    "icon": "sensorSource"
   },
   {
    "id": "src-cmms",
    "type": "source",
    "col": "sources",
    "row": 1,
    "label": "SAP PM (CMMS)",
    "icon": "file:vendor/sap"
   },
   {
    "id": "src-mes",
    "type": "source",
    "col": "sources",
    "row": 2,
    "label": "MES counts",
    "icon": "text"
   },
   {
    "id": "src-manuals",
    "type": "source",
    "col": "sources",
    "row": 4,
    "label": "Manuals + CAPAs",
    "icon": "pdfLogo"
   },
   {
    "id": "lakeflow-genie-block",
    "type": "lakeflow-genie-block",
    "col": "data",
    "row": 1,
    "params": {
     "gold_desc": "OEE \u00b7 MTBF \u00b7 features"
    }
   },
   {
    "id": "risk-model",
    "type": "ml-training-serving",
    "col": "intel",
    "row": 1,
    "label": "Failure-risk model",
    "ai_reasoning": "batch daily scoring; registered in UC as failure_risk_model@champion; writes asset_risk_scores back to gold"
   },
   {
    "id": "sql-lakehouse",
    "type": "sql-lakehouse",
    "col": "intel",
    "row": 2
   },
   {
    "id": "lakebase",
    "type": "lakebase",
    "col": "intel",
    "row": 3
   },
   {
    "id": "dash",
    "type": "ai-bi-dashboard",
    "col": "serve",
    "row": 1,
    "label": "Plant OEE dashboard"
   },
   {
    "id": "genie",
    "type": "genie",
    "col": "serve",
    "row": 2,
    "label": "Genie Agent"
   },
   {
    "id": "app",
    "type": "databricks-apps-work",
    "col": "serve",
    "row": 3,
    "label": "PdM Control Room",
    "ai_reasoning": "the copilot (Agents SDK) calls the Genie agent (tables + manuals) and writes work orders to Lakebase"
   },
   {
    "id": "genie-one",
    "type": "genie-one",
    "col": "entry",
    "rot": 90
   },
   {
    "id": "db-platform",
    "type": "db-platform",
    "pin": {
     "at": "top-left",
     "to": "platform-box"
    }
   },
   {
    "id": "governance-block",
    "type": "governance-block",
    "pin": {
     "at": "top-right",
     "to": "platform-box"
    },
    "params": {
     "genie_ontology": false
    }
   },
   {
    "id": "platform-box",
    "type": "box",
    "wraps": [
     "lakeflow-genie-block",
     "risk-model",
     "sql-lakehouse",
     "lakebase",
     "dash",
     "genie",
     "app",
     "genie-one"
    ]
   }
  ],
  "edges": [
   {
    "id": "e1",
    "from": "src-telemetry",
    "to": "lakeflow-genie-block@in-zerobus",
    "flow": true
   },
   {
    "id": "e2",
    "from": "src-cmms",
    "to": "lakeflow-genie-block@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e3",
    "from": "src-mes",
    "to": "lakeflow-genie-block@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e4",
    "from": "src-manuals",
    "to": "lakeflow-genie-block@in-direct",
    "flow": true
   },
   {
    "id": "e5",
    "from": "lakeflow-genie-block",
    "to": "risk-model",
    "flow": true,
    "label": "Train + score daily"
   },
   {
    "id": "e6",
    "from": "lakeflow-genie-block",
    "to": "sql-lakehouse",
    "flow": true
   },
   {
    "id": "e7",
    "from": "lakeflow-genie-block",
    "to": "genie",
    "flow": true,
    "label": "Manuals volume"
   },
   {
    "id": "e8",
    "from": "lakeflow-genie-block",
    "to": "lakebase",
    "flow": true,
    "label": "Sync fleet + parts"
   },
   {
    "id": "e9",
    "from": "sql-lakehouse",
    "to": "dash",
    "flow": true
   },
   {
    "id": "e10",
    "from": "sql-lakehouse",
    "to": "genie",
    "flow": true
   },
   {
    "id": "e11",
    "from": "lakebase",
    "to": "app",
    "arrow": "both",
    "label": "Book WO + parts"
   },
   {
    "id": "e12",
    "from": "genie",
    "to": "app",
    "label": "Why (cited)"
   },
   {
    "id": "e13",
    "from": "genie-one",
    "to": "dash"
   },
   {
    "id": "e14",
    "from": "genie-one",
    "to": "genie"
   },
   {
    "id": "e15",
    "from": "genie-one",
    "to": "app"
   }
  ]
 }
]```

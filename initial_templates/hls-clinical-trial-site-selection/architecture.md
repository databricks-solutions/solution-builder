```json
[
 {
  "name": "Trial Site Copilot",
  "story": "EDC screening logs, CTMS site milestones, de-identified EHR-network catchment counts and the protocol documents land in governed Delta tables. AI Functions (ai_classify, ai_query) read the coordinators' free-text screen-fail notes; a site enrollment model registered in Unity Catalog scores every network site under the current and amended protocol; the Genie agent answers from the gold tables and the protocol, SAP and amendment SOP documents. The Trial Site Copilot app (Lakebase) runs the rescue analysis, projects last-patient-in and records the study manager's approved plan. The portfolio dashboard and Genie read the same gold tables.",
  "aspect": "16:9",
  "theme": "slide",
  "direction": "horizontal",
  "options": {
   "trademarkLogos": false
  },
  "frame": {
   "title": "Halcyra Therapeutics — Trial Site Copilot"
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
    "id": "src-edc",
    "type": "source",
    "col": "sources",
    "row": 1,
    "label": "EDC screens",
    "icon": "inputData"
   },
   {
    "id": "src-ctms",
    "type": "source",
    "col": "sources",
    "row": 2,
    "label": "CTMS sites",
    "icon": "inputData"
   },
   {
    "id": "src-ehr",
    "type": "source",
    "col": "sources",
    "row": 3,
    "label": "EHR counts",
    "icon": "unstructuredData"
   },
   {
    "id": "src-docs",
    "type": "source",
    "col": "sources",
    "row": 4,
    "label": "Protocol docs",
    "icon": "pdfLogo"
   },
   {
    "id": "lakeflow",
    "type": "lakeflow-genie-block",
    "col": "data",
    "row": 1
   },
   {
    "id": "ai-fn",
    "type": "information-extraction",
    "col": "intel",
    "row": 1,
    "label": "AI Functions",
    "desc": ""
   },
   {
    "id": "model",
    "type": "ml-model",
    "col": "intel",
    "row": 2,
    "label": "Site model"
   },
   {
    "id": "genie",
    "type": "genie",
    "col": "intel",
    "row": 3,
    "label": "Genie Agent"
   },
   {
    "id": "app",
    "type": "databricks-apps-work",
    "col": "serve",
    "row": 1,
    "label": "Site Copilot"
   },
   {
    "id": "lakebase",
    "type": "lakebase",
    "col": "serve",
    "row": 2
   },
   {
    "id": "dash",
    "type": "ai-bi-dashboard",
    "col": "serve",
    "row": 3,
    "label": "Dashboard"
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
    }
   },
   {
    "id": "platform-box",
    "type": "box",
    "wraps": [
     "lakeflow",
     "ai-fn",
     "model",
     "genie",
     "app",
     "lakebase",
     "dash",
     "genie-one"
    ]
   }
  ],
  "edges": [
   {
    "id": "e1",
    "from": "src-edc",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e2",
    "from": "src-ctms",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e3",
    "from": "src-ehr",
    "to": "lakeflow@in-lakeflow-connect",
    "flow": true
   },
   {
    "id": "e4",
    "from": "src-docs",
    "to": "lakeflow@in-direct",
    "flow": true
   },
   {
    "id": "e5",
    "from": "lakeflow",
    "to": "ai-fn",
    "flow": true,
    "label": "Screen-fail notes"
   },
   {
    "id": "e6",
    "from": "lakeflow",
    "to": "model",
    "flow": true,
    "label": "Site history"
   },
   {
    "id": "e7",
    "from": "lakeflow",
    "to": "genie",
    "flow": true
   },
   {
    "id": "e8",
    "from": "model",
    "to": "lakebase",
    "flow": true,
    "label": "Site scores"
   },
   {
    "id": "e9",
    "from": "genie",
    "to": "app",
    "label": "Cited guidance"
   },
   {
    "id": "e10",
    "from": "app",
    "to": "lakebase",
    "label": "Rescue plan decisions",
    "arrow": "both"
   },
   {
    "id": "e11",
    "from": "lakeflow",
    "to": "dash",
    "flow": true
   },
   {
    "id": "e12",
    "from": "genie-one",
    "to": "app"
   },
   {
    "id": "e13",
    "from": "genie-one",
    "to": "dash"
   }
  ]
 }
]```

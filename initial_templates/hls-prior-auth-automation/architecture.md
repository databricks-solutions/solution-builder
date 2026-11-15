[
  {
    "name": "PA Copilot",
    "story": "MedVault ingests PA requests from providers and clinical notes into UC Delta tables via a Lakeflow Job (synthetic data generator). AI Functions (ai_query) batch-evaluate requests against medical policy criteria, producing evidence and routing decisions to Lakebase. The PA Copilot app provides nurses a workbench to review cases with cited evidence, approve, pend or refer to a Medical Director (automation approves only), and write decisions back to Lakebase and Delta. Operations dashboard and Genie space surface CMS KPIs and ad-hoc queries. All governed by Unity Catalog.",
    "aspect": "16:9",
    "theme": "slide",
    "direction": "horizontal",
    "options": {
      "trademarkLogos": false
    },
    "frame": {
      "title": "MedVault PA Copilot Architecture"
    },
    "columns": [
      "sources",
      "processing",
      "intelligence",
      "operations",
      "apps"
    ],
    "rowGrid": true,
    "rowGap": 84,
    "nodes": [
      {
        "id": "src-pa",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "PA Requests",
        "icon": "text",
        "desc": "Portal, fax, ePA",
        "showDesc": true
      },
      {
        "id": "src-clinical",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Clinical Notes",
        "icon": "pdfLogo"
      },
      {
        "id": "src-policies",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "Policies",
        "icon": "text"
      },
      {
        "id": "datagen-job",
        "type": "lakeflow-jobs",
        "col": "processing",
        "row": 1,
        "label": "Data Gen Job",
        "desc": "Synthetic generator",
        "showDesc": true,
        "ai_reasoning": "Lakeflow orchestration job: runs Python generator to synthesize PA request data into UC Delta tables."
      },
      {
        "id": "delta-tables",
        "type": "sql-lakehouse",
        "col": "processing",
        "row": 2,
        "label": "Delta Tables",
        "desc": "pa_requests, clinical_notes, criteria, refs",
        "showDesc": true,
        "ai_reasoning": "UC Delta tables: pa_requests, clinical_notes, policy_criteria, members, providers, reviewers."
      },
      {
        "id": "ai-query-review",
        "type": "information-extraction",
        "col": "intelligence",
        "row": 2,
        "label": "ai_query Review",
        "desc": "AI Functions batch evaluation",
        "showDesc": true,
        "ai_reasoning": "AI Functions batch job: databricks-gpt-5-4-mini evaluates clinical notes against each policy criterion → ai_case_review + ai_criteria_evidence (Met/Not Met/Not Documented with verbatim quotes). Routes to auto-approval / nurse fast-track / request-info / physician-review lanes."
      },
      {
        "id": "metric-view",
        "type": "medallion-table",
        "col": "intelligence",
        "row": 1,
        "label": "Metrics View",
        "desc": "CMS-0057-F KPIs",
        "showDesc": true,
        "params": {
          "metric_views": true
        },
        "ai_reasoning": "UC metric view over Delta tables: 72-hour compliance, approval rate by decision type, provider benchmarks."
      },
      {
        "id": "genie-space",
        "type": "genie",
        "col": "intelligence",
        "row": 3,
        "label": "Genie Agent",
        "desc": "Ad-hoc PA queries",
        "showDesc": true
      },
      {
        "id": "lakebase-queue",
        "type": "lakebase",
        "col": "operations",
        "row": 2,
        "label": "Work Queue",
        "desc": "Lakebase + um_decisions",
        "showDesc": true,
        "ai_reasoning": "Postgres: mirrors live PA work queue. Nurse writes decisions back; also appended to Delta um_decisions table for audit."
      },
      {
        "id": "pa-copilot",
        "type": "databricks-apps-work",
        "col": "apps",
        "row": 1,
        "label": "PA Copilot",
        "desc": "Workbench + agent",
        "showDesc": true,
        "ai_reasoning": "Node.js/React app: worklist from Lakebase; case review UI with cited evidence; decision write-back. Internal agent (FMAPI databricks-gpt-5-4) with tools: queue ops on Lakebase, ask_data → the Genie agent (tables + policy documents)."
      },
      {
        "id": "dashboard",
        "type": "ai-bi-dashboard",
        "col": "apps",
        "row": 2,
        "label": "Dashboard",
        "desc": "CMS compliance",
        "showDesc": true
      },
      {
        "id": "genie-one",
        "type": "genie-one",
        "col": "apps",
        "row": 3,
        "rot": 90,
        "ai_reasoning": "Entry point for VP UM Operations, Medical Director. Persona built in."
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
        "pad": 40,
        "wraps": [
          "datagen-job",
          "delta-tables",
          "ai-query-review",
          "metric-view",
          "genie-space",
          "lakebase-queue",
          "pa-copilot",
          "dashboard",
          "genie-one"
        ]
      }
    ],
    "edges": [
      {
        "id": "e-pa-intake",
        "from": "src-pa",
        "to": "datagen-job@l",
        "flow": true,
        "label": "PA submissions"
      },
      {
        "id": "e-clinical-intake",
        "from": "src-clinical",
        "to": "datagen-job@l",
        "flow": true,
        "label": "Clinical notes"
      },
      {
        "id": "e-policies-intake",
        "from": "src-policies",
        "to": "datagen-job@l",
        "flow": true,
        "label": "Policies"
      },
      {
        "id": "e-job-to-delta",
        "from": "datagen-job",
        "to": "delta-tables",
        "flow": true,
        "label": "Synthetic data"
      },
      {
        "id": "e-delta-to-review",
        "from": "delta-tables",
        "to": "ai-query-review",
        "flow": true,
        "label": "PA requests + notes"
      },
      {
        "id": "e-delta-to-metrics",
        "from": "delta-tables",
        "to": "metric-view",
        "flow": true,
        "label": "Request data"
      },
      {
        "id": "e-delta-to-genie",
        "from": "delta-tables",
        "to": "genie-space",
        "flow": true,
        "label": "Tables"
      },
      {
        "id": "e-review-to-queue",
        "from": "ai-query-review",
        "to": "lakebase-queue",
        "flow": true,
        "label": "Decisions"
      },
      {
        "id": "e-queue-to-app",
        "from": "lakebase-queue",
        "to": "pa-copilot",
        "flow": true,
        "label": "Work queue"
      },
      {
        "id": "e-app-to-queue",
        "from": "pa-copilot",
        "to": "lakebase-queue",
        "flow": true,
        "label": "→ um_decisions",
        "arrow": "start",
        "dashed": true
      },
      {
        "id": "e-metrics-to-dashboard",
        "from": "metric-view@out-mv",
        "to": "dashboard",
        "flow": true,
        "label": "KPIs"
      },
      {
        "id": "e-genie-to-app",
        "from": "genie-space",
        "to": "pa-copilot",
        "label": "ask_data"
      },
      {
        "id": "e-genie-one-app",
        "from": "genie-one",
        "to": "pa-copilot"
      },
      {
        "id": "e-genie-one-dashboard",
        "from": "genie-one",
        "to": "dashboard"
      },
      {
        "id": "e-genie-one-genie",
        "from": "genie-one",
        "to": "genie-space"
      },
      {
        "id": "e-gov-acl",
        "from": "governance-block@acl-b",
        "to": "delta-tables@t",
        "label": "Access control"
      }
    ]
  }
]


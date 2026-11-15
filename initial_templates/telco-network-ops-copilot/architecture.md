# NOC Copilot Architecture

Halcyon Wireless (fictional) — alarm correlation, KPI anomaly detection and agentic triage for the NOC.

```json
[
  {
    "name": "NOC Copilot Platform",
    "story": "Halcyon Wireless (fictional regional carrier). Hourly RAN KPIs for 1,500 cells, alarm events from the RAN + transport NMS and 15-minute optical counters stream into a Lakeflow Spark Declarative Pipeline (bronze → silver → gold) in Unity Catalog. A KPI anomaly model (Isolation Forest registered in UC) flags cells degrading with no alarm; topology correlation groups hundreds of alarms into one incident per root-cause candidate. The NOC Copilot app (Lakebase for incidents + trouble tickets) runs a triage agent that walks the topology with governed SQL, asks the Genie agent about the NOC runbooks and proposes one parent ticket with a field dispatch; the engineer opens it. Network ops leadership tracks availability, alarms and MTTR in an AI/BI dashboard and Genie.",
    "aspect": "16:9",
    "frame": {
      "title": "NOC Copilot",
      "subtitle": "Alarm correlation, anomaly detection, agentic triage"
    },
    "theme": "slide",
    "direction": "horizontal",
    "columns": [
      "sources",
      "ingest",
      "data",
      "ai",
      "apps"
    ],
    "nodes": [
      {
        "id": "src-ran",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "RAN KPIs",
        "icon": "cloud"
      },
      {
        "id": "src-alarms",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "NMS Alarms",
        "icon": "cloud"
      },
      {
        "id": "src-runbook",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "Runbooks",
        "icon": "pdfLogo"
      },
      {
        "id": "ingest-sdp",
        "type": "sdp",
        "col": "ingest",
        "row": 1,
        "label": "Lakeflow SDP"
      },
      {
        "id": "lakehouse",
        "type": "medallion-table",
        "col": "data",
        "row": 1,
        "params": {
          "bronze_desc": "Raw KPIs, alarms, optics",
          "silver_desc": "Typed + topology",
          "gold_desc": "Cell KPIs, site status",
          "metric_views": true
        }
      },
      {
        "id": "runbook-volume",
        "type": "uc-volume",
        "col": "data",
        "row": 3,
        "label": "Runbook Volume"
      },
      {
        "id": "anomaly",
        "type": "model-training",
        "col": "ai",
        "row": 1,
        "label": "Anomaly Model"
      },
      {
        "id": "genie-noc",
        "type": "genie",
        "col": "ai",
        "row": 2,
        "label": "Genie Agent"
      },
      {
        "id": "copilot-app",
        "type": "databricks-apps-work",
        "col": "apps",
        "row": 2,
        "label": "NOC Copilot App"
      },
      {
        "id": "lakebase",
        "type": "lakebase",
        "col": "apps",
        "row": 1,
        "label": "Lakebase"
      },
      {
        "id": "ops-dashboard",
        "type": "ai-bi-dashboard",
        "col": "data",
        "row": 2,
        "label": "Ops Dashboard"
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
          "lakehouse",
          "runbook-volume",
          "anomaly",
          "genie-noc",
          "copilot-app",
          "lakebase",
          "ops-dashboard"
        ]
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "src-ran",
        "to": "ingest-sdp",
        "label": "Streaming telemetry",
        "flow": true
      },
      {
        "id": "e2",
        "from": "src-alarms",
        "to": "ingest-sdp",
        "flow": true
      },
      {
        "id": "e3",
        "from": "src-runbook",
        "to": "runbook-volume",
        "label": "Runbook docs",
        "flow": true
      },
      {
        "id": "e4",
        "from": "ingest-sdp",
        "to": "lakehouse",
        "flow": true
      },
      {
        "id": "e5",
        "from": "lakehouse@out-gold",
        "to": "anomaly",
        "label": "Cell KPIs",
        "flow": true
      },
      {
        "id": "e6",
        "from": "anomaly",
        "to": "lakebase",
        "label": "Incident queue",
        "flow": true
      },
      {
        "id": "e7",
        "from": "lakehouse@out-mv",
        "to": "genie-noc",
        "label": "Network questions",
        "flow": true
      },
      {
        "id": "e8",
        "from": "runbook-volume",
        "to": "genie-noc",
        "label": "RAG source",
        "flow": true
      },
      {
        "id": "e9",
        "from": "genie-noc",
        "to": "copilot-app",
        "label": "Cited runbook steps"
      },
      {
        "id": "e11",
        "from": "copilot-app",
        "to": "lakebase",
        "label": "Tickets, dispatch, audit"
      },
      {
        "id": "e12",
        "from": "lakehouse@out-gold",
        "to": "ops-dashboard",
        "label": "Availability, MTTR",
        "flow": true
      }
    ]
  },
  {
    "name": "Triage Agent",
    "story": "Detail: the engineer clicks Triage on the alarm-storm incident. The agent reads the correlated incident (457 alarms, 64 of 68 sites under AGG-DEN-04 down), walks the topology (primary + secondary fiber, 4 sites with microwave backup), reads the optics (LOS on both ends of the primary = span cut; the backup optic has been losing light for 12 days), finds the 811 boring notice on the primary route, sizes the impact (~100k subscribers, a hospital, a 911 center), asks the runbook for the dual-path procedure and dispatches a transport technician to the hut and the splicing crew to the cut. The engineer opens one parent ticket in Lakebase.",
    "aspect": "16:9",
    "frame": {
      "title": "One storm, one ticket",
      "subtitle": "Each hop is governed SQL chosen from the last result"
    },
    "theme": "slide",
    "direction": "horizontal",
    "columns": [
      "incident",
      "topology",
      "evidence",
      "runbook",
      "decide"
    ],
    "nodes": [
      {
        "id": "s-inc",
        "type": "shape",
        "shape": "rounded",
        "col": "incident",
        "row": 1,
        "text": "Storm incident\n457 alarms"
      },
      {
        "id": "s-topo",
        "type": "shape",
        "shape": "rounded",
        "col": "topology",
        "row": 1,
        "text": "AGG-DEN-04:\n64 of 68 down"
      },
      {
        "id": "s-mw",
        "type": "shape",
        "shape": "rounded",
        "col": "topology",
        "row": 2,
        "text": "4 survive on\nmicrowave"
      },
      {
        "id": "s-optics",
        "type": "shape",
        "shape": "rounded",
        "col": "evidence",
        "row": 1,
        "text": "Primary LOS\nboth ends"
      },
      {
        "id": "s-backup",
        "type": "shape",
        "shape": "rounded",
        "col": "evidence",
        "row": 2,
        "text": "Backup optic\n-21 dBm"
      },
      {
        "id": "s-runbook",
        "type": "shape",
        "shape": "document",
        "col": "runbook",
        "row": 1,
        "text": "NOC runbook\n(Genie agent)"
      },
      {
        "id": "s-plan",
        "type": "shape",
        "shape": "hexagon",
        "col": "runbook",
        "row": 2,
        "text": "Impact +\ndispatch"
      },
      {
        "id": "s-ticket",
        "type": "shape",
        "shape": "rounded",
        "col": "decide",
        "row": 1,
        "text": "Engineer opens\n1 ticket"
      },
      {
        "id": "s-lakebase",
        "type": "shape",
        "shape": "cylinder",
        "col": "decide",
        "row": 2,
        "text": "Lakebase\nticket + audit"
      }
    ],
    "edges": [
      {
        "id": "w1",
        "from": "s-inc",
        "to": "s-topo",
        "label": "Parent"
      },
      {
        "id": "w2",
        "from": "s-topo",
        "to": "s-mw",
        "label": "Survivors"
      },
      {
        "id": "w3",
        "from": "s-topo",
        "to": "s-optics",
        "label": "Uplinks"
      },
      {
        "id": "w4",
        "from": "s-optics",
        "to": "s-backup",
        "label": "Failover"
      },
      {
        "id": "w5",
        "from": "s-optics",
        "to": "s-runbook",
        "label": "Procedure?"
      },
      {
        "id": "w6",
        "from": "s-backup",
        "to": "s-plan",
        "label": "Evidence"
      },
      {
        "id": "w7",
        "from": "s-runbook",
        "to": "s-ticket",
        "label": "Dual-path"
      },
      {
        "id": "w8",
        "from": "s-plan",
        "to": "s-ticket",
        "label": "Submit"
      },
      {
        "id": "w9",
        "from": "s-ticket",
        "to": "s-lakebase",
        "label": "Write"
      }
    ]
  }
]
```

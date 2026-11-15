# Threat Hunting Copilot Architecture

Cascadia SOC (fictional) — UEBA + agentic investigation for the Department of Revenue.

```json
[
  {
    "name": "Threat Hunting Copilot Platform",
    "story": "Cascadia SOC (fictional state agency, Department of Revenue). Identity-provider sign-ins, VPN, EDR and DNS telemetry plus SIEM alerts land in a governed Unity Catalog lakehouse. A UEBA Isolation Forest (registered in UC) scores every user and host daily and raises the lead queue. The Threat Hunting Copilot app (Lakebase for leads + incident cases) runs an investigation agent that pivots across the logs with governed SQL, asks the Genie agent about the IR playbook, maps the chain to MITRE ATT&CK and proposes containment; the analyst opens the case. The CISO tracks MTTD / MTTR, alert noise and ATT&CK coverage in an AI/BI dashboard and Genie.",
    "aspect": "16:9",
    "frame": {
      "title": "Threat Hunting Copilot",
      "subtitle": "Cascadia SOC: UEBA + agentic investigation on the lakehouse"
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
        "id": "src-identity",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "Identity logs",
        "icon": "cloud"
      },
      {
        "id": "src-endpoint",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Endpoint logs",
        "icon": "cloud"
      },
      {
        "id": "src-playbook",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "IR Playbook",
        "icon": "pdfLogo"
      },
      {
        "id": "ingest-job",
        "type": "lakeflow-jobs",
        "col": "ingest",
        "row": 1,
        "label": "Setup Job"
      },
      {
        "id": "lakehouse",
        "type": "medallion-table",
        "col": "data",
        "row": 1,
        "params": {
          "bronze_desc": "Raw security logs",
          "silver_desc": "Normalized events",
          "gold_desc": "UEBA features + leads",
          "metric_views": true
        }
      },
      {
        "id": "playbook-volume",
        "type": "uc-volume",
        "col": "data",
        "row": 3,
        "label": "Playbook"
      },
      {
        "id": "ueba",
        "type": "model-training",
        "col": "ai",
        "row": 1,
        "label": "UEBA Model"
      },
      {
        "id": "genie-soc",
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
        "label": "Copilot App"
      },
      {
        "id": "lakebase",
        "type": "lakebase",
        "col": "apps",
        "row": 1,
        "label": "Lakebase"
      },
      {
        "id": "ciso-dashboard",
        "type": "ai-bi-dashboard",
        "col": "data",
        "row": 2,
        "label": "CISO Dashboard"
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
          "playbook-volume",
          "ueba",
          "genie-soc",
          "copilot-app",
          "lakebase",
          "ciso-dashboard"
        ]
      }
    ],
    "edges": [
      {
        "id": "e1",
        "from": "src-identity",
        "to": "ingest-job",
        "label": "Auth + VPN logs",
        "flow": true
      },
      {
        "id": "e2",
        "from": "src-endpoint",
        "to": "ingest-job",
        "label": "Endpoint + DNS",
        "flow": true
      },
      {
        "id": "e3",
        "from": "src-playbook",
        "to": "playbook-volume",
        "label": "Playbook docs",
        "flow": true
      },
      {
        "id": "e4",
        "from": "ingest-job",
        "to": "lakehouse",
        "flow": true
      },
      {
        "id": "e5",
        "from": "lakehouse@out-gold",
        "to": "ueba",
        "label": "Features",
        "flow": true
      },
      {
        "id": "e6",
        "from": "ueba",
        "to": "lakebase",
        "label": "Leads",
        "flow": true
      },
      {
        "id": "e7",
        "from": "lakehouse@out-mv",
        "to": "genie-soc",
        "label": "SOC questions",
        "flow": true
      },
      {
        "id": "e8",
        "from": "playbook-volume",
        "to": "genie-soc",
        "label": "RAG source",
        "flow": true
      },
      {
        "id": "e9",
        "from": "genie-soc",
        "to": "copilot-app",
        "label": "Analytics + cited playbook steps"
      },
      {
        "id": "e11",
        "from": "copilot-app",
        "to": "lakebase",
        "label": "Leads, cases, audit"
      },
      {
        "id": "e12",
        "from": "lakehouse@out-gold",
        "to": "ciso-dashboard",
        "label": "MTTD, noise, coverage",
        "flow": true
      }
    ]
  },
  {
    "name": "Investigation Agent",
    "story": "Detail: the analyst clicks Investigate on a UEBA lead. The agent reads the lead, pivots from the account to the attacker IP range (212 accounts sprayed), to VPN sessions from an unmanaged PC, to the finance workstation it RDP'd into, to that host's DNS (beaconing + TXT tunneling), asks the IR playbook for severity, notifications and containment, then submits a timeline mapped to ATT&CK. The analyst selects containment actions and opens the incident case in Lakebase.",
    "aspect": "16:9",
    "frame": {
      "title": "One lead, end to end",
      "subtitle": "Each pivot is governed SQL chosen from the last result"
    },
    "theme": "slide",
    "direction": "horizontal",
    "columns": [
      "lead",
      "identity",
      "host",
      "playbook",
      "decide"
    ],
    "nodes": [
      {
        "id": "s-lead",
        "type": "shape",
        "shape": "rounded",
        "col": "lead",
        "row": 1,
        "text": "UEBA lead\nrisk 99.6"
      },
      {
        "id": "s-signins",
        "type": "shape",
        "shape": "rounded",
        "col": "identity",
        "row": 1,
        "text": "Sign-ins:\nMFA fatigue"
      },
      {
        "id": "s-spray",
        "type": "shape",
        "shape": "rounded",
        "col": "identity",
        "row": 2,
        "text": "IP range:\n212 accounts"
      },
      {
        "id": "s-vpn",
        "type": "shape",
        "shape": "rounded",
        "col": "host",
        "row": 1,
        "text": "VPN + RDP to\nWS-FIN-022"
      },
      {
        "id": "s-dns",
        "type": "shape",
        "shape": "rounded",
        "col": "host",
        "row": 2,
        "text": "DNS beacon +\nTXT tunnel"
      },
      {
        "id": "s-playbook",
        "type": "shape",
        "shape": "document",
        "col": "playbook",
        "row": 1,
        "text": "IR playbook\n(Genie agent)"
      },
      {
        "id": "s-attack",
        "type": "shape",
        "shape": "hexagon",
        "col": "playbook",
        "row": 2,
        "text": "Timeline\n+ ATT&CK"
      },
      {
        "id": "s-case",
        "type": "shape",
        "shape": "rounded",
        "col": "decide",
        "row": 1,
        "text": "Analyst opens\ncase"
      },
      {
        "id": "s-lakebase",
        "type": "shape",
        "shape": "cylinder",
        "col": "decide",
        "row": 2,
        "text": "Lakebase\ncase + audit"
      }
    ],
    "edges": [
      {
        "id": "w1",
        "from": "s-lead",
        "to": "s-signins",
        "label": "Pivot"
      },
      {
        "id": "w2",
        "from": "s-signins",
        "to": "s-spray",
        "label": "Source IP"
      },
      {
        "id": "w3",
        "from": "s-signins",
        "to": "s-vpn",
        "label": "Sessions"
      },
      {
        "id": "w4",
        "from": "s-vpn",
        "to": "s-dns",
        "label": "Host"
      },
      {
        "id": "w5",
        "from": "s-vpn",
        "to": "s-playbook",
        "label": "Severity?"
      },
      {
        "id": "w6",
        "from": "s-dns",
        "to": "s-attack",
        "label": "Evidence"
      },
      {
        "id": "w7",
        "from": "s-playbook",
        "to": "s-case",
        "label": "Containment"
      },
      {
        "id": "w8",
        "from": "s-attack",
        "to": "s-case",
        "label": "Submit"
      },
      {
        "id": "w9",
        "from": "s-case",
        "to": "s-lakebase",
        "label": "Write"
      }
    ]
  }
]```

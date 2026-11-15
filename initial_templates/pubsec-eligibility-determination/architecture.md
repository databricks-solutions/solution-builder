# Eligibility Copilot Architecture

AI-enabled SNAP/Medicaid eligibility determination for Westbrook Department of Human Services (WDHS).

```json
[
  {
    "name": "Eligibility Copilot Platform",
    "story": "Westbrook Department of Human Services. Ingest SNAP/Medicaid applications + verification documents (OCR) + policy manual into a governed UC medallion. AI extract enriches applications with document data. the Genie agent grounds eligibility determinations in the policy manual. Caseworkers use the Eligibility Copilot app (rules + the Genie agent + Claude draft notices); program director monitors timeliness + equity via dashboard + Genie. Genie One fronts both.",
    "aspect": "16:9",
    "frame": {
      "title": "Eligibility Copilot",
      "subtitle": "Westbrook DHS: AI-enabled SNAP/Medicaid determination"
    },
    "theme": "slide",
    "direction": "horizontal",
    "columns": ["sources", "ingest", "data", "intelligence", "apps"],
    "nodes": [
      {
        "id": "src-benefits-portal",
        "type": "source",
        "col": "sources",
        "row": 1,
        "label": "Benefits Portal",
        "icon": "text",
        "desc": "SNAP + Medicaid applications"
      },
      {
        "id": "src-documents",
        "type": "source",
        "col": "sources",
        "row": 2,
        "label": "Verification Docs",
        "icon": "pdfLogo",
        "desc": "Paystubs, IDs, leases"
      },
      {
        "id": "src-policy",
        "type": "source",
        "col": "sources",
        "row": 3,
        "label": "Policy Manual",
        "icon": "pdfLogo",
        "desc": "Rules + federal guidelines"
      },
      {
        "id": "lakeflow-job",
        "type": "lakeflow-jobs",
        "col": "ingest",
        "row": 1
      },
      {
        "id": "ai-extract",
        "type": "information-extraction",
        "col": "ingest",
        "row": 2,
        "label": "Document Extraction"
      },
      {
        "id": "medallion",
        "type": "medallion-table",
        "col": "data",
        "row": 1,
        "params": {
          "bronze_desc": "Raw applications",
          "silver_desc": "Cleaned + conformed",
          "gold_desc": "Eligibility-ready"
        }
      },
      {
        "id": "policy-volume",
        "type": "uc-volume",
        "col": "data",
        "row": 2,
        "label": "Policy Volume"
      },
      {
        "id": "dashboard-timeliness",
        "type": "ai-bi-dashboard",
        "col": "intelligence",
        "row": 1,
        "label": "Timeliness & Equity"
      },
      {
        "id": "genie-operations",
        "type": "genie",
        "col": "intelligence",
        "row": 2,
        "label": "Genie Agent"
      },
      {
        "id": "eligibility-app",
        "type": "databricks-apps-work",
        "col": "apps",
        "row": 1,
        "label": "Eligibility Copilot"
      },
      {
        "id": "genie-one",
        "type": "genie-one",
        "col": "apps",
        "row": 2,
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
        "wraps": ["medallion", "policy-volume", "dashboard-timeliness", "genie-operations", "eligibility-app", "genie-one"]
      }
    ],
    "edges": [
      {
        "id": "e-portal-ingest",
        "from": "src-benefits-portal",
        "to": "lakeflow-job",
        "label": "Application data",
        "flow": true
      },
      {
        "id": "e-docs-ingest",
        "from": "src-documents",
        "to": "lakeflow-job",
        "label": "Upload",
        "flow": true
      },
      {
        "id": "e-policy-volume",
        "from": "src-policy",
        "to": "policy-volume",
        "label": "Load policy",
        "flow": true,
        "centerX": 2200
      },
      {
        "id": "e-job-extract",
        "from": "lakeflow-job",
        "to": "ai-extract",
        "flow": true
      },
      {
        "id": "e-extract-medallion",
        "from": "ai-extract",
        "to": "medallion",
        "label": "Enriched documents",
        "flow": true
      },
      {
        "id": "e-medallion-genie",
        "from": "medallion",
        "to": "genie-operations",
        "label": "Query context",
        "flow": true
      },
      {
        "id": "e-medallion-dashboard",
        "from": "medallion",
        "to": "dashboard-timeliness",
        "label": "Metrics",
        "flow": true
      },
      {
        "id": "e-medallion-app",
        "from": "medallion",
        "to": "eligibility-app",
        "label": "Caseload",
        "flow": true
      },
      {
        "id": "e-policy-genie",
        "from": "policy-volume",
        "to": "genie-operations",
        "label": "Policy docs",
        "flow": true
      },
      {
        "id": "e-genie-app",
        "from": "genie-operations",
        "to": "eligibility-app",
        "label": "Guidance"
      },
      {
        "id": "e-genie-one-app",
        "from": "genie-one",
        "to": "eligibility-app"
      },
      {
        "id": "e-genie-one-dashboard",
        "from": "genie-one",
        "to": "dashboard-timeliness"
      },
      {
        "id": "e-genie-one-genie",
        "from": "genie-one",
        "to": "genie-operations"
      }
    ]
  },
  {
    "name": "Per-Case Eligibility Check",
    "story": "Detail: caseworker opens a case in the Eligibility Copilot app. System retrieves verified documents, ai_extract enriches with verified income/household, deterministic rules are applied, the Genie agent consulted on the policy manual for edge cases, Claude drafts plain-language notice. Caseworker reviews + decides; decision written to Lakebase with full audit trail.",
    "aspect": "16:9",
    "frame": {
      "title": "Per-Case Eligibility Determination",
      "subtitle": "Workflow inside the Eligibility Copilot"
    },
    "theme": "slide",
    "direction": "horizontal",
    "columns": ["case", "extract", "determine", "draft", "decide"],
    "nodes": [
      {
        "id": "step-case-open",
        "type": "shape",
        "shape": "rounded",
        "col": "case",
        "row": 1,
        "text": "Caseworker\nopens case",
        "size": [200, 90]
      },
      {
        "id": "step-load-docs",
        "type": "shape",
        "shape": "document",
        "col": "case",
        "row": 2,
        "text": "Load verification\ndocs"
      },
      {
        "id": "step-extract",
        "type": "shape",
        "shape": "rounded",
        "col": "extract",
        "row": 1,
        "text": "ai_extract:\nincome, household"
      },
      {
        "id": "step-rules",
        "type": "shape",
        "shape": "diamond",
        "col": "determine",
        "row": 1,
        "text": "Meets\nincome\nlimit?"
      },
      {
        "id": "step-consult-policy",
        "type": "shape",
        "shape": "rounded",
        "col": "determine",
        "row": 2,
        "text": "Ask Genie agent:\npolicy edge cases"
      },
      {
        "id": "step-claude-draft",
        "type": "shape",
        "shape": "document",
        "col": "draft",
        "row": 1,
        "text": "Claude drafts\nnotice"
      },
      {
        "id": "step-review",
        "type": "shape",
        "shape": "hexagon",
        "col": "decide",
        "row": 1,
        "text": "Review\n+ edit",
        "size": [180, 90]
      },
      {
        "id": "step-decide",
        "type": "shape",
        "shape": "rounded",
        "col": "decide",
        "row": 2,
        "text": "Record\ndecision"
      },
      {
        "id": "step-audit",
        "type": "shape",
        "shape": "cylinder",
        "col": "decide",
        "row": 3,
        "text": "Lakebase\naudit log"
      },
      {
        "id": "note-realtime",
        "type": "note",
        "text": "End-to-end ~10 sec; full audit trail in Lakebase",
        "below": "step-decide",
        "gap": 24
      }
    ],
    "edges": [
      {
        "id": "e-open-docs",
        "from": "step-case-open",
        "to": "step-load-docs",
        "label": "Fetch"
      },
      {
        "id": "e-docs-extract",
        "from": "step-load-docs",
        "to": "step-extract",
        "label": "Upload"
      },
      {
        "id": "e-extract-rules",
        "from": "step-extract",
        "to": "step-rules",
        "label": "Facts"
      },
      {
        "id": "e-yes",
        "from": "step-rules",
        "to": "step-claude-draft",
        "label": "Yes"
      },
      {
        "id": "e-edge-case",
        "from": "step-rules",
        "to": "step-consult-policy",
        "label": "Edge case?"
      },
      {
        "id": "e-policy-draft",
        "from": "step-consult-policy",
        "to": "step-claude-draft",
        "label": "Policy context"
      },
      {
        "id": "e-draft-review",
        "from": "step-claude-draft",
        "to": "step-review",
        "label": "Generate"
      },
      {
        "id": "e-review-decide",
        "from": "step-review",
        "to": "step-decide",
        "label": "Approve"
      },
      {
        "id": "e-decide-audit",
        "from": "step-decide",
        "to": "step-audit",
        "label": "Write"
      }
    ]
  }
]
```

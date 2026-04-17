---
name: Databricks Apps
category: apps-infra
disabled: false
buildable: true
skill: databricks-app-python
---

# Databricks Apps

## What It Does

Databricks Apps deploy full-stack web applications (FastAPI + React, Streamlit, or Gradio) directly on the Databricks platform with built-in OAuth, SQL warehouse connectivity, and resource bindings. They provide custom UI experiences beyond what dashboards and Genie offer.

## When to Use in a Demo

- When the demo needs a custom interactive experience: forms, workflows, approval screens, real-time monitoring, or multi-step wizards.
- When the audience cares about "what would this look like for my end users?" — an app provides a polished, branded interface.
- NOT needed for every demo — dashboards + Genie + supervisor cover most stories. Add an app only when it demonstrably adds value.

## Key Configuration Decisions

1. **Framework choice:** Use FastAPI + React for full-stack apps with custom UI. Use Streamlit or Gradio for quick prototypes or data-science-focused audiences.
2. **OAuth model:** Choose between app-level auth (service principal — app acts as itself) and user-level auth (passthrough — app acts as the logged-in user). User-level is more secure for demos with row-level access control.
3. **Resource bindings:** Declare SQL warehouses, serving endpoints, Lakebase databases as app resources — never hardcode connection strings. The ai-dev-kit skill handles `app.yaml` configuration.
4. **Backend routes:** Keep the API surface small — 3-5 endpoints for a demo.
5. **Frontend components:** Use 2-4 screens for a demo app — don't over-scope the UI.

## Common Pitfalls

- Building an app when a dashboard would suffice — apps are higher effort. Make sure the custom UI is justified.
- Hardcoding warehouse IDs or endpoint URLs instead of using resource bindings.
- Forgetting OAuth token refresh — use the SDK's built-in token management.
- Over-scoping the UI — a demo app should have 2-4 screens, not 15.
- Not testing the app deployment before the demo — `databricks apps deploy` can surface configuration issues.

## How It Connects to Other Components

- **SQL warehouse:** Backend queries Gold tables via SQL warehouse resource bindings.
- **Model serving:** Backend calls serving endpoints for real-time predictions.
- **Lakebase:** Backend reads/writes operational state to Lakebase PostgreSQL.
- **Dashboard/Genie:** The app can embed or link to dashboards and Genie spaces for the analytical layer.

## Example Specification Snippet

```yaml
databricks_app:
  name: "fraud-investigation-console"
  framework: fastapi-react
  auth: user_passthrough
  resources:
    - sql_warehouse: "fraud-demo-warehouse"
    - serving_endpoint: "fraud-scoring-endpoint"
    - lakebase: "fraud-ops-db"
  backend_routes:
    - GET /api/alerts: "Fetch active fraud alerts from Gold tables"
    - POST /api/score: "Score a transaction via serving endpoint"
    - POST /api/actions: "Record investigation action to Lakebase"
  frontend_screens:
    - "Alert Dashboard — active fraud alerts with severity indicators"
    - "Investigation Detail — transaction timeline, risk factors, documents"
    - "Action Panel — block card, flag merchant, escalate case"
```

## URL

https://www.databricks.com/product/databricks-apps

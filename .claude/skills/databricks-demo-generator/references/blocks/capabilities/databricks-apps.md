---
name: Databricks Apps
category: apps-infra
disabled: false
buildable: true
skill: databricks-app-python
---

# Databricks Apps

Full-stack web applications (FastAPI + React, Streamlit, or Gradio) deployed on Databricks with built-in OAuth, SQL warehouse connectivity, and resource bindings. Custom UI beyond dashboards and Genie.

## When to Use

- When the demo needs custom interactive experience: forms, workflows, approval screens, real-time monitoring, multi-step wizards.
- When audience cares about end-user experience — an app provides a polished, branded interface.
- NOT needed for every demo — dashboards + Genie + supervisor cover most stories. Add only when it demonstrably adds value.

## Key Decisions

1. **Framework:** FastAPI + React for full-stack with custom UI. Streamlit/Gradio for quick prototypes or data-science audiences.
2. **OAuth model:** App-level (service principal — app acts as itself) vs user-level (passthrough — acts as logged-in user). User-level better for row-level access control demos.
3. **Resource bindings:** Declare SQL warehouses, serving endpoints, Lakebase databases as app resources — never hardcode connection strings. The ai-dev-kit skill handles `app.yaml` config.
4. **Backend routes:** Small API surface — 3-5 endpoints for a demo.
5. **Frontend:** 2-4 screens for a demo app — don't over-scope.

## Pitfalls

- Building an app when a dashboard suffices — apps are higher effort. Justify the custom UI.
- Hardcoding warehouse IDs or endpoint URLs instead of resource bindings.
- Forgetting OAuth token refresh — use SDK's built-in token management.
- Over-scoping — demo app should have 2-4 screens, not 15.
- Not testing deployment before the demo — `databricks apps deploy` can surface config issues; smoke-test once after the build.

## Connections

- **SQL warehouse:** Backend queries Gold tables via SQL warehouse resource bindings.
- **Model serving:** Backend calls serving endpoints for real-time predictions.
- **Lakebase:** Backend reads/writes operational state to Lakebase PostgreSQL.
- **Dashboard/Genie:** App can embed or link to dashboards and Genie spaces for the analytical layer.

## URL

https://www.databricks.com/product/databricks-apps

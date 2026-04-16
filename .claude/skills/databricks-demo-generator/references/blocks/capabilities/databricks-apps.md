---
name: Databricks Apps
category: apps-infra
disabled: false
buildable: true
---

# Databricks Apps

**Serverless app runtime** on the lakehouse: build secure internal data/AI apps in Python or JS, governed by Unity Catalog and SSO.

## Pain

Most POCs die as notebooks and dashboards. Turning them into apps means new infra (Kubernetes, API gateways, auth, logging) and a new project with security/IT. Business users never get a "real" tool - just exports and screenshots.

## Key Features

- **No infra** - serverless, managed runtime
- **Python & JS** - Streamlit, Gradio, Dash, React
- **UC integration** - app inherits data permissions
- **SSO/OAuth** - enterprise auth out of the box
- **Secrets management** - secure credential handling

## Position

Last 5 minutes of demo: the pipeline/model you just built appears as a real app ("RM Copilot", "Claims Triage App") with auth and governance. "We don't just make insights - we ship internal products."

## How It Works

- **Pick a framework**: Streamlit, Gradio, Dash, Flask, or React — write your app code
- **Deploy with one command**: `databricks apps deploy` — no Docker, no Kubernetes, no infra config
- **Runs on serverless**: Databricks provisions compute, handles scaling, manages the runtime
- **Gets a unique URL**: Share with users immediately — SSO/OAuth authentication included
- **UC-governed data access**: App has its own service principal — you grant it access to specific UC objects
- **Secrets management**: Store credentials securely, reference them in your app

## Demo Tips

- Perfect for the "and here's the app" finale
- Position as "from notebook to product" — the last mile
- Great for operational apps: copilots, triage tools, approval workflows
- Emphasize governance: "same permissions as the underlying data"

## URL

https://www.databricks.com/product/databricks-apps

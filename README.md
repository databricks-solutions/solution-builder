# Demo Asset Builder

A full-stack Databricks App for building personalized demo packages. Describe a customer scenario and an AI agent — powered by the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) and [Databricks AI Dev Kit](https://github.com/databricks/ai-dev-kit) — designs the architecture, generates specification files, writes code, and deploys real assets (tables, pipelines, dashboards, agents) on a live workspace.

Built with FastAPI + React/Vite and deployed as a Databricks App with Lakebase (managed PostgreSQL) for persistence.

## Quick start — deploy to Databricks

The entire app deploys as a [Databricks Asset Bundle](https://docs.databricks.com/dev-tools/bundles/index.html) — Lakebase database, Databricks App, and source code in one command.

### Prerequisites

- [Databricks CLI](https://docs.databricks.com/dev-tools/cli/index.html) v0.239.0+
- A Databricks workspace with a Foundation Model serving endpoint (default: `databricks-claude-sonnet-4-6`)

### Deploy

```bash
git clone https://github.com/databricks-field-eng/industry-demo-prompts.git
cd industry-demo-prompts/app

# Authenticate with your workspace
databricks auth login --host https://<workspace-url> --profile MY_WORKSPACE

# Deploy (creates Lakebase instance + Databricks App)
databricks bundle deploy -t dev --profile MY_WORKSPACE

# Start the app
databricks bundle run demo-prompt-generator-app -t dev --profile MY_WORKSPACE
```

### Verify

```bash
databricks apps get demo-asset-builder -p MY_WORKSPACE
# app_status.state should be "RUNNING"
```

The DAB configures `CAN_CONNECT_AND_CREATE` permission on the Lakebase database, so the app's service principal can create tables automatically on first startup.

### Bundle variables

Override per-target or via CLI:

| Variable | Default | Description |
|----------|---------|-------------|
| `llm_endpoint` | `databricks-claude-sonnet-4-6` | Foundation Model serving endpoint for LLM calls |

```bash
# Example: use a different model endpoint
databricks bundle deploy -t dev --var llm_endpoint=databricks-meta-llama-3-3-70b-instruct
```

### Deploy targets

| Target | Mode | Use case |
|--------|------|----------|
| `dev` (default) | `development` | Personal development & testing |
| `prod` | `production` | Shared production deployment |

Add workspace-specific targets by extending `databricks.yml`:

```yaml
targets:
  my-workspace:
    workspace:
      profile: MY_WORKSPACE   # maps to [MY_WORKSPACE] in ~/.databrickscfg
    variables:
      llm_endpoint: "databricks-meta-llama-3-3-70b-instruct"
```

## How it works

1. **Describe a scenario** — enter a customer use case (e.g., "predictive maintenance for wind turbines") or start from a template in the gallery.
2. **Project creation** — the app creates a project workspace, auto-assigns compute resources, and provisions a local directory with AI Dev Kit skills.
3. **Chat with the agent** — an AI agent (Claude via the Agent SDK) designs the demo interactively. It generates a README, architecture diagram, instruction specs, source code, and a DAB bundle — all as files in the project.
4. **Build pipeline** — the project progresses through stages: `DRAFTING` → `SUMMARIZED` → `ARCHITECTED` → `SPECIFICATION` → `BUILT` → `BUNDLED`. Each stage is gated by the presence of specific files.
5. **Deploy** — the agent deploys assets to your Databricks workspace using the AI Dev Kit CLI tools. Deployed resources (dashboards, pipelines, Genie spaces, etc.) are tracked and linked from the UI.
6. **Share & reuse** — publish finished projects as templates that others can fork from the gallery.

### Context blocks

Knowledge is decomposed into **blocks** — small, reusable Markdown files with YAML frontmatter stored in `.claude/skills/databricks-demo-generator/references/blocks/`. Blocks come in three categories:

- **Domain** — industry vertical context (terminology, KPIs, personas, pain points). Examples: `financial-services`, `healthcare`, `manufacturing`, `retail`.
- **Capability** — Databricks feature guidance (architecture patterns, configuration, best practices). Examples: `sdp`, `genie`, `aibi-dashboards`, `vector-search`, `lakebase`, `supervisor-agent`.
- **Pattern** — cross-industry analytical patterns (methodology, algorithm choices, evaluation criteria). Examples: `anomaly-detection`, `customer-segmentation`, `predictive-maintenance`.

Blocks are injected into the agent's system prompt as structured context, giving it deep knowledge of Databricks features and industry domains without fine-tuning.

### Templates

The gallery contains reusable templates — published project snapshots that can be forked as a starting point. Templates go through an admin review workflow (`REVIEW_REQUESTED` → `APPROVED`) before appearing in the gallery. Semantic search (via pgvector embeddings) helps users find relevant templates.

## Claude Code skill (standalone)

The demo generator is also available as a standalone Claude Code skill. Install it in any project to access the context blocks directly from the command line:

```bash
gh repo clone databricks-field-eng/industry-demo-prompts /tmp/idp && /tmp/idp/install_demo_generator_skill.sh && rm -rf /tmp/idp
```

This installs the `databricks-demo-generator` skill to `.claude/skills/` in your current directory. Then run `claude` and the skill will be available automatically.

## Local development

```bash
cd app
./scripts/dev.sh          # Start backend (uvicorn:8000) + frontend (vite:5173)
npx tsc --noEmit          # TypeScript type checking
uv run mypy src           # Python type checking
bun run build             # Production build
```

The dev script automatically provisions a local PostgreSQL instance (PGLite) — no manual database setup needed. The app resolves Databricks credentials from the SDK (environment variables, `.env` file, or active CLI profile).

See `app/.env.example` for all configuration options.

## Architecture

### Lakebase tables

| Table | Purpose |
|-------|---------|
| `users` | User configuration — email, preferred Databricks profile |
| `projects` | Top-level containers — name, description, stage, compute resources, session state |
| `project_files` | Files tracked per project — compressed content, SHA-256 hash, sync timestamps |
| `project_stars` | User favorites (star/unstar) |
| `project_shares` | Project sharing between users (read-only access) |
| `messages` | Chat messages within a project (user/assistant/system roles, reasoning data) |
| `executions` | Agent execution state — enables session resumption after page refresh |
| `templates` | Published project snapshots — name, industry, capabilities, pgvector embedding |
| `template_content` | Files stored in a template (compressed, like project files) |

Tables are auto-created on startup via SQLModel + DDL migrations in `lakebase.py`.

### API surface

All routes are prefixed with `/api`.

**Projects**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects` | List current user's projects |
| `POST` | `/projects` | Create a new project (LLM generates name/description) |
| `GET` | `/projects/{id}` | Get project details |
| `PATCH` | `/projects/{id}` | Update project name/description |
| `PATCH` | `/projects/{id}/resources` | Update compute resources (cluster, warehouse, catalog, schema) |
| `DELETE` | `/projects/{id}` | Delete a project and its files |
| `POST` | `/projects/{id}/sync` | Sync files between disk and database |
| `POST` | `/projects/{id}/star` | Toggle starred status |
| `POST` | `/projects/{id}/share` | Share project with another user |
| `GET` | `/projects/{id}/shares` | List shares for a project |
| `DELETE` | `/projects/{id}/share/{share_id}` | Remove a share |
| `GET` | `/shared-projects` | List projects shared with current user |

**Project files**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/{id}/files` | List files in a project |
| `GET` | `/projects/{id}/files/{path}` | Read file content |
| `GET` | `/projects/{id}/download` | Download project as zip |
| `GET` | `/projects/{id}/deployed-resources` | Get deployed Databricks resource links |

**Messages**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/{id}/messages` | Get message history |
| `POST` | `/projects/{id}/messages` | Add a message |
| `DELETE` | `/projects/{id}/messages` | Clear message history |
| `POST` | `/projects/{id}/session/clear` | Clear agent session (reset conversation) |

**Agent**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/invoke_agent` | Start agent execution, returns `execution_id` |
| `POST` | `/stream_progress/{execution_id}` | SSE stream of agent events |
| `POST` | `/stop_stream/{execution_id}` | Cancel running execution |
| `GET` | `/projects/{id}/execution` | Get active execution for a project |

**Templates**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/templates` | List templates (filterable by status/industry) |
| `GET` | `/templates/{id}` | Get template details |
| `GET` | `/templates/{id}/files` | List template files |
| `GET` | `/templates/{id}/files/{path}` | Read template file content |
| `POST` | `/templates/search` | Semantic search via pgvector |
| `POST` | `/templates/from-project/{id}` | Publish a project as a template |
| `POST` | `/templates/{id}/status` | Update review status (admin) |
| `POST` | `/templates/{id}/create-project` | Fork template into a new project |
| `POST` | `/templates/{id}/open-project` | Open existing project for a template |
| `PUT` | `/templates/{id}/update-from-project/{id}` | Sync template from updated project |
| `GET` | `/templates/by-project/{id}` | Find template linked to a project |
| `PATCH` | `/templates/{id}/owner` | Transfer template ownership |
| `DELETE` | `/templates/{id}` | Delete a template |

**Skills & resources**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/{id}/skills` | List available AI Dev Kit skills |
| `GET` | `/projects/{id}/skills/{name}/files` | List files in a skill |
| `GET` | `/projects/{id}/skills/{name}/files/{path}` | Read skill file content |
| `POST` | `/projects/{id}/skills/refresh` | Re-sync skills from AI Dev Kit |
| `GET` | `/projects/{id}/system-prompt` | Preview the agent's system prompt |
| `GET` | `/resources/clusters` | List available clusters |
| `GET` | `/resources/warehouses` | List available SQL warehouses |
| `GET` | `/resources/catalogs` | List Unity Catalog catalogs |
| `GET` | `/resources/schemas` | List schemas in a catalog |
| `GET` | `/resources/defaults` | Get default resource settings |
| `POST` | `/resources/refresh` | Refresh cached resource lists |

**Other**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/version` | App version |
| `GET` | `/health` | Health check |
| `GET` | `/current-user` | Current Databricks user info |
| `GET` | `/config/status` | Configuration status (DB, profiles, user) |
| `GET` | `/constants/industries` | List of supported industries |
| `GET` | `/constants/capabilities` | List of available capability blocks |
| `POST` | `/capabilities/suggest` | AI-powered capability suggestions for a scenario |
| `POST` | `/block-factory/process` | Decompose a document into context blocks |

## Project structure

```
industry-demo-prompts/
├── app/                          # Full-stack application (see app/CLAUDE.md)
│   ├── src/demo_prompt_generator/
│   │   ├── backend/
│   │   │   ├── app.py            # FastAPI entry point
│   │   │   ├── models.py         # SQLModel tables + Pydantic schemas
│   │   │   ├── router.py         # Singleton router, imports all route modules
│   │   │   ├── core/             # App factory, config, DI, DB engine, static serving
│   │   │   ├── routes/           # API routes (agent, projects, files, messages, etc.)
│   │   │   └── services/         # Business logic (agent, LLM, file sync, skills, templates)
│   │   └── ui/                   # React frontend
│   │       ├── routes/           # TanStack Router file-based routes
│   │       ├── components/       # UI components (project/, layout/, ui/, template/)
│   │       ├── lib/              # API clients, utilities, config
│   │       ├── hooks/            # Custom React hooks
│   │       └── styles/           # Tailwind CSS globals
│   ├── databricks.yml            # DAB config (Lakebase + App resources)
│   ├── pyproject.toml            # Python deps (use uv, never pip)
│   ├── package.json              # Frontend deps (use bun)
│   ├── scripts/                  # dev.sh, build.sh, build-electron.sh, release.sh
│   └── .env.example              # Environment variable template
├── .claude/skills/databricks-demo-generator/
│   └── references/blocks/        # Context blocks
│       ├── capabilities/         #   27 Databricks feature blocks
│       ├── domains/              #   4 industry verticals
│       └── patterns/             #   5 analytical patterns
├── tests/                        # Playwright E2E tests
├── install_demo_generator_skill.sh  # Standalone skill installer
└── playwright.config.ts          # Test config (targets localhost:9000)
```

## How to extend

### Adding a context block

Create a Markdown file in the appropriate `.claude/skills/databricks-demo-generator/references/blocks/` subdirectory (`domains/`, `capabilities/`, or `patterns/`) with YAML frontmatter:

```markdown
---
name: My New Block
slug: my-new-block
category: capability
tags: [tag1, tag2]
description: One-line summary of what this block provides.
related: [genie, retail]
---

Block content goes here — terminology, best practices, configuration guidance, etc.
```

Blocks on disk are automatically available to the agent's system prompt for all new projects.


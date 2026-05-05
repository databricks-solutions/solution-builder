# Demo Asset Builder

A full-stack Databricks App for building personalized demo packages. Describe a customer scenario and an AI agent — powered by the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) and [Databricks AI Dev Kit](https://github.com/databricks/ai-dev-kit) — designs the architecture, generates specification files, writes code, and deploys real assets (tables, pipelines, dashboards, agents) on a live workspace.

Built with FastAPI + React/Vite and deployed as a Databricks App with Lakebase (managed PostgreSQL) for persistence.

## Running the app

There are three ways to run the app, each with a different setup story:

| Mode | Where it runs | Auth model | Use case |
|------|---------------|------------|----------|
| **Local dev** | Your laptop | Your `~/.databrickscfg` profile | Day-to-day development with hot reload |
| **Databricks App** | A Databricks workspace | Service principal (OAuth) | Shared deployment for your team |
| **Electron** | Your laptop, packaged | Your `~/.databrickscfg` profile | Standalone desktop app for end-users |

The sections below walk through each.

## 1. Local dev

Hot-reload backend (uvicorn) + frontend (vite) for fast iteration. The dev script auto-provisions a local Postgres (PGLite) so there's no DB setup.

### Prerequisites

- [`uv`](https://docs.astral.sh/uv/) for Python deps
- [`bun`](https://bun.sh/) for frontend deps
- [Databricks CLI](https://docs.databricks.com/dev-tools/cli/index.html) v0.239.0+, authenticated to a workspace

### Setup

```bash
git clone https://github.com/databricks-field-eng/industry-demo-prompts.git
cd industry-demo-prompts/app

# Authenticate the CLI once (writes a profile to ~/.databrickscfg)
databricks auth login --host https://<workspace-url> --profile MY_WORKSPACE

# Configure local env
cp .env.example .env
# edit .env and set DATABRICKS_CONFIG_PROFILE=MY_WORKSPACE

# Install deps
uv sync          # Python (creates .venv)
bun install      # Frontend
```

### Run

```bash
./scripts/dev.sh   # Backend on :8000, frontend on :5173, opens http://localhost:5173
```

PGLite stores its data in `app/.pglite/` (gitignored). To reset:

```bash
RESET_DB=1 ./scripts/dev.sh
```

To use real Lakebase locally instead of PGLite, set `LAKEBASE_PG_URL=postgresql://...` in `.env`.

See `app/.env.example` for the full list of tunables (LLM endpoints, AI Dev Kit branch, analytics opt-out).

## 2. Deploy to Databricks (production)

The app deploys as a [Databricks Asset Bundle](https://docs.databricks.com/dev-tools/bundles/index.html) — Lakebase database, App resource, model-serving permissions, and source code in one command.

### One-time setup

```bash
cd app

# Authenticate (skip if you already did this for local dev)
databricks auth login --host https://<workspace-url> --profile MY_WORKSPACE

# Create your deploy config from the template
cp databricks.prod.yml.example databricks.prod.yml
```

`databricks.prod.yml` is **gitignored** — it holds workspace-specific values (profile, app name, Lakebase instance, model endpoints) that should not land in a public repo. Open it and fill in the three commented sections:

1. **`workspace.profile`** — the `~/.databrickscfg` profile name from `databricks auth login`.
2. **`variables`** — the resource identifiers in your workspace (`app_name`, `lakebase_instance`, model endpoint names).
3. **`env`** — runtime env vars passed to the deployed container. Each line is `ENV_NAME: ${var.<bundle_var>}`; keep these as-is unless you're adding a new tunable.

### Deploy

```bash
cd app
databricks bundle deploy
databricks bundle run demo-prompt-generator-app
```

Verify:

```bash
databricks apps get <your-app-name> --output json | jq -r '
  "URL:    \(.url)",
  "App:    \(.app_status.state)",
  "Deploy: \(.active_deployment.status.state) — \(.active_deployment.status.message)"
'
# app_status.state should reach "RUNNING"
```

### Post-deploy: grant the app `all-apis` OAuth scope

The app generates Databricks demos on behalf of the signed-in user — Unity Catalog tables, dashboards, Genie spaces, jobs, SQL warehouses, etc. By default, the OAuth integration the bundle creates only grants `iam.current-user:read`, which lets the agent identify the user but NOT create resources. Without this step, every resource-creation call returns 403 and the agent will try to work around it (e.g. by overriding env vars).

Each `databricks bundle deploy` may rotate the underlying OAuth integration ID, so re-run this whenever you redeploy:

```bash
cd app
./scripts/set-app-oauth-scopes.sh                 # uses target=prod
./scripts/set-app-oauth-scopes.sh --target prod   # explicit
```

The script reads the app name from `databricks.<target>.yml`, auto-detects your account-level CLI profile, finds the matching OAuth integration, and grants `all-apis`. Idempotent — re-running on a correctly-scoped integration is a no-op. After the update, existing user sessions still hold tokens with the old narrower scope; they need to sign out and back in (or wait for refresh) to pick up `all-apis`.

### How config flows from `databricks.prod.yml` to the running container

```
databricks.prod.yml (env:)  →  build.sh reads via `databricks bundle summary`
                            →  writes .build/app.yml (env: 1:1 copy)
                            →  Databricks Apps runtime exports env vars into the container
                            →  backend reads them via Pydantic Settings
```

`databricks.yml` is the generic shape (resource definitions, target stubs); `databricks.prod.yml` is the per-deployment values. Each model endpoint listed in `variables` gets a `CAN_QUERY` permission grant for the app's service principal automatically. The `anthropic_llm_endpoint` (Claude Code via FMAPI Anthropic bridge) does **not** need an explicit grant.

### Bundle targets

`databricks.yml` declares two targets:

- **`prod`** (`mode: production`, `default: true`) — bare `databricks bundle deploy` resolves here.
- **`staging`** (`mode: development`, `presets.name_prefix: ""`) — `databricks bundle deploy -t staging`.

There is no `dev` bundle target; local development uses `./scripts/dev.sh` (see §1) and never touches the bundle. The `include: databricks.*.yml` glob auto-picks-up any per-target file, so adding a third environment (e.g. `qa`) is two files: `databricks.qa.yml{,.example}` + a stub `targets.qa:` in `databricks.yml`.

#### Staging-specific setup

```bash
cd app

# 1. Copy the template + fill in your staging values (gitignored).
cp databricks.staging.yml.example databricks.staging.yml

# 2. Deploy + the same one-time post-deploy steps as prod, scoped to staging.
databricks bundle deploy -t staging
./scripts/set-app-oauth-scopes.sh --target staging
# Lakebase UI: grant the new staging SP CAN_CONNECT_AND_CREATE on the project.
databricks bundle run demo-prompt-generator-app -t staging
```

Recommended layout: same Lakebase project + branch as prod, different database name (e.g. `demo_generator_staging`). The app auto-creates the database on first boot, so you only need a unique `lakebase_database_name` in `databricks.staging.yml`. App resource gets a unique `app_name` (e.g. `dbdemos-generator-staging`) so prod and staging coexist.

### Auth model (deployed)

The app authenticates as a **service principal** that Databricks Apps creates and binds to the deployment. The SDK reads `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET` from the runtime and mints OAuth tokens automatically — no PATs are stored anywhere.

For Claude Code specifically, the backend writes a per-project `.claude/settings.json` containing `apiKeyHelper` + `ANTHROPIC_BASE_URL` pointing at the workspace's `/serving-endpoints/anthropic` FMAPI bridge. The helper script (`get_anthropic_token.sh`) reads a token file the backend rewrites every ~15 min via the SP's OAuth bearer. The subprocess sees no `ANTHROPIC_*` env vars — credentials live entirely in the project's `.claude/` and refresh on a schedule. End-users browsing the app authenticate via OAuth and the agent runs Databricks CLI commands on their behalf via `x-forwarded-access-token`.

## 3. Build the Electron desktop app

For users who want a standalone desktop app (e.g., on a laptop without dev tools). Bundles Python, the FastAPI backend, the React frontend, and Electron into a single `.dmg` / `.exe` / `.AppImage`.

```bash
cd app
./scripts/build-electron.sh             # Build for current arch
./scripts/build-electron.sh --arch arm64    # Apple Silicon
./scripts/build-electron.sh --arch x64      # Intel Mac / Linux
./scripts/build-electron.sh --arch universal  # Mac universal binary
```

Output lands in `app/dist-electron/`. The packaged app uses your local `~/.databrickscfg` profile at runtime — first launch prompts for a profile via the in-app config UI.

To cut a versioned release and publish to GitHub Releases:

```bash
./scripts/release.sh patch         # 0.1.0 → 0.1.1
./scripts/release.sh minor         # 0.1.0 → 0.2.0
./scripts/release.sh 1.2.3         # explicit version
```

Requires the GitHub CLI authenticated with repo access. The release script bumps `package.json`, runs `build-electron.sh`, tags the commit, and uploads artifacts to a GitHub Release.

## How it works

1. **Describe a scenario** — enter a customer use case (e.g., "predictive maintenance for wind turbines") or start from a template in the gallery.
2. **Project creation** — the app creates a project workspace, auto-assigns compute resources, and provisions a local directory with AI Dev Kit skills.
3. **Chat with the agent** — an AI agent (Claude via the Agent SDK) designs the demo interactively. It generates a README, architecture diagram, instruction specs, source code, and a DAB bundle — all as files in the project.
4. **Build pipeline** — the project progresses through stages: `DRAFTING` → `SUMMARIZED` → `ARCHITECTED` → `SPECIFICATION` → `BUILT` → `BUNDLED`. Each stage is gated by the presence of specific files.
5. **Deploy** — the agent deploys assets to your Databricks workspace using the AI Dev Kit CLI tools. Deployed resources (dashboards, pipelines, Genie spaces, etc.) are tracked and linked from the UI.
6. **Share & reuse** — publish finished projects as templates that others can fork from the gallery.

### Context blocks

Knowledge is decomposed into **blocks** — small, reusable Markdown files with YAML frontmatter stored in `.claude/skills/databricks-demo-generator/references/blocks/`. Blocks come in three categories:

- **Domain** — industry vertical context (terminology, KPIs, personas, pain points). Pre-built blocks: `financial-services`, `healthcare`, `manufacturing`, `retail`. The gallery also accepts `Media & Entertainment` and `Public Sector` scenarios, which currently rely on the agent's general knowledge rather than a dedicated block.
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

## Type checking

```bash
cd app
npx tsc --noEmit          # TypeScript
uv run mypy src           # Python
```

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
│   ├── databricks.yml            # DAB config — generic resource shape
│   ├── databricks.prod.yml.example  # Per-deployment config template (copy → databricks.prod.yml, gitignored)
│   ├── pyproject.toml            # Python deps (use uv, never pip)
│   ├── package.json              # Frontend deps (use bun)
│   ├── scripts/                  # dev.sh, build.sh, build-electron.sh, release.sh
│   └── .env.example              # Local-dev environment variable template
├── .claude/skills/databricks-demo-generator/
│   └── references/blocks/        # Context blocks
│       ├── capabilities/         #   26 Databricks feature blocks
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


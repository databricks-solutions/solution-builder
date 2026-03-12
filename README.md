# Industry Demo Prompt Generator

Turn a use-case topic into a complete **demo package** that any LLM with the [Databricks AI Dev Kit](https://github.com/databricks/ai-dev-kit) can execute end-to-end on Databricks.

## How it works

1. **Pick a use case** — browse 30+ use cases across 8 industry verticals, or describe your own.
2. **Review the proposal** — the app generates a structured proposal (background, solution, datasets, build steps) rendered as visual cards, not raw markdown.
3. **Approve & build** — one click generates a 4-file demo package:
   - `SKILL.md` — the router that the AI Dev Kit reads first (build steps, prerequisites, acceptance criteria)
   - `storyline.md` — business narrative, company persona, wow moment, domain glossary
   - `data-schema.md` — table schemas with types, relationships, and transformation SQL
   - `project-structure.md` — target directory layout using Databricks Asset Bundles
4. **Refine** — chat with the workspace to iterate on any file, then download the package.
5. **Execute** — feed the package to an LLM equipped with the AI Dev Kit to build the demo artifacts on Databricks (tables, pipelines, dashboards, Genie spaces, apps).

Built with [APX](https://github.com/databricks-solutions/apx) (FastAPI + React) and deployed as a Databricks App with Lakebase for persistence.

### Landing page — browse 30+ use cases across 8 industries

![Landing page with industry catalog](docs/screenshot-landing.png)

### Workspace — visual renderers for schemas, file trees, build steps

![Workspace with data-schema visual renderer](docs/screenshot-workspace.png)

## Prerequisites

- Python 3.11+
- [APX CLI](https://github.com/databricks-solutions/apx) (`pip install apx`)
- [Databricks CLI](https://docs.databricks.com/dev-tools/cli/index.html) configured with a profile
- A Databricks workspace with Foundation Model endpoints enabled (e.g. `databricks-claude-sonnet-4`)

### For executing generated packages

Install the [Databricks AI Dev Kit](https://github.com/databricks/ai-dev-kit) to get the MCP server and skill library that generated packages reference:

```bash
git clone https://github.com/databricks/ai-dev-kit.git
```

## Quick start (local development)

```bash
gh repo clone databricks-field-eng/industry-demo-prompts
cd industry-demo-prompts/app
apx dev start
```

The app starts at **http://localhost:9000** with hot-reload for both frontend and backend. APX automatically provisions a local PostgreSQL instance for Lakebase tables — no manual database setup needed.

> **Note:** The app resolves Databricks credentials from the SDK — either via environment variables (`DATABRICKS_HOST` / `DATABRICKS_TOKEN`), a `.env` file, or the active Databricks CLI profile.

## Deploy to Databricks

The entire app — Lakebase instance, Databricks App, and source code — deploys with a single command via [Databricks Asset Bundles](https://docs.databricks.com/dev-tools/bundles/index.html).

### 1. Configure a deployment target

`databricks.yml` defines named targets. The `dev` target uses your default CLI profile. Add workspace-specific targets:

```yaml
# databricks.yml (already configured)
targets:
  dev:
    mode: development
    default: true
  tools:
    workspace:
      profile: TOOLS    # maps to a [TOOLS] section in ~/.databrickscfg
```

### 2. Deploy

```bash
cd app
databricks bundle deploy -t tools   # or: -t dev, -p YOUR_PROFILE
```

This creates:
- A **Lakebase provisioned PostgreSQL instance** (`demo-prompt-generator`, CU_1) with a `databricks_postgres` database
- A **Databricks App** with the Lakebase instance bound as a resource

### 3. First-time Lakebase setup

After the first deploy, you need to grant the app's service principal permission to create tables in the `public` schema (this is a one-time step per Lakebase instance):

```bash
databricks psql demo-prompt-generator -p TOOLS -- \
  -d databricks_postgres \
  -c "GRANT ALL ON SCHEMA public TO PUBLIC; GRANT CREATE ON SCHEMA public TO PUBLIC;"
```

Then trigger a redeploy so the app retries table creation:

```bash
databricks apps deploy demo-prompt-generator \
  --source-code-path /Workspace/Users/<your-email>/.bundle/demo-prompt-generator/<target>/files/.build \
  -p TOOLS
```

### 4. Verify

```bash
databricks apps get demo-prompt-generator -p TOOLS
# app_status.state should be "RUNNING"
```

## Development

```bash
apx dev start     # Start dev servers (backend + frontend + OpenAPI watcher)
apx dev stop      # Stop dev servers
apx dev logs -f   # Stream logs
apx dev status    # Check server status
apx dev check     # TypeScript + Python type checking
apx build         # Production build
```

## Architecture

### Lakebase tables

| Table | Purpose |
|-------|---------|
| `generation` | Proposals, SKILL.md, and package files (data-schema, storyline, etc.) |
| `conversation` | Chat threads linked to a generation, with title and timestamps |
| `chat_message` | Individual messages (user, assistant, system) within a conversation |

Tables are auto-created on app startup via SQLModel + explicit DDL migrations in `lakebase.py`.

### API surface

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/workspace/propose` | Generate a proposal from a topic (SSE) |
| `POST` | `/api/workspace/propose/refine` | Refine a proposal via chat (SSE) |
| `POST` | `/api/workspace/approve` | Approve proposal, transition to buildout |
| `POST` | `/api/workspace/buildout` | Generate all package files (SSE) |
| `POST` | `/api/workspace/refine-file` | Refine a single package file (SSE) |
| `GET` | `/api/workspace/{id}/download` | Download package as zip |
| `GET` | `/api/generations` | List all past generations |
| `GET` | `/api/generations/{id}` | Get a single generation |
| `GET` | `/api/conversations` | List conversations (optional `?generation_id=` filter) |
| `GET` | `/api/conversations/{id}` | Get conversation with all messages |
| `POST` | `/api/conversations/save` | Upsert conversation messages for a generation |
| `DELETE` | `/api/conversations/{id}` | Delete a conversation |

### Frontend auto-save

Chat messages are automatically persisted to Lakebase with a 2-second debounce. When a user revisits a generation, the full conversation history is restored.

## Project structure

```
industry-demo-prompts/
├── app/
│   ├── databricks.yml                  # DAB config — Lakebase instance + App resource
│   ├── pyproject.toml                  # Python deps + APX metadata
│   ├── package.json                    # Frontend deps
│   └── src/demo_prompt_generator/
│       ├── backend/
│       │   ├── app.py                  # FastAPI entry point
│       │   ├── models.py              # SQLModel tables + Pydantic request/response models
│       │   ├── router.py             # Singleton router, imports all route modules
│       │   ├── core/
│       │   │   ├── _factory.py       # App factory, lifespan, singleton router
│       │   │   ├── _config.py        # AppConfig (host, token, LLM model)
│       │   │   └── lakebase.py       # DB engine, migrations, session dependency
│       │   ├── routes/
│       │   │   ├── workspace.py       # Proposal, approve, buildout, refine (SSE)
│       │   │   ├── conversations.py   # Conversation CRUD (list, get, save, delete)
│       │   │   ├── generations.py     # GET /generations, /generations/:id
│       │   │   └── inspire.py         # POST /inspire (topic → use case)
│       │   └── services/
│       │       └── skill_generator.py # LLM prompts for proposals + package files
│       └── ui/
│           ├── routes/
│           │   ├── index.tsx          # Landing page — industry catalog
│           │   ├── workspace.tsx      # Proposal → build workspace (with auto-save)
│           │   └── _sidebar/
│           │       ├── generations.tsx        # Layout route
│           │       ├── generations.index.tsx  # Past generations list
│           │       └── generations.$id.tsx    # Generation detail + open in workspace
│           ├── components/
│           │   ├── proposal-cards.tsx  # Structured proposal card renderer
│           │   └── file-renderers.tsx  # Visual renderers for package files
│           └── lib/
│               ├── api.ts             # Auto-generated API client (Orval)
│               └── custom-api.ts      # SSE streaming + conversation API helpers
├── docs/                              # Screenshots
└── .gitignore
```

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
- A Databricks workspace with a Foundation Model endpoint (e.g. `databricks-claude-sonnet-4`)

### For executing generated packages

Install the [Databricks AI Dev Kit](https://github.com/databricks/ai-dev-kit) to get the MCP server and skill library that generated packages reference:

```bash
git clone https://github.com/databricks/ai-dev-kit.git
```

## Quick start

```bash
gh repo clone databricks-field-eng/industry-demo-prompts
cd industry-demo-prompts/app
cp .env.example .env
# Edit .env with your Databricks host + token (or set DATABRICKS_CONFIG_PROFILE)
apx dev start
```

The app starts at **http://localhost:9000** with hot-reload for both frontend and backend.

## Deploy to Databricks

```bash
cd app
apx build
databricks bundle deploy -p YOUR_PROFILE
```

This creates a Databricks App backed by a Lakebase PostgreSQL instance.

## Development

```bash
apx dev start     # Start dev servers (detached)
apx dev stop      # Stop dev servers
apx dev logs -f   # Stream logs
apx dev status    # Check server status
apx dev check     # Type checking + linting
apx build         # Production build
```

### Playwright testing

The repo includes Playwright tests for end-to-end UI verification. To run them against a local dev server:

```bash
npm install          # install Playwright (one-time)
npx playwright test  # run tests
```

## Project structure

```
industry-demo-prompts/
├── app/
│   ├── databricks.yml                  # Databricks Asset Bundle config
│   ├── pyproject.toml                  # Python deps + APX metadata
│   ├── package.json                    # Frontend deps
│   └── src/demo_prompt_generator/
│       ├── backend/
│       │   ├── app.py                  # FastAPI entry point
│       │   ├── models.py              # SQLModel schemas (Generation, etc.)
│       │   ├── routes/
│       │   │   ├── workspace.py       # Proposal, approve, buildout, refine SSE
│       │   │   ├── generations.py     # GET /generations, /generations/:id
│       │   │   └── inspire.py         # POST /inspire (topic → use case)
│       │   └── services/
│       │       └── skill_generator.py # LLM prompts for proposals + package files
│       └── ui/
│           ├── routes/
│           │   ├── index.tsx          # Landing page — industry catalog
│           │   ├── workspace.tsx      # Proposal → build workspace
│           │   └── _sidebar/
│           │       ├── generations.tsx        # Layout route
│           │       ├── generations.index.tsx  # Past generations list
│           │       └── generations.$id.tsx    # Generation detail + open in workspace
│           ├── components/
│           │   ├── proposal-cards.tsx  # Structured proposal card renderer
│           │   └── file-renderers.tsx  # Visual renderers for package files
│           └── lib/
│               ├── api.ts             # Auto-generated API client
│               └── custom-api.ts      # SSE streaming helpers
├── playwright.config.ts               # Playwright test config
├── tests/                             # E2E tests
└── .gitignore
```

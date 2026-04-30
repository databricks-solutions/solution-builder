# CLAUDE.md

## What is this project?

Industry Demo Prompt Generator — a full-stack Databricks App that generates personalized demo instruction packages. Instead of static demo repos, it captures best practices as composable **blocks** of structured context that an LLM assembles into tailored demo packages for any customer scenario. The generated packages are then executed by the [Databricks AI Dev Kit](https://github.com/databricks/ai-dev-kit) to build real assets (tables, pipelines, dashboards, etc.) on a live workspace.

Built with FastAPI + React/Vite and deployed as a Databricks App with Lakebase (managed PostgreSQL) for persistence.

## Repository structure

```
industry-demo-prompts/
├── app/                          # Full-stack application (see app/CLAUDE.md for detailed dev guide)
│   ├── src/demo_prompt_generator/
│   │   ├── backend/              # FastAPI backend
│   │   │   ├── app.py            # Entry point
│   │   │   ├── models.py         # SQLModel tables + Pydantic request/response models
│   │   │   ├── router.py         # Singleton router, imports all route modules
│   │   │   ├── core/             # App factory, config, DI, DB engine, static serving
│   │   │   ├── routes/           # API route modules (agent, projects, messages, etc.)
│   │   │   └── services/         # Business logic (agent, LLM, file sync, skills)
│   │   └── ui/                   # React frontend
│   │       ├── routes/           # TanStack Router file-based routes
│   │       ├── components/       # UI components (project/, layout/, ui/)
│   │       ├── lib/              # API clients, utilities, config
│   │       ├── hooks/            # Custom React hooks
│   │       └── styles/           # Tailwind CSS globals
│   ├── databricks.yml            # DAB config (Lakebase + App resources)
│   ├── pyproject.toml            # Python dependencies (use uv, never pip)
│   ├── package.json              # Frontend dependencies (use bun)
│   ├── vite.config.ts            # Vite config with path aliases (@/ -> ui/)
│   ├── tsconfig.json             # TypeScript config (strict mode)
│   ├── scripts/                  # dev.sh, build.sh, build-electron.sh, release.sh
│   └── .env.example              # Environment variable template
├── .claude/skills/databricks-demo-generator/
│   └── references/blocks/        # Context blocks (domains, capabilities, patterns)
├── tests/                        # Playwright E2E tests
├── playwright.config.ts          # Test config (targets localhost:9000)
└── docs/                         # Screenshots for README
```

## Key concepts

- **Block**: A Markdown file with YAML frontmatter — a reusable chunk of domain/capability/pattern context. Stored in `.claude/skills/databricks-demo-generator/references/blocks/`.
- **Project**: A user workspace containing generated files and a chat session with an AI agent for iterative refinement.
- **Template**: A published project snapshot that can be forked by other users.

## Quick commands

All commands run from `app/`:

```bash
# Local development (backend + frontend with hot reload)
./scripts/dev.sh              # Starts uvicorn:8000 + vite:5173, auto-clones ai_dev_kit

# Type checking
npx tsc --noEmit              # Frontend TypeScript
uv run mypy src               # Backend Python

# Production build
bun run build                 # Frontend -> src/demo_prompt_generator/ui/__dist__/

# Testing
npx playwright test           # E2E tests (needs app running on :9000)

# Deploy to Databricks (one-time: cp databricks.prod.yml.example databricks.prod.yml, fill in)
databricks bundle deploy
databricks bundle run demo-prompt-generator-app

# Database reset (drops all tables)
RESET_DB=1 ./scripts/dev.sh
```

## Environment setup

1. Copy `app/.env.example` to `app/.env` and configure:
   - `DATABRICKS_CONFIG_PROFILE` or `DATABRICKS_HOST`/`DATABRICKS_TOKEN` (required)
   - `LAKEBASE_PG_URL` (optional — omit to use PGLite, a local auto-provisioned PostgreSQL)
   - `ANTHROPIC_LLM_ENDPOINT` (default: `databricks-claude-sonnet-4-6`)
   - For prod deploys also: `cp app/databricks.prod.yml.example app/databricks.prod.yml` and fill in.
2. `bun install` in `app/` for frontend deps
3. `uv sync` in `app/` for Python deps (creates `.venv`)
4. The `ai_dev_kit/` directory is cloned automatically by `dev.sh`

## Conventions

- **Python packages**: Always use `uv`, never `pip`
- **Frontend packages**: Use `bun` (bun install, bun add)
- **Path alias**: `@/` maps to `src/demo_prompt_generator/ui/` in all frontend imports
- **API routes**: Must include `response_model` and `operation_id` parameters
- **Models**: Follow the 3-model pattern — `Entity` (SQLModel DB), `EntityIn` (Pydantic input), `EntityOut` (Pydantic response)
- **Components**: shadcn/ui primitives in `components/ui/`, feature components in `components/project/`, layout in `components/layout/`
- **Styling**: Tailwind CSS v4 with CSS custom properties (oklch color space). No CSS modules or styled-components.
- **Routing**: TanStack Router (file-based). Route files in `ui/routes/` auto-generate `routeTree.gen.ts`.
- **No manual OpenAPI regeneration**: The client auto-regenerates when dev servers are running

# CLAUDE.md — App Development Guide

Detailed patterns and conventions for working on the `app/` directory. Read the root `../CLAUDE.md` first for project overview.

## Architecture overview

This is a full-stack application (FastAPI + React/Vite) with a clear separation:

- **Backend** (`src/demo_prompt_generator/backend/`): FastAPI, SQLModel, Lakebase (PostgreSQL)
- **Frontend** (`src/demo_prompt_generator/ui/`): React 19, TanStack Router, Tailwind CSS v4, shadcn/ui (Radix)
- **Bridge**: The frontend calls `/api/*` endpoints. In dev mode, Vite proxies these to uvicorn. In production, FastAPI serves the built frontend statically.

The app's core flow: users create **projects**, chat with an AI agent to generate demo files, view/edit those files, and optionally publish as **templates** for reuse.

## Backend patterns

### File layout

```
backend/
├── app.py              # create_app() call, imports router
├── models.py           # ALL SQLModel tables + Pydantic schemas (single file)
├── router.py           # Imports all route modules, registers them
├── core/
│   ├── __init__.py     # Exports: create_app, create_router, Dependencies, logger
│   ├── _factory.py     # App factory, lifespan, static file serving
│   ├── _config.py      # AppConfig (Pydantic BaseSettings, env var prefix)
│   ├── _headers.py     # Databricks Apps HTTP header extraction
│   ├── dependencies.py # Dependencies class (DI type aliases)
│   └── lakebase.py     # DB engine, auto-migrations, session dependency
├── routes/             # One module per resource
│   ├── agent.py        # POST /invoke_agent, /stream_progress/{id}, /stop_stream/{id}
│   ├── projects.py     # Project CRUD, creation with auto-provisioning
│   ├── project_files.py # File listing, read, download, deployed resources, architecture-snapshot (PNG)
│   ├── messages.py     # Message history per project
│   ├── templates.py    # Template publish/list/fork/search
│   ├── resources.py    # Cluster/warehouse/catalog/schema listing
│   ├── skills.py       # Skills listing and system prompt preview
│   ├── config.py       # User config, DB status, Databricks profiles
│   ├── constants.py    # Industries, capabilities, current-user, capability suggestions
│   └── block_factory.py # Document decomposition into context blocks
└── services/           # Business logic, decoupled from routes
    ├── agent.py        # Claude Agent SDK integration, streaming
    ├── llm_service.py  # Databricks Foundation Model API calls
    ├── file_sync.py    # Bidirectional sync between DB and disk
    ├── file_watcher.py # File system watcher for live sync
    ├── skills_manager.py # Project directory setup, skill file management
    ├── template_service.py # Template operations, pgvector embedding
    ├── block_factory.py # LLM-powered document → block decomposition
    ├── system_prompt.py  # Agent system prompt assembly
    └── active_stream.py  # In-memory stream manager for SSE
```

### Dependency injection

Use the `Dependencies` class in route handlers — never create clients manually:

```python
from ..core import Dependencies, create_router

router = create_router()

@router.get("/items", response_model=list[ItemOut])
def list_items(session: Dependencies.Session, config: Dependencies.Config):
    return session.exec(select(Item)).all()
```

Available dependencies:

| Type alias | Resolves to | Use for |
|---|---|---|
| `Dependencies.Session` | SQLModel `Session` | All database operations |
| `Dependencies.Client` | `WorkspaceClient` | Databricks API (app service principal) |
| `Dependencies.UserClient` | `WorkspaceClient` | Databricks API (current user via OBO) |
| `Dependencies.Config` | `AppConfig` | Environment config values |
| `Dependencies.Headers` | Header extraction | User email, auth tokens |

### Adding a new API route

1. Create a file in `backend/routes/` (e.g., `my_feature.py`)
2. Use `create_router()` to get a router instance
3. Define endpoints with `response_model` and `operation_id` (both required for client generation)
4. Import and register in `backend/router.py`

```python
# routes/my_feature.py
from ..core import Dependencies, create_router
from ..models import MyFeatureOut

router = create_router()

@router.get("/my-feature", response_model=list[MyFeatureOut], operation_id="listMyFeature")
def list_my_feature(session: Dependencies.Session):
    ...
```

### Models

All models live in `models.py`. Follow the 3-model pattern:

```python
# Database table
class Widget(SQLModel, table=True):
    id: str = SQLField(default_factory=generate_uuid, primary_key=True)
    name: str
    created_at: datetime = SQLField(default_factory=utc_now)

# API input
class WidgetCreate(BaseModel):
    name: str

# API response
class WidgetOut(BaseModel):
    id: str
    name: str
    created_at: datetime
```

### Database

- Lakebase (managed PostgreSQL) in prod. **In local dev the mode is decided by `_is_pglite_mode()` in `lakebase.py`:** PGLite iff `USE_PGLITE=1` **or** `LAKEBASE_DATABASE_PATH` is unset. `app/.env` normally sets `LAKEBASE_DATABASE_PATH` → **dev talks to a real remote Lakebase branch** (a named dev branch, not prod), NOT a local PGLite cluster.
- Tables auto-created/migrated on startup (`initialize_models` / alembic in `lakebase.py`).
- **`RESET_DB=1` is DESTRUCTIVE — see the "⚠️ Dev database" section in the root `../CLAUDE.md`.** In Lakebase mode it DROPS ALL TABLES on the remote branch `.env` points at; in PGLite mode it deletes `~/.pglite/`. Never run it (or a test that sets it) against a branch with real data.

## Frontend patterns

### File layout

```
ui/
├── main.tsx                # Entry point (React Query + Router setup)
├── routeTree.gen.ts        # Auto-generated route tree (DO NOT EDIT)
├── routes/                     # File-based routing (TanStack Router)
│   ├── __root.tsx              # Root layout (ThemeProvider, Toaster)
│   ├── index.tsx               # Home — scenario input, recent projects, templates
│   ├── project.$projectId.tsx  # Project workspace (chat + file viewer)
│   ├── projects.tsx            # Project list
│   ├── gallery.tsx             # Template gallery
│   ├── templates.tsx           # Template management (admin review)
│   ├── profile.tsx             # User profile
│   ├── docs.tsx                # Documentation
│   └── setup.tsx               # Initial setup / configuration
├── components/
│   ├── ui/                 # shadcn/ui primitives (button, dialog, input, etc.)
│   ├── project/            # Project workspace components
│   │   ├── chat-panel.tsx  # Chat interface with streaming + reasoning display
│   │   ├── file-viewer.tsx # File explorer sidebar with tabs (renders images inline: png/jpg/svg…)
│   │   ├── code-viewer.tsx # Syntax-highlighted code display
│   │   ├── platform-diagram.tsx + platform-diagram/  # ReactFlow arch editor (see root CLAUDE.md)
│   │   ├── build-stepper.tsx         # Stage pipeline progress indicator
│   │   ├── deployed-resources-bar.tsx # Links to live Databricks resources
│   │   ├── project-tile.tsx          # Project card for list views
│   │   ├── resources-popover.tsx     # Cluster/warehouse selector
│   │   ├── skills-popup.tsx          # Available skills list
│   │   └── template-publish-dialog.tsx
│   ├── layout/             # App shell (navbar, sidebar, logo, theme toggle)
│   └── markdown-prose.tsx  # Markdown renderer with Mermaid diagram support
├── lib/
│   ├── custom-api.ts       # Hand-written API client (types + fetch helpers + SSE streaming)
│   ├── api.ts              # Auto-generated OpenAPI client (backup)
│   ├── config.ts           # API base URL resolution (dev vs Electron vs production)
│   ├── architecture-schema.ts  # ReactFlow node/edge schema parsing
│   ├── selector.ts         # Data selector utility
│   └── utils.ts            # cn() class merging helper
├── hooks/
│   └── use-mobile.ts       # Responsive breakpoint hook
├── styles/
│   └── globals.css         # Tailwind + CSS custom properties (oklch colors)
└── types/
    └── vite-env.d.ts       # Vite environment type declarations
```

### Routing

TanStack Router with file-based route generation. Routes live in `ui/routes/` and auto-generate `routeTree.gen.ts` (never edit this file manually).

Route file naming: `project.$projectId.tsx` creates route `/project/:projectId`.

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/my-route")({
  component: MyRouteComponent,
  validateSearch: (search) => ({ ... }), // optional query params
});
```

### Components

- **shadcn/ui primitives** in `components/ui/` — standard Radix-based components. Add new ones manually from the [shadcn registry](https://ui.shadcn.com/).
- **Feature components** in `components/project/` — the main project workspace UI.
- **Layout components** in `components/layout/` — app shell, navigation.

### Styling

Tailwind CSS v4 with the `@tailwindcss/vite` plugin. Key points:

- CSS custom properties in `globals.css` using oklch color space
- Light and dark mode support (`.dark` class)
- `cn()` utility from `lib/utils.ts` for conditional class merging
- Path alias: `@/` resolves to `src/demo_prompt_generator/ui/`
- No CSS modules, no styled-components — pure Tailwind utility classes

### API client

The primary API client is `lib/custom-api.ts` — hand-written with full TypeScript types, fetch helpers, and SSE streaming support. Key exports:

- Type interfaces: `Project`, `ProjectFile`, `Message`, `ReasoningEntry`, etc.
- CRUD functions: `getProject()`, `listProjectFiles()`, `createProject()`, etc.
- Streaming: `invokeAgent()` returns an `execution_id`, then `streamAgentProgress(id, signal)` yields typed SSE events
- All functions use `apiUrl()` from `config.ts` to resolve the base URL

### State management

- Local `useState` / `useRef` for component-level state
- No global store actively used (Zustand available but unused)
- TanStack React Query available but the project workspace page uses direct `useState` with manual fetching

### Key UI architecture: Project workspace

The project page (`routes/project.$projectId.tsx`) is the main workspace. It's a two-panel layout:

- **Left**: File viewer (collapsible sidebar + tabbed content area with Summary/Architecture views)
- **Right**: Chat panel (resizable via drag handle, 360-800px range)

The chat panel (`components/project/chat-panel.tsx`) handles:
- Message display with user/assistant bubble styling
- SSE streaming with live content updates
- Reasoning display (thinking + tool execution, collapsible)
- Auto-resizing textarea input with send/stop controls

## Testing

Playwright E2E tests in `tests/` at the repo root:

```bash
# Run all tests (app must be running on :9000)
npx playwright test

# Run specific test file
npx playwright test tests/e2e-comprehensive.spec.ts

# With UI mode
npx playwright test --ui
```

Tests target `http://localhost:9000` (the production-mode server, not the split dev ports).

## Common tasks

### Add a new shadcn/ui component

Manually copy from the [shadcn registry](https://ui.shadcn.com/) into `components/ui/`.

### Type checking after changes

```bash
npx tsc --noEmit           # Frontend
uv run mypy src            # Backend (from app/ directory)
```

### Run the app locally

```bash
# Option 1: Split servers (backend:8000, frontend:5173)
./scripts/dev.sh

# Option 2: Production mode (:9000, requires bun run build first)
uv run uvicorn demo_prompt_generator.backend.app:app --host 127.0.0.1 --port 9000
```

### Build for deployment

One-time setup: `cp databricks.prod.yml.example databricks.prod.yml` and fill in
the three sections (workspace profile, bundle vars, runtime env). The file is
gitignored so deployment-specific values never land in the public repo.

```bash
bun run build                # Frontend
databricks bundle deploy     # Resolves databricks.prod.yml + invokes build.sh
```

`build.sh --target prod` reads the resolved `targets.prod.env` dict from
`databricks bundle summary --output json` and writes `.build/app.yml` from it.
The on-disk `app/app.yml` placeholder no longer exists — `databricks.prod.yml`
is the single source of truth for both bundle vars and runtime env.

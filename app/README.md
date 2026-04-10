# demo-prompt-generator

> A modern full-stack application built with Python/FastAPI and React/Vite

## Tech Stack

- **Backend**: Python + [FastAPI](https://fastapi.tiangolo.com/)
- **Frontend**: React + [Vite](https://vite.dev/) + [shadcn/ui](https://ui.shadcn.com/)
- **Database**: PostgreSQL (via Databricks Database in production)

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (for frontend tooling)
- [uv](https://github.com/astral-sh/uv) (for Python dependency management)
- PostgreSQL database
- Databricks CLI configured

### 1. Setup Databricks Authentication

The app uses the [Databricks Python SDK unified authentication](https://docs.databricks.com/en/dev-tools/auth.html).

**Option A: Use a profile (recommended)**
```bash
# Login and create/update a profile
databricks auth login --host https://your-workspace.cloud.databricks.com --profile my-profile

# Set the profile to use
export DATABRICKS_CONFIG_PROFILE=my-profile
```

**Option B: Direct token auth**
```bash
export DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
export DATABRICKS_TOKEN=dapi...
```

### 2. Setup Database

```bash
# Set your PostgreSQL connection URL
export LAKEBASE_PG_URL=postgresql://user:pass@localhost:5432/demo_prompt_generator
```

### 3. Start Development Server

```bash
# Start both backend and frontend with live output
./scripts/dev.sh

# Or via bun
bun run dev
```

This starts:
- **Backend** (uvicorn): http://127.0.0.1:8000
- **Frontend** (vite): http://localhost:5173
- **API Docs**: http://127.0.0.1:8000/docs

The frontend automatically proxies `/api` requests to the backend.

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key variables:
| Variable | Description |
|----------|-------------|
| `LAKEBASE_PG_URL` | PostgreSQL connection URL |
| `DATABRICKS_CONFIG_PROFILE` | Databricks CLI profile name |
| `DATABRICKS_HOST` | (Alternative) Direct workspace URL |
| `DATABRICKS_TOKEN` | (Alternative) Direct PAT token |
| `DEMO_PROMPT_GENERATOR_LLM_MODEL` | LLM endpoint name |

### Database Reset

To reset the database (drops all tables and recreates them):

```bash
RESET_DB=1 bun run dev:backend
```

## Code Quality

```bash
# TypeScript type checking
bun run typecheck

# Python type checking
uv run mypy src
```

## Build

Create a production build:

```bash
bun run build
```

This builds the frontend to `src/demo_prompt_generator/ui/__dist__/`.

## Electron Desktop App

Build a standalone macOS desktop application that bundles Python and all dependencies:

### Prerequisites

- macOS (for building macOS apps)
- Bun / Node.js
- ~2GB disk space for the build

### Build the Electron App

```bash
# Full build (downloads Python, bundles backend, builds frontend, packages app)
./scripts/build-electron.sh

# Build for specific architecture
./scripts/build-electron.sh --arch arm64  # Apple Silicon
./scripts/build-electron.sh --arch x64    # Intel Mac

# Skip steps if already completed
./scripts/build-electron.sh --skip-python --skip-frontend

# Embed a Lakebase connection URL (see warning below)
./scripts/build-electron.sh --lakebase-url "postgresql://user:pass@host:port/db"
```

The DMG installer will be created in `dist-electron/`.

> **⚠️ Security Warning**: The `--lakebase-url` option embeds the database connection string (including credentials) directly into the app bundle. This URL is stored in plain text and accessible to anyone with the app. **Only use this for internal/demo purposes** where the database has appropriate access controls. For production use, configure the database URL via environment variables instead.

### Development with Electron

```bash
# Install Electron dependencies
bun install

# Run in Electron (requires backend running separately)
bun run electron:dev
```

### How It Works

The Electron app bundles:
1. **Standalone Python 3.12** - Downloaded from [python-build-standalone](https://github.com/indygreg/python-build-standalone)
2. **Python backend** - Bundled with PyInstaller including all dependencies
3. **React frontend** - Built static files served by the backend

When launched:
1. Electron starts the bundled Python backend on port 8765
2. Frontend loads and connects to the backend API
3. Claude Code sessions use the user's system Python/tools (not the bundled one)

### App Architecture

```
Demo Prompt Generator.app/
├── Contents/
│   ├── MacOS/            # Electron binary
│   ├── Resources/
│   │   ├── backend/      # PyInstaller-bundled FastAPI server
│   │   ├── python/       # Standalone Python 3.12
│   │   └── frontend/     # Built React app
│   └── Info.plist
└── ...
```

## Deployment (Databricks Apps)

Deploy to Databricks:

```bash
databricks bundle deploy -p <your-profile>
```

---

<p align="center">Built with Python/FastAPI and React/Vite</p>

# Industry Demo Prompts

Turn a business use-case into a self-contained `SKILL.md` that any LLM with the [Databricks AI Dev Kit](https://github.com/databricks/ai-dev-kit) can execute end-to-end to build a complete Databricks demo.

## What this does

A user fills out a form describing their demo needs (audience, industry, business problem, Databricks features, etc.) and the app generates a Claude-compatible **SKILL.md** file. That skill file can then be fed to an LLM equipped with the AI Dev Kit's skills and MCP tools to actually build the demo artifacts on Databricks -- tables, pipelines, dashboards, Genie spaces, and more.

The app is built with [APX](https://github.com/databricks-solutions/apx) (FastAPI + React) and deploys as a Databricks App with Lakebase for persistence.

## Prerequisites

- Python 3.11+
- [APX CLI](https://github.com/databricks-solutions/apx) (`pip install apx` or see their install docs)
- [Databricks CLI](https://docs.databricks.com/dev-tools/cli/index.html) configured with a profile (`~/.databrickscfg`)
- A Databricks workspace with a Foundation Model endpoint (e.g. `databricks-claude-sonnet-4`)

### For using the generated skills

Install the [Databricks AI Dev Kit](https://github.com/databricks/ai-dev-kit) to get the MCP server and skill library that the generated `SKILL.md` files reference:

```bash
# Clone and set up ai-dev-kit (follow their README for full instructions)
git clone https://github.com/databricks/ai-dev-kit.git
```

The AI Dev Kit provides:
- **MCP tools** for interacting with Databricks (SQL, pipelines, dashboards, jobs, etc.)
- **Skills** for synthetic data generation, DLT pipelines, dashboards, Vector Search, model serving, and more

## Quick start

### 1. Clone this repo

```bash
gh repo clone databricks-field-eng/industry-demo-prompts
cd industry-demo-prompts/app
```

### 2. Configure environment

Copy the example and fill in your Databricks credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```
DEMO_PROMPT_GENERATOR_DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DEMO_PROMPT_GENERATOR_DATABRICKS_TOKEN=dapi...
DEMO_PROMPT_GENERATOR_LLM_MODEL=databricks-claude-sonnet-4
```

### 3. Run locally

```bash
apx dev start
```

The app starts at **http://localhost:9000** with:
- React frontend (hot-reload)
- FastAPI backend (auto-reload)
- PGlite local database (in-memory)

### 4. Use the app

1. Click **Create New Demo** on the home page
2. Fill out the 6-step form (basics, story, content, look & feel, constraints, review)
3. Click **Generate SKILL.md**
4. Preview, copy, or download the generated skill
5. Feed the skill to an LLM with the AI Dev Kit to build the actual demo

You can also use **Get Inspired** on the home page to generate a business use-case from a topic.

## Deploy to Databricks

```bash
cd app
apx build
databricks bundle deploy -p YOUR_PROFILE
```

This creates a Databricks App with a Lakebase PostgreSQL instance for persistence.

## Dev commands

```bash
apx dev start     # Start dev servers (detached)
apx dev stop      # Stop dev servers
apx dev logs -f   # Stream logs
apx dev status    # Check server status
apx dev check     # Run type checking and linting
apx build         # Production build
```

## Project structure

```
industry-demo-prompts/
├── README.md
├── original_doc.md              # Demo request form specification
├── app/
│   ├── databricks.yml           # Databricks Asset Bundle config
│   ├── pyproject.toml           # Python dependencies & APX metadata
│   ├── package.json             # Frontend dependencies
│   └── src/demo_prompt_generator/
│       ├── backend/
│       │   ├── app.py           # FastAPI entry point
│       │   ├── router.py        # Route registration
│       │   ├── models.py        # Pydantic/SQLModel schemas
│       │   ├── core/            # Config, dependencies, Lakebase
│       │   ├── routes/
│       │   │   ├── generate.py  # POST /generate (form -> SKILL.md)
│       │   │   ├── inspire.py   # POST /inspire (streaming SSE)
│       │   │   └── generations.py # GET /generations, /generations/:id
│       │   └── services/
│       │       └── skill_generator.py  # LLM prompt engineering
│       └── ui/
│           ├── routes/
│           │   ├── index.tsx    # Home page + Get Inspired
│           │   ├── new.tsx      # 6-step form wizard
│           │   └── _sidebar/
│           │       ├── generations.tsx     # Past generations list
│           │       └── generations.$id.tsx # Result view
│           ├── components/      # shadcn/ui + APX components
│           └── lib/
│               ├── api.ts       # Auto-generated API client
│               └── custom-api.ts # SSE streaming + form defaults
└── .claude/skills/              # AI Dev Kit skill definitions
```

# Contributing to Databricks Solution Builder

This repository is maintained by Databricks and intended for contributions from Databricks Field Engineers. While the repository is public and meant to help anyone developing solutions on Databricks, external contributions are not currently accepted. Feel free to open an issue with requests, bug reports, or suggestions — we read them.

## Development setup

Prerequisites: [`uv`](https://docs.astral.sh/uv/), [`bun`](https://bun.sh/), and the [Databricks CLI](https://docs.databricks.com/dev-tools/cli/index.html) (v0.239.0+) authenticated to a workspace.

1. Clone the repository:
   ```bash
   git clone https://github.com/databricks-solutions/solution-builder.git
   cd solution-builder/app
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # edit .env → DATABRICKS_CONFIG_PROFILE=<your-profile>
   ```

3. Install dependencies:
   ```bash
   uv sync          # Python (creates .venv)
   bun install      # Frontend
   ```

4. Run the dev servers:
   ```bash
   ./scripts/dev.sh # backend :8000 + frontend :5173 with hot reload
   ```

PGLite auto-provisions a local Postgres — no DB setup needed. Reset with `RESET_DB=1 ./scripts/dev.sh`.

## Code standards

- **Python**: managed with `uv` (never `pip`). Models follow the 3-model pattern (`Entity` / `EntityIn` / `EntityOut`). API routes must include `response_model` and `operation_id` parameters.
- **Frontend**: managed with `bun`. `@/` aliases to `src/demo_prompt_generator/ui/`. shadcn/ui primitives live in `components/ui/`, feature components in `components/project/`. Tailwind v4 with oklch CSS variables — no CSS modules, no styled-components.
- **Type hints**: required for public Python functions.
- **Naming**: lowercase-with-hyphens for directories; snake_case for Python; camelCase for TypeScript.

See [`CLAUDE.md`](CLAUDE.md) and [`app/CLAUDE.md`](app/CLAUDE.md) for full conventions.

## Type checking & validation

Run these before opening a PR:

```bash
cd app
uv run mypy src           # Python type-check
npx tsc --noEmit          # TypeScript type-check
bun run build             # Verify the frontend builds
```

## Testing

Playwright E2E tests live in `tests/`:

```bash
npx playwright test                       # all tests (app must be running on :9000)
npx playwright test tests/e2e-comprehensive.spec.ts
npx playwright test --ui                  # interactive mode
```

## Pull request process

1. Create a feature branch from `main`.
2. Make your changes with clear, descriptive commits.
3. Type-check, build, and smoke-test against a real Databricks workspace.
4. Open a PR with:
   - A short title (under 70 chars).
   - A description explaining *why* the change is needed.
   - Any UI changes accompanied by a screenshot or short clip.
   - Confirmation that no secrets, workspace IDs, or personal emails are in the diff.
5. Address review feedback.

## Adding a context block

To add a new domain, capability, or pattern to the Solution Generator Skill:

1. Create a Markdown file in the appropriate subdirectory under `.claude/skills/databricks-demo-generator/references/blocks/` (`domains/`, `capabilities/`, or `patterns/`).
2. Add YAML frontmatter with `name`, `slug`, `category`, `tags`, `description`, `related`.
3. Blocks on disk are automatically available to the agent's system prompt for new projects.

See the README "Extending" section for the frontmatter format.

## Security

Please report security issues privately — see [`SECURITY.md`](SECURITY.md). Do **not** open a public issue for a vulnerability.

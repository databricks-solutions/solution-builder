# Privacy & Telemetry

Databricks Solution Builder ships with **opt-out** anonymous usage analytics. This page explains exactly what's collected, why, and how to turn it off.

## TL;DR

- Analytics are **on by default** when you run the app.
- Only **aggregated, anonymized** events are sent — never PII, secrets, source code, prompts, or your data.
- We use the data **only for product improvement** — never for sales contact, marketing, or any commercial purpose.
- The underlying [`dbdemos-tracker`](https://pypi.org/project/dbdemos-tracker/) package filters at the source: only `@databricks.com` users send events. External installations send nothing in practice, but the middleware is still registered.
- To disable entirely, set `DEMO_PROMPT_GENERATOR_TRACKER_ENABLED=0` in your `.env`.

## What's collected

The `dbdemos-tracker` middleware fires on app-view events (page loads, navigation). Each event carries:

| Field | Example | Purpose |
|-------|---------|---------|
| Project identifier | `industry-demo-prompts` | Distinguish events from this app vs. other dbdemos installations |
| App version | `0.1.10` | Correlate behaviour to release |
| Page / route hit | `/projects/<uuid>` | Understand which features get used |
| Anonymized user hash | (hashed) | Distinct-user counting; not reversible to an email |
| Coarse timestamp | `2026-05-12` | Trend analysis only |

The tracker does **not** collect:

- ❌ Source code, file contents, project files, or chat transcripts
- ❌ Customer data, workspace data, or any data from your Databricks workspace
- ❌ Anthropic prompts, completions, or agent traces
- ❌ Authentication tokens, OAuth credentials, or environment variables
- ❌ IP addresses (filtered at the receiver)
- ❌ Free-text user input of any kind

## Why we collect it

The single goal is product improvement: knowing which features are used (and which aren't) so we focus engineering effort where it matters. Specifically:

- Detect dead features so we can remove them.
- Detect popular features so we can invest in them.
- Catch regressions when usage of a path drops after a release.

We **never** use this data for sales contact, lead scoring, marketing, or any commercial purpose. Sales never see it.

## How to opt out

### Local development
Set the env var in `app/.env`:
```bash
DEMO_PROMPT_GENERATOR_TRACKER_ENABLED=0
```

### Databricks App deployment
Add the same env var to `databricks.prod.yml`'s `env:` block under the relevant target:
```yaml
env:
  DEMO_PROMPT_GENERATOR_TRACKER_ENABLED: "0"
```
Then redeploy: `databricks bundle deploy`.

### Electron desktop app
Set the env var before launching the packaged binary:
```bash
DEMO_PROMPT_GENERATOR_TRACKER_ENABLED=0 open /Applications/DatabricksSolutionBuilder.app
```

In all cases the middleware is short-circuited at boot in [`app/src/demo_prompt_generator/backend/core/_factory.py`](app/src/demo_prompt_generator/backend/core/_factory.py) — no network call is ever made.

## Auditing the code

The entire tracker integration lives in two places:

1. [`app/pyproject.toml`](app/pyproject.toml) — the `dbdemos-tracker` dependency line.
2. [`app/src/demo_prompt_generator/backend/core/_factory.py`](app/src/demo_prompt_generator/backend/core/_factory.py) (lines 82–106) — the conditional registration.

The `dbdemos-tracker` package itself is open-source on [PyPI](https://pypi.org/project/dbdemos-tracker/).

## Changes to this policy

Any change that expands what's collected will be called out in `CHANGELOG.md` (when we add one) and in the release notes of the affected version. Reductions in scope just happen.

If you spot something in the code that contradicts this document, please open an issue — we'll fix the code, the doc, or both.

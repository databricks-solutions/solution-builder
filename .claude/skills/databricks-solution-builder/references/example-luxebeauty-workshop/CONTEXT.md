# Workshop context — read this first

> **You (Genie Code) are helping a Solutions Architect build the LuxeBeauty returns-intelligence solution live, one step at a time.** Everything you need is in this folder.

## Where to build

Everything lands under one `{catalog}.{schema}` the SA chooses. **If they haven't told you yet, ask** (*"Which catalog and schema should I build this workshop in?"*) before writing any SQL, then use those values wherever a prompt or spec shows `{catalog}` / `{schema}`. Never pick one silently.

## What to read (in this folder)

- **`README.md`** — the story and the key numbers: what happened, who asks, what "normal" looks like.
- **`specifications/`** — the exact names you build, verbatim:
  - `01-lakeflow.md` — raw files in the Volume, silver, gold, data quality, validation
  - `02-uc-governance.md` — metric view, Discover tag, ABAC, classification
  - `03-ml-premium-classifier.md` — feature table, model, predictions
  - `04-ai-bi.md` — dashboard and Genie space
- **`data_generation/generate_data.py`** — writes the raw data. If the data disagrees with a number in the docs, the data wins.

## Working style

- **One object at a time.** Build and validate each table, dashboard page or policy before the next.
- **Use the spec names verbatim** — later steps depend on them.
- **COMMENT every table and column** so Genie reads them as semantics.
- **Validate as you go** with a quick `SELECT` after each object.

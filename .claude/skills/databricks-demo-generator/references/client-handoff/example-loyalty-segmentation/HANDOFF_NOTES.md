# Handoff Notes — SA log

Date: 2026-05-28 (initial) / 2026-05-29 (refreshed per revised client-handoff.md algorithm)
Stage: 5 (Client Handoff)

This file is SA-facing and documents intentional stubs + manual TODOs from this worked example. The 11-step Algorithm in `client-handoff.md` produces a `HANDOFF_NOTES.md` only when there's something to report (Step 9); this example has several entries because it's a shape-only stub, not a real Stage 3+4 build.

## What was stripped (Step 2)

- **resources.json `created_resources`**: already empty (`{}`). Template hasn't been built, so no workspace resource IDs to blank.
- **README.md / META-PROMPT.md / architecture.md / specifications/*.md**: scanned for `e2-demo-field-eng|fevm-` URLs, `@databricks.com` emails, `/Workspace/Users/` paths — none found. Templates are pre-build (Stage 1-2), so no SA-fingerprint exists to strip.
- **databricks.yml**: hand-crafted in handoff shape; no SA workspace values to strip (all values are already `<placeholder>` form).

## Bundle restructure (Step 3)

- **No `${var.catalog}` / `${var.schema}` migration needed** in this example because the hand-crafted `databricks.yml` was authored directly in `client_catalog` / `client_schema` form. In a real Stage 3+4 build, this step would rename refs across `resources/*.yml` + `src/**` per `templates/databricks.yml.patch.md` Section 0.
- **Synth toggle (Step 3.3) is documented but not wired**: the worked example lacks `resources/jobs.yml` / `src/data_generation/` to wire into. The wiring pattern is shown in `templates/databricks.yml.patch.md` Section 2.

## Skill placeholder resolution (Step 6.2)

- `{{table-names}}` source: read from `specifications/01-lakeflow.md` (the bronze/silver/gold table list) — NOT from `resources.json.created_resources` (which is empty).
- `{{job-name}}` set to `loyalty-segmentation-job` (per the comment in the hand-crafted `databricks.yml` deploy block).

## Validation gate (Step 5)

Skipped — this example doesn't have a runnable bundle to validate. A real Stage 3+4 build would gate on `databricks bundle validate -t client` exiting 0; the example here is documentation, not a deployable artifact.

## Intentional stubs (this example is shape-only)

- **No `resources/*.yml`** files exist — the `include: - resources/*.yml` in `databricks.yml` documents the expected shape but won't resolve in `bundle validate`. The first real Stage 3+4 build will produce these files via Stage 4's DAB packager.
- **No `src/`** files exist — same reason.
- **No `<demo-slug>-client-handoff.zip`** — this example ships the unzipped file tree to make the structure inspectable; a real Stage 5 run produces the ZIP per Step 11.

## Net effect

For a real SA-built demo (Stage 3+4 complete), this worked example becomes much shorter — the strip pass has real fingerprint to remove, the variable migration has real refs to rewrite, the validation gate must actually pass, and only the genuine TODOs need documentation here.

See `client-handoff.md` for the full 11-step Algorithm.

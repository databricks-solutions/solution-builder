# Architecture Diagram — moved

Authoring the demo's architecture diagram (the project-root `architecture.md`)
is now owned by the **`databricks-architecture` skill**. See it for everything:

- the flat `nodes` / `edges` file format (columns, wraps, pin, bounds, custom
  logos, base64 images),
- the full component catalog + icon bank (generated from code),
- the canonical end-to-end flow + authoring rules,
- the standalone renderer (copy a viewer HTML, edit its inline JSON) and the
  `render-arch.mjs` feedback loop (render to a PNG and iterate).

Skill location: `.claude/skills/databricks-architecture/SKILL.md`.

For a demo, still write the diagram into the project-root `architecture.md` (a
```json fenced block holding the `nodes`/`edges` schema) so the Solution Builder
UI renders it on the Architecture tab.

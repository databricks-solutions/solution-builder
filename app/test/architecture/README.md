# Architecture-skill playground

Clean-room for dogfooding the **standalone `databricks-architecture` skill**
(the one packaged for use *outside* the solution builder). Mirrors the
`app/test/app_template_test/` pattern: a disposable, repeatable test bed.

```bash
./init.sh     # recompile the skill from current app code, wipe this folder
              # (incl. .claude/), install the skill fresh
claude "Create an architecture diagram for a retail demo: Salesforce + Kafka
        feeding the lakehouse, a dashboard + Genie, and a customer-facing app"
```

What a healthy run looks like: the agent reads
`.claude/skills/databricks-architecture/SKILL.md`, copies a
`renderer/architecture-{viewer,editor}.html` template, writes the flat
`nodes`/`edges` JSON into its inline block, renders a PNG via
`renderer/render-arch.mjs` to check its own work, and iterates. Open the
produced HTML in a browser to judge the result.

Everything the agent produces lands here and is gitignored. Re-run `init.sh`
for a fresh slate.

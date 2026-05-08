# Spawning subagents — shared playbook

Read this before spawning a subagent from any stage. A subagent is a fresh Claude Code session with **zero context from your conversation and no system prompt** — everything it needs must be in the prompt or in files it reads.

## When to spawn

Subagents let independent work run concurrently in a separate context while the main thread keeps going. Spawn one for: app-spec writing while the parent writes the other specs (Stage 2), building an independent Databricks resource in parallel with others (Stage 3).

Do **not** spawn a subagent for: small edits, single-file changes, iteration on prior work, or anything needing user input mid-task. The user can't see a subagent's thinking — keep steerable work on the main loop.

## Parent vs subagent — division of responsibility

| Parent prepares | Subagent owns |
|-----------------|---------------|
| Framing (task + what to return) | All design decisions inside its scope |
| List of files to read (absolute paths) | File count, names, structure (when flexible) |
| Deterministic project state (catalog, schema, warehouse_id, resource IDs) | Which tool calls to emit, in what order |
| Which ai-dev-kit skill to use (build subagent) | Ambiguity calls — make a reasonable choice, note it |
| Scope boundaries (what NOT to do) | — |

If you find yourself paraphrasing the README or listing pages / tools / data-model details in the prompt, stop — point the subagent at the source file instead.

## Rules for writing the prompt

**Reads (first turn, one batched message):**
- **Always include `PROJECT/README.md`.** Every subagent — spec, build, PDF generation, whatever — reads the demo's README first. It's the persona, story, KPI numbers, and walkthrough; without it the subagent produces technically correct but contextually blind output (generic docs instead of demo-specific ones, stats that don't match the story, etc.). Phrase it verbatim: *"PROJECT/README.md — demo story, persona, walkthrough. READ THIS — do not rely on a summary."*
- **Default: SKILL.md + the relevant `stages/NN-*.md` as the next two reads.** Gives the subagent flow, gates, coherence contracts, storytelling principles.
- **Narrow exception** — skip SKILL.md only when the task is truly isolated (e.g. generating PDFs from an already-written spec). README.md is never the exception — always include it.
- For build subagents, also include the relevant ai-dev-kit skill(s) at `SKILLS/<skill-dir>/SKILL.md` — you pick the dir-name from your *Available Skills* index.
- All paths must be fully resolved — no `DEMO_SKILL_DIR/…` placeholders (the subagent can't expand them).

**Include verbatim** (the worked example shows the exact wording):
- **Speed rules** block — batching instruction.
- **Scope** block — what NOT to do + "you own design decisions inside your scope."

**Project state** — deterministic values only (catalog, schema, warehouse_id, workspace folder, already-built resource IDs). Do NOT paste story, persona, KPI numbers, page designs, tool lists, demo flow.

**Avoid:**
- **Duplicating what a file says.** If it's in SKILL.md, a stage file, a spec, the ai-dev-kit skill, `app.md`, `TEMPLATE_MAP.md`, or the README, point at the file. Duplication drifts when the file is updated.
- **Pre-listing the design** when the scope says "subagent picks." You've robbed the subagent of the judgment it's supposed to exercise.
- **Re-enumerating CLI commands.** The skill the subagent reads knows how.

## Gate + user comms

- When you spawn, tell the user in one line (no follow-up question): *"Writing the app specs in the background — ~1 min. Continuing with the other specs meanwhile."*
- Never declare a stage complete while subagents are running. If any are pending, say so and stop the turn.
- If a subagent fails, surface what went wrong + what's salvageable. Don't silently skip.

**Completion format** (what the subagent returns): one or two greppable lines — list of files written + one-liner for spec writes; `resource_type`, `resource_id`, `resource_url`, `resources.json` updates for builds; what went wrong + how far you got for failures.

---

## Worked example — app-spec subagent

Parent is in Stage 2 and has just written `01-lakeflow.md`. Spawning the app-spec subagent in parallel with the other main-thread specs:

```
Start by reading `DEMO_SKILL_DIR/SKILL.md`, then `PROJECT/README.md` — that's the flow overview (what we're doing) and the specific demo's story we're working on. You've been spawned to write the `specifications/app/*.md` files for this demo's Databricks App, adapted to the demo's story. The parent is in Stage 2 and writing the other main-thread specs in parallel; your output must stay coherent with theirs.

When done, return a quick, short summary of the job done and any error/issue you might have.
Do not spawn further subagents. Do not ask the user questions — if something is ambiguous, make a reasonable choice and note it in your return.

**Speed rules.** Batch tool calls in the same message. Read and write in batch, Sequential reads/writes waste round-trips.

**Paths (absolute):**
- PROJECT = /abs/path/to/projects/abc-123
- DEMO_SKILL_DIR = /abs/path/to/projects/abc-123/.claude/skills/databricks-demo-generator

**Project state:**
- catalog: `my_catalog` · schema: `my_schema` · warehouse_id: `abc123wh`, ...

**Reads (all in one batched turn):**
- Understand the context
    - DEMO_SKILL_DIR/SKILL.md — flow overview; you're in Stage 2; your output sits alongside other specs the parent is writing.
    - PROJECT/README.md — demo story, persona, walkthrough. READ THIS — do not rely on a summary.
- Understand your specifci task:
    - DEMO_SKILL_DIR/stages/02-write-specs.md — spec-writing standards (sections 3 onward) - this describe your job / what you have to do.
    - DEMO_SKILL_DIR/app/app.md — app generation guide.
    - DEMO_SKILL_DIR/app/app_template/TEMPLATE_MAP.md — template structure.
    - DEMO_SKILL_DIR/references/example-luxebeauty/specifications/app/*.md — structure + density reference (all 4 files).
    - PROJECT/resources.json
    - PROJECT/specifications/01-lakeflow.md — table names + schemas.

**Output:** `PROJECT/specifications/app/*.md`. File count and names are YOUR call — adapt to this demo's capabilities (ex: drop pages if MAS/dashboard/KA are missing, change layout etc).

**Scope:**
- Do NOT spawn further subagents.
- Do NOT ask the user questions.
- Do NOT execute any part of the main flow.
- Do NOT touch files outside PROJECT/specifications/app/.
- You own app design decisions (pages, agent tools, data model, starter questions) — derive them from README + 01-lakeflow + the template map. Don't wait for direction.
```

Notice what's **not** in the prompt: no pasted story, no persona, no KPI numbers, no pre-decided page list, no pre-decided tool list, no scripted demo flow. All of that comes from the README the subagent reads. We send instructions.
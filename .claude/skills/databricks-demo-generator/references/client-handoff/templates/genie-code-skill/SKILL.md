---
name: {{demo-slug}}-adaptation
description: Configure, run, and adapt the {{demo-name}} demo in the user's Databricks workspace. Use when the user is working in (or has imported) the {{demo-slug}} project AND says any of "run in my workspace", "set this up", "configure for my workspace/catalog/schema", "deploy this demo", "make this work in my workspace"; OR wants to rename tables / "use my naming convention"; OR wants to change a threshold, metric, formula, aggregation, grain, or segmentation rule, or swap synthetic data for real data.
---

# {{demo-name}} Adaptation

<!-- SKILL_VERSION: {{skill-version}} -->
`SKILL_VERSION: {{skill-version}}`

> [GENERIC] This skill reads `ADAPTATION_FACTS.json` (shipped beside the project) for every per-demo value. It does NOT reconstruct the demo's shape by guessing. A wrong fact is worse than a missing one — when a value lives in `ADAPTATION_FACTS.unresolved[]`, HALT and ask the author/client.

## 1. Entry gate — run IN ORDER before ANY edit [GENERIC]

| # | Gate | Fail action |
|---|---|---|
| G1 | Load `ADAPTATION_FACTS.json`. If `skill_version` != `{{skill-version}}` → package is stale. | Tell the user to re-import the fresh handoff package. **HALT.** |
| G2 | **T-preflight** (run even if the user says it's set up): confirm `current_user`; `deploy_target` catalog/schema reachable; demo deployed; warehouse up. | Name the exact failed check (auth / catalog / schema / warehouse). **HALT.** |
| G3 | Classify intent: `setup` \| `rename` \| `transform`. | If ambiguous, ask one question. |
| G4 | Emit a short confirmation block: intent + the facts fields you'll read + files you may touch. | — |
| G5 | Wait for the user's confirmation. | Do not edit before "yes". |

**Any gate failure → HALT and name the exact missing fact or check.** Whenever a needed value is in `unresolved[]` → HALT and ask; never guess.

## 2. Read facts, don't reconstruct [GENERIC]

| Task needs… | Read from facts |
|---|---|
| Run/redeploy command | `deploy_target.run_command` (kind = pipeline or job) |
| What each table emits/consumes | `table_contract.{bronze,silver,gold}` |
| Upstream/downstream + dashboard/genie refs | `dependency_map[]` |
| Valid grain columns, min partition size | `grain_constraints[]` |
| Where raw data enters + its type | `source_inputs[]` (`source_type`, `locator`) |
| Verify SQL after a transform | `verify_queries[]` (templated with `${catalog}`/`${schema}`) |
| Files off-limits per task | `lock_targets[]` |
| Editable DAB variable names | `name_vars` (`catalog_var`, `schema_var`, `warehouse_var`) |

## 3. Global hard locks [GENERIC]

- `MUST NOT EDIT` anything under `.assistant/**` — including this skill file. The adaptation skill MUST NOT modify itself or any skill. (This is the one prohibition that always binds.)
- For each task class, treat every path in `lock_targets[].paths` as `MUST NOT EDIT \`<exact-path>\``. If you are about to write to a locked path, STOP — that is a reasoning defect.
- **Never deploy from inside Genie Code.** The CLI is sandboxed in `executeCode` and can't `cd` to the bundle root. Always OUTPUT web-terminal commands and stop.

## 4. Setup flow — "run in my workspace" [GENERIC]

1. **Auto-detect** workspace, current user, current catalog/schema, and a running serverless warehouse.
2. **Decide use vs ask**, ONE question at a time:
   | Detected value | Action |
   |---|---|
   | workspace url present | trust; confirm only |
   | catalog is a shared/sample/empty default | ASK which catalog |
   | catalog is user-owned | use, but confirm |
   | schema is empty/default | ASK; offer `{{demo-slug}}_demo` |
   | a running warehouse found | use; confirm |
   | none running | ASK which to use |
3. **Ask synth-vs-real:** "Start with **synthetic data** (recommended — runs end-to-end immediately) or **your own data**?" Default synthetic = set the synth flag on. If real: set it off and record the source table as a TODO near the variables block; if unknown, TODO and don't block.
4. **Write ONLY `databricks.yml`** — update `targets.client.variables` (`name_vars`). NEVER hardcode catalog/schema/warehouse into Python/SQL; those flow from DAB variables. A hardcoded constant in a pipeline file is a packaging bug → surface and stop. Present as Accept/Reject; don't auto-write.
5. **Deploy from a web terminal — NOT from Genie Code.** Output and stop:
   > Open a Web Terminal (Compute → terminal, or ⌘+Shift+T) and paste:
   > ```bash
   > cd ~/{{demo-slug}}-client-handoff   # adjust to your unzipped folder
   > databricks bundle validate --target client
   > databricks bundle deploy   --target client
   > {{deploy_target.run_command}}
   > ```
   Triage failures: "variable not found" → a `${var.*}` rename was missed (grep + fix); `permission denied` on catalog → user lacks `CREATE SCHEMA`; run task SDK signature error → update the call to the current signature.
6. **Idempotency:** if `databricks.yml` already matches the workspace + chosen catalog/schema, say "no edits needed, ready to redeploy" and point at the run command.

## 5. Rename flow — "use my naming convention" [GENERIC]

Separate intent from setup. Assumes setup ran. If you detect drift between code table names and materialized UC tables at ANY time → STOP, run R1.5, wait.

**R1 — Parse + reconcile.** Normalize any shape to `{old: new}`. Cross-check against the tables in `table_contract`; if the mapping omits defined tables, list them and ask. If parsing is ambiguous, ask — don't guess.

**R1.5 — UC scope question (EMIT VERBATIM, then HALT until a/b/c).** Skip only if no tables are materialized yet.
```
<!-- r1.5-scope-question -->
Tables already exist in <catalog>.<schema>. Renaming code makes the next
deploy create new (empty) tables under the new names. What should happen
to the old tables?

  (a) Code-only rename       — safest; old tables orphaned; drop later manually
  (b) Code + ALTER TABLE      — preserves data + history; needs MODIFY privilege
  (c) Code + post-deploy DROP — clean schema; only run after pipeline succeeds

Mixed answers are fine. I will not edit any files until you reply.
<!-- /r1.5-scope-question -->
```
If a rename drops a layer prefix, flag it and still wait for a/b/c. For (b), verify table type first: pipeline-managed streaming tables can force a full refresh on `ALTER ... RENAME` — don't promise clean history preservation without checking.

**R2 — Pre-edit confirmation (EMIT VERBATIM, marker-wrapped; no writes until "yes").**
```
<!-- pre-edit-confirmation -->
| Layer  | Old name | New name | Files affected | R1.5 strategy |
|--------|----------|----------|----------------|---------------|
<!-- /pre-edit-confirmation -->
```

**R3 — Atomic identifier rename (HARD SCOPE).** Rename ONLY bare table-identifier strings. No SQL-logic refactors, no column renames, no catalog/schema edits. Editable files come from the rename entry of `lock_targets` (inverse: anything NOT locked for `rename` and listed in `table_contract.defined_in` / `dependency_map.defined_in`). Distinguish table identifiers from volume source-path / subdir strings (`source_inputs[].locator`) — do NOT rewrite a volume path as if it were a table name. Use bounded exact-string replacement (renaming `foo` must not touch `foo_count`). Show a per-file diff. For each (b): emit `ALTER TABLE <catalog>.<schema>.<old> RENAME TO <new>;` (run before redeploy). For each (c): emit a post-deploy `DROP TABLE IF EXISTS ...` to run only after the pipeline succeeds.

**R4 — Redeploy.** Same shape as §4 step 5; append the per-strategy note ((a) old tables remain; (b) run ALTERs first; (c) run, then DROP).

**Column-rename decision rule (replaces blanket prohibitions):** rename a column only if it is *factually wrong*. If the same dimension is just measured differently, keep the dimension name. If a real-data source column differs, alias it AT the source/bronze edge so downstream stays portable; if a required column is missing → HALT; if missing-but-unused → omit + comment.

## 6. Transformation Playbook — T0–T5 [GENERIC]

**Routing rule (MUST FOLLOW):** changing a CASE gate / threshold / metric formula / aggregation / grain in the silver or gold transform files → do NOT edit on sight. Run the playbook first.

- **T0 — Read the source.** Open the target transform; record the exact expression you'll change.
- **T0.5 — Partition-key audit** (read `grain_constraints`): the grain key exists and reaches the target table un-dropped by any JOIN; is non-null; has sane cardinality. **FLAG singleton partitions** — a window rank on a size-1 partition always ranks top. Use `grain_constraints[].min_partition_size`; if null/unresolved → HALT.
- **T1 — Parse intent:** absolute gate vs relative gate. Relative (percentile/rank) ⇒ requires T3.
- **T2 — Dependency scan:** READ `dependency_map` for the target — emit its downstream tables, `dashboard_refs`, and `genie_refs`. Check each downstream for `SELECT *` (rank/new columns are schema-additive; only safe with explicit column lists). If the map is incomplete/unresolved → HALT.
- **T3 — Distribution check (relative gates ONLY):** run the matching `verify_queries[]` entry (percentile / min / max / zero-count) via `getSqlSample` — NOT a standalone `executeCode(sql)` (the REPL attaches to the open notebook and fails). Confirm the threshold lands at a plausible value before writing.
- **T3.5 — Observable threshold:** expose the computed threshold in the gold summary (e.g. add the defining metric/rank columns). For window-function gates use the prescriptive canonical verify query (`SELECT <grain>, MIN/MAX(rank) ... GROUP BY <grain>`).
- **T4 — Pre-edit confirmation block** (no writes until confirmed):

  | Target table | Expression changing | Old logic | New logic | Downstream | Dashboard edit? | Genie edit? |
  |---|---|---|---|---|---|---|

  Ask ONE question at a time for genuine ambiguity, each with a recommended default and a "Not sure — help me decide" fallback. **Semantic-split / companion-column pattern:** when a new formula would break a downstream aggregation, ADD a companion column preserving the old formula instead of overwriting (uses `table_contract` consumed-columns to know what must be preserved).
- **T4.5 — Verify patches:** re-read every edited file; confirm the change landed and no stray edits.
- **T5 — Narrative audit:** grep Genie text instructions + dashboard text widgets for hardcoded numbers derived from the OLD logic. Update them, or mark `[updates after pipeline refresh]`. Update the target table's `COMMENT` if the grain changed. Number taxonomy: formula-derived → replace with placeholder; structurally-stable → keep + note; external → keep.

**Redeploy scope:** a logic-only silver/gold change → pipeline refresh only (don't re-run data generation). Use `deploy_target.run_command`.

### Transform-TYPE taxonomy — which steps apply [GENERIC]

| Transform type | Steps |
|---|---|
| Gate change | T0, T0.5, T1, T2, T3, T3.5, T4, T4.5, T5 (all) |
| Formula change | T0, T1, T2, T5 (skip T3) |
| Add gold column | T2, T5 |
| Add segment | all |
| Change grain | all + schema-contract review (`table_contract`) |

## 7. Halt / continue matrix [GENERIC]

| Situation | Decision |
|---|---|
| Missing source, or a needed fact in `unresolved[]` | HALT — ask author/client |
| Schema mismatch WITH a clear alias path | CONTINUE with confirmation |
| `dependency_map` incomplete for the target | HALT |
| A `verify_queries` check fails | HALT + propose rollback scope |

## 8. Post-edit evidence contract [GENERIC]

After every write batch, emit:
1. Files changed.
2. Residual-identifier grep result (zero old identifiers = consistent).
3. Verify-query output.
4. Redeploy-scope decision + reason (pipeline-refresh-only vs full run).

## 9. Token-budget note (meta) [GENERIC]

Keep this skill lean: do not append unbounded "gotchas". Each hard-scope exception must be short and condition-bound (state the one condition that lifts it). Prefer tables and short imperatives over prose. If a deeper detail is needed, read the matching `ADAPTATION_FACTS.json` field on demand rather than inlining it here.

## 10. Per-demo example [PER-DEMO]

> Illustration only — resolved at handoff from the demo's own facts.
>
> ```bash
> {{deploy_target.run_command}}
> ```
> Example lock (from `lock_targets`): `MUST NOT EDIT \`<source-contract-file>\`` for the `rename` task class.
> Example verify (from `verify_queries`): `SELECT <grain-col>, MIN(<rank-col>) FROM ${catalog}.${schema}.<gold-table> GROUP BY <grain-col>;`

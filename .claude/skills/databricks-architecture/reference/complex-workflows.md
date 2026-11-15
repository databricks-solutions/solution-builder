# Complex workflows: prose labels, numbered legend, or step strip

Read this when a workflow carries many relationships and edge labels collide, or when a walkthrough must be numbered.

A workflow or lifecycle (governed ML, MLOps promotion, approval + rollback) carries many relationships. Pick per diagram:

**Option 1 — short prose ON the edge (default).** Labels wrap to 3 lines and place themselves clear of tiles, titles and each other. This works while the render stays clean (no label on a tile or another label); on a dense diagram there is nowhere free and labels land on tiles — then use Option 2. **Hard limit ~75 characters per label** (3 lines × ~25 chars); past that the text is ellipsized, and the tooltip is invisible in an exported PNG.
```jsonc
{ "id": "e-features", "from": "medallion-table@out-gold", "to": "model-training@l", "label": "Build training set from governed gold", "flow": true },
{ "id": "e-gate", "from": "model-training@r", "to": "uc-model-registry@l", "label": "Write version, alias on improvement" }
```

**Option 2 — numbered edges + a legend.** Better when the diagram is a walkthrough (the audience is led 1 → 2 → 3), sentences exceed ~75 characters, labels would repeat, or labels still collide.
- The number: an edge `label` of `"1"`, or a `type:"callout"` circle when it marks a region/stage.
- The sentences: the tab-level `legend` (`items` auto-number; `{ "n": "D1", "text": … }` for a non-sequential marker). `show:"panel"` (default) keeps it out of exports — fine for a live walkthrough; for a standalone PNG, numbers without an embedded key are unexplained, so use `"diagram"`/`"both"` only when the user asks for a printed key.
```jsonc
// fragments: an edge, a callout node (a child of the column that holds medallion-table, above it), and the tab-level legend field
{ "id": "e-brief", "from": "product-home", "to": "genie-code", "label": "1", "flow": true },
{ "id": "c2", "type": "callout", "text": "2" },
"legend": { "title": "What each number means", "items": ["Governed brief opens the project: owner, SLA, risk class", "Discover approved data; define or reuse features"] }
```
- Numbers only (`"1"`, not `"1 Commit code"`), in narrative order; markers must match legend positions; one ~5–15-word sentence per item.
- Never hand-roll a legend as a `box` of numbered text (it clips and can't feed the panel). Don't size it — it auto-sizes at a readable font.
- A legend does not fix a line through a tile — re-place, re-source the edge, or split the view.

**Option 3 — a step strip.** One column per step: the columns are the children of one top-level row. Each column lists a heading, the tool tiles, an environment and an artefact, in that order; give the environment and artefact rows a shared `track` so they line up across columns. Step order is carried by short arrows between headings. "What am I using, where, and what do I have at the end" with almost no labels.

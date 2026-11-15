# Style: lifecycle

**When:** a process with ordered stages (an ML lifecycle, a rollout, an onboarding). The reader follows the stage order first, then the items inside a stage.

A plain step list or a timeline that no stage box carries ("Week 1 … Week 6") is an `html` block with an `ol`, placed under the stages.

**Building blocks**
- One column per stage: the stage boxes are the children of one top-level row. Each stage is a titled `box`; its `title` is the stage name and the ONLY place it appears.
- Inside the box: a `callout` with the step number (`text:"1"`, `size:[48, 48]` so the number does not compete with the pictogram), a `logo` pictogram (`file:databricks-line/*` with `style.icon` set to the Databricks orange `#FF5F46`, **no** `text` or `caption`), and 2–4 `card` items. Every card in a stack gets the same explicit `size` (e.g. `[280, 64]`), with a short title and one-line summary, so the stack is even.
- Edges chain the pictograms left to right with `flow:true` (`from: "p1", to: "p2"`).
- If the request asks who owns each stage, add one `card` per stage for the accountable role (a role such as "Data steward", not the stage's consumer). If it names no owner, still add role cards, mark each `ai_reasoning: "role inferred"`, and say in the reply that they are placeholders. If the request does not ask about owners, draw none.

**Layout**
- `theme:"slide"`, `aspect:"16:9"`, `direction:"horizontal"`. Give each stage's pictogram the same `track` (for example `"t2"`), so every pictogram sits on one line across the stages.
- 3–5 stages. More than 5 stages: split into two tabs, unless the request names every stage in one list and a loop must close across them. Then keep one tab, say in `story` why it is long, and report the aspect.
- A loop the prompt describes (drift → retrain, feedback → define) is ONE labelled edge from the last stage's last card (`@b`) to the earlier stage's card (`@b`), `arrow:"end"`. The loop runs beneath the stages it passes, so keep their bottoms clear: a stage with fewer cards is shorter and leaves the room. Label the loop with what it does and where it returns ("retrain on drift"; the earlier stage is the destination). A loop the prompt does not describe is not drawn.

**Example:** `style-lifecycle.jsonc` (ingest → build → deploy → monitor, with a retrain loop).

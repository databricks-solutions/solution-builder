# Style: marketing (default)

**When:** a use-case, brief or pitch that becomes a slide. The audience reads the shape in a few seconds.

**Building blocks**
- Catalog tiles (`genie`, `sql-lakehouse`, `ai-bi-dashboard`, …) and composites (`lakeflow-genie-block`, `governance-block`, `genie-one`, `db-platform`).
- Sources as `type:"source"` with a `label` and `icon` (`file:vendor/*`, `file:cloud/*`).
- `box` for the platform (its `children`); `db-platform` and `governance-block` in one banner row at the top of the platform box (`justify: "between"`).
- `frame` with a title. Descriptions stay hidden on tiles.

**Layout**
- `theme:"slide"`, `aspect:"16:9"`, `direction:"horizontal"`.
- Columns of the top-level row as the sequence needs (3–5 is typical), 2–4 children per column. The sequence moves left to right. Size tiles so a label stays legible at slide width. Don't add tiles to fill the frame.
- Few words: labels 2–4 words, edge labels 1–3 words.
- A platform or governance strip is a banner row spanning the platform box (`align: "stretch"`), never a loose tile at the bottom centre.
- Add an app, Lakebase, write-back or AI gateway only when the text names one. A model-driven ask needs training, registry and serving; it does not need an analyst app.

**Example:** `architecture-complete.jsonc`.

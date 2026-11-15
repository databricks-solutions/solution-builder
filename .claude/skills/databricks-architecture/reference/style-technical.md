# Style: technical

**When:** the reader needs the engineering detail: named jobs and tables, keys, write modes, latencies, schedules. Current vs proposed is a good fit.

A side-by-side comparison (current vs proposed, the write modes, the latencies) is an `html` `table` block, not a row of cards.

**Building blocks**
- `type:"card"` for every component. Fields: `title`, `icon`, `badge` (corner pill), `accent` (border and header colour), and a `body` of HTML (a bold lead line, a grey line, key/value rows, tag pills). Use `style.borderStyle:"dashed"` for the current or retired path.
- A `box` with `title` and `titleIcon` for the containing schema or platform.
- Edges: `label` on each, `color` for a meaning (proposed vs current), `dashed` for the current path.
- Name only what the request names. A model, job, catalog, endpoint or app name the request doesn't give is invented: use the role instead ("Embedding model", "Foundation model", "Vector index", "Chunks table").

**Layout**
- `theme:"technical"` written explicitly, `aspect:"16:9"`, `direction:"horizontal"`.
- One column per tier (source, ingest, lakehouse, serve). Give the cards in a column the same height (`equal: "h"`) so the tracks line up across columns. Cards grow with their text.
- Current path below the proposed path, in its own row; no edge may cut across the proposed flow (check with `inspect-arch`).
- The subtitle states the scope, not the flow: a flow string that repeats the arrows reads as clutter.
- At most two tag pills per card. Card text must still read at slide width (`reference/compose.md`, Fit to a slide).

**Example:** `style-technical.jsonc` (orders CDC → UC medallion → dashboard + Genie, with the nightly-CSV path dashed grey).

# Process flows (`type:"shape"`)

Read this when the user asks for steps, decisions or a sequence of what happens.

An architecture answers *what the platform is*; a process flow answers *what happens, in order, and where it branches*. Build it from `shape` nodes, never from `box` (a box is a container and reads as nested scopes).

| `shape` | reads as | use for |
|---|---|---|
| `rounded` (default) | Process | a step — the workhorse |
| `ellipse` | Start / end | exactly one entry and one exit |
| `diamond` | Decision | a branch; label BOTH outgoing edges |
| `parallelogram` | Input / output | data in or a result out |
| `cylinder` | Data store | a table / catalog / database |
| `document` | Document | a report, notice or artefact |
| `hexagon` | Preparation | a manual step or hand-off |
| `chevron` | Phase header | a banner in a row of phases |
| `triangle` | Alert | an escalation / breach marker |
| `rectangle` | Process | a sharp-cornered step |

```jsonc
{
  "name": "Returns triage",
  "aspect": "16:9", "theme": "slide", "direction": "horizontal",
  "layout": "row", "gap": 90,
  "nodes": [
    { "id": "intake", "type": "group", "layout": "column", "gap": 60, "children": [
      { "id": "start", "type": "shape", "shape": "ellipse", "text": "Return lodged" } ] },
    { "id": "assess", "type": "group", "layout": "column", "gap": 60, "children": [
      { "id": "score", "type": "shape", "shape": "rounded", "text": "Score fraud risk" },
      { "id": "check", "type": "shape", "shape": "diamond", "text": "High risk?" } ] },
    { "id": "act", "type": "group", "layout": "column", "gap": 60, "children": [
      { "id": "manual", "type": "shape", "shape": "hexagon", "text": "Manual review" },
      { "id": "auto", "type": "shape", "shape": "rounded", "text": "Auto-approve refund" },
      { "id": "ledger", "type": "shape", "shape": "cylinder", "text": "Write decision" } ] }
  ],
  "edges": [
    { "from": "start", "to": "score", "label": "Submit claim" },
    { "from": "score", "to": "check", "label": "Risk score" },
    { "from": "check", "to": "manual", "label": "Yes" },
    { "from": "check", "to": "auto",   "label": "No" },
    { "from": "auto",  "to": "ledger", "label": "Refund issued" }
  ]
}
```
- Label every edge out of a `diamond`.
- One direction of travel; label a real loop (`Retry`, `Rework`).
- A few words per shape (pointed shapes have less room); detail goes on the edge. Default size 200×90.
- Mixing a flow with platform tiles is fine; keep the flow in its own columns or tab.

# Layout: nest the diagram, let the containers place it

A tab is a tree. The tab lays out its top-level `nodes`; every container lays out its own `children`. You write the structure (what is inside what, in which order, which things line up); the renderer computes every size and position. Never write pixel positions in a normal diagram.

```json
{
  "name": "…", "aspect": "16:9", "theme": "technical", "direction": "horizontal",
  "layout": "row", "gap": 100,
  "nodes": [
    { "id": "sources", "type": "group", "layout": "column", "gap": 40, "equal": "w", "track": "ingest", "children": [
      { "id": "src-pg", "type": "source", "label": "Postgres", "icon": "file:vendor/postgresql" },
      { "id": "src-kafka", "type": "source", "label": "Kafka", "icon": "file:vendor/kafka" } ] },
    { "id": "platform", "type": "box", "title": "Databricks", "layout": "column", "align": "stretch", "children": [
      { "id": "bar", "type": "group", "layout": "row", "justify": "between", "children": [
        { "id": "db-platform", "type": "db-platform" }, { "id": "governance-block", "type": "governance-block" } ] },
      { "id": "flow", "type": "group", "layout": "row", "gap": 90, "children": [
        { "id": "lakeflow-genie-block", "type": "lakeflow-genie-block", "track": "ingest" },
        { "id": "genie", "type": "genie" } ] } ] }
  ],
  "edges": [ … ]
}
```

## Containers

- **`box`**: a frame with a `title` (+ `titleIcon`, `subtitle`): a VPC, a subnet, a workspace, a phase, the platform. **`group`**: invisible, only places its children (a column of sources, a row of tools, a banner row). Use a group wherever you would otherwise reach for coordinates.
- `layout`: `"row"` (left → right, the default), `"column"` (top → bottom) or `"grid"` (+ `cols`: a matrix of equal cells).
- `gap`: space between children (px). Defaults: 100 between top-level nodes, 48 in a box, 32 in a group.
- `align`: cross-axis position of the children: `"center"` (default), `"start"`, `"end"`, or `"stretch"` (a container child spans the whole width or height: a banner row across its box).
- `justify`: main-axis distribution: `"center"` (rows) / `"start"` (columns) by default, `"end"`, or `"between"` (first child at the start, last at the end, spare room shared).
- `equal`: `true`, `"w"` or `"h"`: children share the largest size. Use it for a row of stages or subnets, a column of sources.
- `pad`: inner padding of a box (default 34). The title band and the subtitle are added on top, so nothing ever sits under a title.
- `size: [w, h]` on a box is a minimum.

Order is meaning: children are placed in the order you list them. Read the request left to right and top to bottom and list nodes in that order.

## Lining things up across containers: `track`

Nodes (or containers) that share a `track` line up across containers, on the cross axis of the container that holds them all: in a row of columns they share a centre line.
- The traffic path of a network diagram: every hop on the path gets `"track": "path"`, so the path is one straight line through the subnet, VNet and on-prem boxes.
- Rows across columns: a workspace and its catalog in two different boxes, `"track": "dev"`, `"track": "prod"`.
- A column of sources against the block they feed: `"track"` on the sources group and on the block.

In a column, put the member of the path FIRST: a tile stacked above it (a database above the server the path reaches) pushes the whole line down, and every box on the line grows an empty band above its tile. Put the extras below it.

List the members in the same order in every container (dev before prod everywhere). An order that makes a track impossible drops its alignment and the checker says so.

## Edge labels

The gap an edge label must sit in is widened to fit it. Keep labels short (2–4 words) and they always land in a gap, clear of tiles and borders.

## Fixed placement: `at` (exception)

`at: [x, y]` on a child places its centre at that offset from its parent's content corner, out of the flow. Use it only to transcribe a supplied image (`redraw.md`) or for a hand-composed slide where the user gave the positions. Everything else is structure.

## Fixing a layout

| Problem | Fix |
|---|---|
| Two things should be side by side / stacked | Put them in the same row / column container, in that order. |
| A tile is in the wrong box | Move it into that box's `children`. |
| Things should line up across boxes | Give them the same `track`. |
| A row looks ragged | `equal` on the container, or `align`. |
| Too cramped / too loose | `gap` on the container that holds them, or `pad` on a box. |
| A banner should span its box | `align: "stretch"` on the box, `justify: "between"` on the banner row. |

Never fix a layout by adding `at`, invisible spacer nodes or extra boxes.

## In the editor

The user edits the same tree: dragging a tile within its container re-orders it, dropping it inside another box moves it into that box, and resizing a node sets its `size`. Read the file as it is now before editing it; never rebuild the structure from scratch unless asked.

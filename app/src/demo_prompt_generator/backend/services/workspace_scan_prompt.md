# Reconstruct the architecture of an existing Databricks project

You are going to look at a project that already runs in a Databricks workspace, find every
resource it is made of and how data moves between them, and write a brief that Solution Builder
turns into an architecture diagram. You only READ: nothing in the workspace changes.

**Workspace:** {workspace}
**Start from:** {start}
**Level of detail:** {detail}

## First: check Solution Builder is connected

The diagram is created in Solution Builder through its MCP: the `solution_builder` tool (served by
the Solution Builder MCP server). Before anything else, call it with `action: "get_doc"`, `mode: "architecture"`.

If you have no such tool, or the call fails, **stop here**: don't explore the workspace. Tell the
user: "The Solution Builder MCP is not connected. Connect the Solution Builder MCP server to this agent (it provides
the `solution_builder` tool), restart the agent, and paste this prompt again." The exploration takes
several minutes, and without the tool its result has nowhere to go.

## Rules

- **Read only.** Use `get`, `list`, `describe`, `export` and `SELECT` queries on metadata and
  system tables. Never create, update, delete, run, start, stop, grant or deploy anything. Don't
  read data rows of the project's tables (column names and types are enough), except a
  `LIMIT 5` when a column's meaning is unclear.
- **Authentication.** Use the Databricks CLI. List the profiles (`databricks auth profiles`) and
  use the one for the workspace above (or the one the user named); if none matches or several do,
  ask the user which one, and never pick one silently. Check it with `databricks current-user me -p <profile>`. If the CLI is
  missing or not logged in, tell the user what to run and stop.
- **SQL.** Run queries on a warehouse that is already running (`databricks warehouses list`).
  If none is running, ask the user before using one (a query starts it). To run one:
  `databricks experimental aitools tools query -p <profile> --warehouse <id> "<sql>"`, or on any CLI
  version `databricks api post /api/2.0/sql/statements -p <profile> --json '{"warehouse_id":"<id>","statement":"<sql>","wait_timeout":"50s"}'`.
- **Stay on the project.** The workspace holds much more than this project. Explore outwards from
  the start, and keep a resource only when it is connected to it (it reads or writes the project's
  tables, it is declared in the same bundle, or it lives in the same folder or schema and is used
  with it). Objects in the trash and copies of the project in other catalogs or folders are not
  the project. Note what you left out and why.
- **Never guess.** Every resource in the brief is one you saw, with its id. What you could not
  confirm goes under "Not confirmed".
- **The live workspace wins.** Source files (a bundle, a repo) can be stale: when they disagree
  with what `get` returns, describe what runs, and note the difference.
- **Name things in full.** Filter lineage on full names (`catalog.schema.table`, the full volume
  path), never on a bare table or schema name: copies of a project often live in other catalogs
  under the same names, and they are not this project.

## How to find the pieces

Work in this order; each step gives you ids to follow in the next.

1. **The starting point.** Read it with the CLI (`pipelines get`, `jobs get`, `lakeview get`,
   `genie get-space --include-serialized-space` (without the flag it hides the tables), `apps get`,
   `tables get`, `schemas get`, …). Check `<command> --help` when a flag is not what you expect.
   Note its catalog and schema, the files or notebooks it runs, and the resources it names.
2. **The declared inventory.** If its code lives in a bundle (a workspace path ending in
   `/files/…`, or a `.bundle` folder), export the bundle's `databricks.yml` with
   `databricks workspace export` (a notebook's path has no `.py`; a folder needs `export-dir`). Then only the code that tells
   you what runs: the pipeline sources, the notebooks the jobs run, and the app's data-access code;
   not every file the bundle includes. An app's settings (the ids it is given) are in the bundle
   or its `app.yaml`, not in `apps get`, which shows only their names. It lists the project's jobs, pipelines,
   dashboards, apps, volumes, models and their settings: the closest thing to the truth. A folder
   of notebooks or a repo next to the code tells you the same.
3. **Lineage.** `system.access.table_lineage` (keep the last 90 days) gives, per read or write, the
   source and target table (`*_table_full_name`; for files, `*_path`), and the `entity_type` / `entity_id` that did it (`PIPELINE`,
   `JOB`, `NOTEBOOK`, `DASHBOARD_V3`, …). Start from the project's tables and follow it upstream to
   where data comes from (files in volumes or cloud paths, tables of other schemas, foreign
   catalogs) and downstream to what uses them. `system.access.column_lineage` gives column
   detail when you need it.
4. **Who reads the tables.** Lineage rows with an empty `entity_type` are SQL run on a warehouse
   or by a service. `system.query.history` tells who: its `query_source` names the dashboard,
   Genie space, job, notebook or alert; `executed_by` / `client_application` show an app's
   service principal or an outside tool (Power BI, Tableau, dbt, a JDBC client). The SQL text is
   `statement_text`; the others you need are `start_time`, `executed_by`, `executed_as`,
   `query_source`, `client_application`. Over the last 30 days, aggregate (`GROUP BY` the source
   and the caller) rather than reading rows. Search it in this order: by the ids you already have
   (`query_source.dashboard_id`, `query_source.genie_space_id`, `query_source.job_info.job_id`, an
   app's service principal in `executed_by`); by the full table names; and, only if those find
   nothing, by the schema name, because apps and dashboards often query unqualified names (this one
   is noisy: check the catalog of every hit). It is also the fastest way to find the Genie spaces
   and dashboards that read the project's tables: their ids are in `query_source`; don't page
   through every space in the workspace.
5. **Everything next to it.** In the project's schemas: tables (and their type: managed,
   streaming table, materialized view, metric view, view, foreign, synced to Lakebase), volumes,
   functions (`information_schema.routines`; `SHOW USER FUNCTIONS` fails across catalogs),
   registered models (`registered-models list`, `get --include-aliases` for the aliases; the endpoints that serve one are those in
   `serving-endpoints list -o json` whose `config.served_entities[].entity_name` is its full name). Then the apps (`apps list`, each app's `resources`, and its source code for what it reads
   and writes), Genie spaces (their tables), Lakebase databases (`postgres list-projects`,
   `list-databases`) and synced tables (in Unity Catalog, or in the app's code), model serving
   endpoints, vector search indexes (`vector-search-endpoints list-endpoints`, then each endpoint's
   `list-indexes`, keeping the indexes on the project's tables), and the jobs that schedule the pipeline. Tags, row filters and
   column masks are in `<catalog>.information_schema`.
6. **What it all means.** Lineage has no task level, and code that reads with pandas or a
   connector leaves none, so read the code of each job task to know what it reads and writes.
   A dashboard's SQL is in its `serialized_dashboard` (`datasets[].queryLines`). Pipeline and job code (SQL or Python) shows the medallion layers, the
   transformations that matter (AI functions, ML scoring, CDC), the schedule, and the ingestion
   (Auto Loader paths, Lakeflow Connect connectors, Kafka, Zerobus). Table and column comments,
   README files and dashboard titles tell the business story. When a README names upstream
   systems the code doesn't show (the data is generated, or landed by something you can't see),
   say so: "described in the README, not seen in the workspace".

Links: every link in the brief is a full URL (`https://<host>/…`), so it can go on its node. Build it
from the workspace host: `/pipelines/<id>`, `/jobs/<id>`,
`/dashboardsv3/<id>/published`, `/genie/rooms/<id>`, `/explore/data/<catalog>/<schema>/<table>`,
`/explore/data/volumes/<catalog>/<schema>/<volume>`, `/explore/data/models/<catalog>/<schema>/<model>`,
`/ml/endpoints/<name>`, `/apps/<name>`, `/sql/warehouses/<id>`, `#workspace<path>` for a folder.
Add `?o=<workspace id>` when the workspace URL has one. For a resource with no pattern here
(a Lakebase database, an experiment), give its name and id, and no link rather than a guessed one.

## Write the brief

Markdown, in this order. Every resource with its name, its id and its link.

1. **The project in two sentences:** what it does and for whom.
2. **Sources:** the systems data comes from (as far as the code and paths tell: an ERP, a CRM,
   files, an event stream…) and where it lands (volume or path).
3. **Ingestion and processing:** each pipeline and job, what it reads and writes, its layers,
   the notable transformations, its schedule.
4. **Data:** {detail_tables}
5. **Serving and use:** each dashboard, Genie space, app, model and endpoint, Lakebase database,
   outside tool; for each, which tables it reads and who uses it.
6. **Governance and platform:** catalog and schemas, the warehouse(s), service principals,
   anything notable (row filters, tags, sharing).
7. **Left out of the drawing:** plumbing that doesn't explain the architecture (config or
   resource-id tables, pipeline event logs, platform-internal tables and the jobs that build them,
   grants), objects in the trash, and copies of the project elsewhere. One line each.
8. **The flows:** one line per arrow, `A → B: how` (ingest, transform, read, serve, write back).
9. **Not confirmed:** what you saw hints of but could not verify.
10. **How to draw it:** sources on the left, then ingestion and processing, the data, then each
   consumer on the right (one node per dashboard, Genie space and app, not one "BI" box), the
   users last. Level of detail: {detail}. Ask for each resource's link on its node.

## Hand it over

Call `solution_builder` with `action: "create"`, `mode: "architecture"`, `style: "technical"` and the
whole brief as `request`. Give the user the link it returns: the diagram is drawn there in a few
minutes, and they review and edit it in Solution Builder. If the call fails, show the error and the
brief, so nothing is lost.

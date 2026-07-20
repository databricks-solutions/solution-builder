# MCP Layer Spec — Solution Builder for external agents

## Purpose

Expose the Solution Builder (the generator app in `app/`) to an **external agent**
over MCP, so it can browse projects, get a project's resources + live links,
suggest new solution ideas, create a solution, and drive the build conversation —
without a human in the loop.

The MCP layer is a **thin, stateless wrapper over the existing FastAPI `/api`
surface** (no new business logic; it forwards to the endpoints below). It runs
as its own process/server that holds one config: the generator's base URL + the
caller identity to forward.

**Design constraints (locked):**
- **3 tools** — `projects` (list/get/create), `suggest_projects`, `converse`. The
  read/write project ops and the conversation ops are each folded into one
  `action`-dispatcher tool to keep the surface + token footprint tiny.
- **Send + poll** for the agent turn (never block for minutes): `converse
  action=send` returns an `execution_id`; the agent polls `action=messages` /
  `action=status` until the turn is idle.
- **`projects action="get"` folds in the deployed-resources/links** so a caller gets
  the overview + resources in one round-trip (mirrors the UI's cached,
  LLM-restructured resource view). No file contents (kept out for now).

## Identity / auth (summary — full detail in `mcp-auth-spec.md`)

The generator sits behind the Databricks Apps proxy, which sets `X-Forwarded-Email`
from the **authenticated caller** and strips any client-supplied value — you cannot
inject a fake user email through the front door. So identity works in **two modes**
(full detail + code hooks in [`mcp-auth-spec.md`](./mcp-auth-spec.md)):

- **Mode 1 — Human:** a real user logged into the app → `X-Forwarded-Email` = the
  user, `X-Forwarded-Access-Token` = their token → build OBO the user. Unchanged.
- **Mode 2 — MCP/Lemma:** the MCP server authenticates as an **auth-SP**, so
  `X-Forwarded-Email` = the auth-SP (unspoofable). The generator recognizes that
  email == configured `MCP_AUTH_SP_EMAIL` ⇒ trusted machine caller ⇒ it (a) treats
  the **`on_behalf_of_email`** request param as the project owner, and (b) builds the
  resources with a **separate configured deploy-SP** (not the auth-SP, not the user).
  Two SPs, both optional config: **auth-SP** = trust trigger (no build perms),
  **deploy-SP** = builder (no app access).

`on_behalf_of_email` is a request PARAM (not a header — the proxy controls headers).
It's *attribution, not authentication*, trusted because Lemma is a first-party caller
and the trigger is proxy-enforced. Resources are owned by the **deploy-SP** in UC;
the project is *attributed* to `on_behalf_of_email`. Lemma never sees any credential.
(Option 2, true per-user OBO where alice owns the UC objects, is a later opt-in in
the auth spec.)

---

## The 3 tools

`projects` (list / get / create), `suggest_projects`, `converse`. Two are `action`
dispatchers so the surface stays tiny.

**Common param — `on_behalf_of_email` (every tool).** The identity the generator
authorizes as when the caller is the MCP server (see auth spec — the generator maps
it to the owner because it recognizes the auth-SP). **Required on
`projects(action="create")`** (a new project must be attributed to a human); accepted
elsewhere and should be passed through per session — it scopes `projects(action="list")`
to that user and makes `get`/`converse` act as them. It is *attribution, not
authentication*. The MCP server injects the Databricks credentials itself (auth-SP to
reach the app; deploy-SP builds when remote-deploy is on) — callers never supply any.

---

### 1. `projects` — list / get / create (action dispatcher)

```
projects(action: "list" | "get" | "create", on_behalf_of_email, …action params)
```

**`action="list"`** — the caller's projects, newest-first.
- Wraps `GET /api/projects` (`listProjects`).
- Params: `on_behalf_of_email`. *(optional `include_shared: bool=false` →
  `GET /api/shared-projects` to also return projects shared with the user.)*
- Returns a lean array (NO files, NO resources — that's `get`):
  ```jsonc
  [{ "id", "name", "description", "stage", "created_at", "updated_at",
     "message_count", "file_count", "owner_email", "shared_role" }]
  ```
  `stage` ∈ `DRAFTING | SUMMARIZED | ARCHITECTED | SPECIFICATION | BUILT | BUNDLED`.

**`action="get"`** — one project's metadata + its deployed resources with live links
(the same LLM-restructured, cached view the UI shows). **No file contents** (kept out
for now).
- Params: `project_id` (required), `on_behalf_of_email`.
- Wraps (fan-out, server-side):
  - `GET /api/projects/{id}` (`getProject`) → metadata.
  - `GET /api/projects/{id}/deployed-resources` (`getDeployedResources`) → resource
    links + per-capability build status. **This is the endpoint that runs
    `resources_extractor` (LLM normalization, content-hash cached) + builds the URLs
    + recomputes stage** — identical to the UI's resource grid.
- Returns:
  ```jsonc
  {
    "id", "name", "description", "stage", "mode",
    "catalog", "schema", "narrative",           // narrative = short story summary
    "all_built": bool,                          // every buildable capability done
    "capabilities": [{ "slug", "built" }],      // per-capability build status
    "resources": [{ "resource_type", "label", "url", "resource_id" }],
    "deployed_at": "…|null",
    "extraction_error": "…|null"                // surface if the LLM extractor failed
  }
  ```
  > `resource_type`: `catalog_explorer`, `pipeline`, `dashboard`, `genie_space`,
  > `metric_view`, `ml_model`, `mlflow_experiment`, `app`, `knowledge_assistant`,
  > `multi_agent_supervisor`, `lakebase_project`, `vector_search`, … A resource with
  > `built:true` but `url:null` is built but has no deep-link (e.g. preview-only app,
  > Lakebase DB with no recorded id).

**`action="create"`** — create a new project + attribute it to a human.
- Wraps `POST /api/projects` (`createProject`).
- Params:
  - `description: str` (required) — name + schema generated from this server-side.
  - `capabilities: string[] = []` — flat capability IDs (from `suggest_projects` or
    the catalog). The backend classifies them into `buildable`/`talking_track` and
    seeds `resources.json`.
  - `mode: "story" | "architecture" | "workshop" = "story"` — build fork.
  - `initial_prompt: str = ""` — optional first user message on the conversation.
  - **`on_behalf_of_email: str` (REQUIRED)** — the human this project is for →
    becomes `project.user_email` (the owner). Fail the call if missing.
- Returns: `{ "id", "name", "stage", "mode" }`.
  > No `catalog`/`schema` param — catalog is server config; schema auto-generated.
  > `mode:"architecture"` = lead-with-diagram (assets provisioned later).

---

### 2. `suggest_projects`
Return **3 concrete solution ideas** for a seed prompt/industry, each with a
title, a one-line hook, and a **suggested capability list** the caller can pass
straight into `projects(action="create")`.

- **Wraps:** `POST /api/capabilities/suggest` (`suggestCapabilities`) — this is an
  **SSE stream** server-side (emits `count`, then one `idea` event per idea, then a
  final `capabilities` event). The MCP tool **consumes the stream server-side and
  returns the aggregated result** (the external agent gets a plain array; it does
  not see SSE). Also uses `GET /api/constants/capabilities` (`getCapabilities`) to
  resolve capability names.
- **Params:**
  - `prompt: str` (required) — the seed idea / industry / use-case ("retail loyalty
    churn", "manufacturing predictive maintenance", …). A vague prompt yields 3
    ideas; a detailed brief may yield 1.
  - `context_text: str = ""` — optional pasted brief/PRD to ground the ideas.
- **Returns:**
  ```jsonc
  {
    "ideas": [                                  // up to 3
      { "title", "hook", "datasources": [str],
        "capabilities": [ "aibi-dashboards", "genie", … ] }  // capability IDs
    ]
  }
  ```
  The `capabilities` per idea are the IDs from `getCapabilities` (same catalog the
  app uses), directly usable as `projects(action="create").capabilities`.

> Implementation note: the live endpoint's `idea` events carry `{title, hook,
> datasources}`; the final `capabilities` event carries the validated ID list for
> the *selected* idea. To attach per-idea capabilities, the MCP server calls
> `suggest` once to get the ideas, then (cheap) resolves each idea's capabilities
> either from the stream's `capabilities` event or a follow-up `suggest` with
> `refine_idea` set. Simplest v1: return the ideas + the single `capabilities`
> set the stream emits, and let `projects(action="create")` accept a free capability list.


---

### 3. `converse`
Drive the build conversation — the stateful tool, split by `action`.

- **Params:**
  - `project_id: str` (required)
  - `action: "send" | "messages" | "status"` (required)
  - `message: str` — required when `action="send"`.
  - `limit: int = 20` — for `action="messages"`.
  - `on_behalf_of_email` — as above.
- **Actions:**

  **`send`** → wraps `POST /api/invoke_agent` (`invokeAgent`). Fires the agent turn
  as a background task and returns immediately:
  ```jsonc
  { "execution_id": "…", "status": "running" }
  ```
  (Never blocks — a turn can take minutes.)

  **`status`** → wraps `GET /api/projects/{id}/execution` (`getActiveExecution`).
  The **poll signal**:
  ```jsonc
  { "running": true, "execution_id": "…" }   // turn in flight
  { "running": false }                        // idle → turn done, read messages
  ```

  **`messages`** → wraps `GET /api/projects/{id}/messages?limit=` (`listProjectMessages`),
  oldest-first. Use `limit: 1` for just the latest:
  ```jsonc
  [{ "id", "role", "content", "is_error", "is_cancelled", "created_at" }]
  ```

- **The send→poll→read loop the external agent runs:**
  1. `converse(action="send", message="…")` → `{execution_id}`.
  2. Poll `converse(action="status")` every few seconds until `running: false`.
     (Recommend a cap, e.g. 20 min, and a backoff; a build turn is minutes.)
  3. `converse(action="messages", limit=1)` → the assistant's reply. Check
     `is_error` / `is_cancelled`.

---

## Typical external-agent flow (create → build)

```
suggest_projects(prompt="retail loyalty churn demo", on_behalf_of_email="alice@co")
    → pick ideas[0]  (title, hook, capabilities[])
projects(action="create", description=ideas[0].hook,
         capabilities=ideas[0].capabilities, mode="story",
         initial_prompt=ideas[0].hook, on_behalf_of_email="alice@co")
    → { id: "proj-abc", stage: "DRAFTING" }
converse(project_id="proj-abc", action="send",
         message="Build the full solution", on_behalf_of_email="alice@co")
    → { execution_id }
loop: converse(project_id="proj-abc", action="status", …) until running=false  # minutes
converse(project_id="proj-abc", action="messages", limit=1, …)   # read the reply
projects(action="get", project_id="proj-abc", on_behalf_of_email="alice@co")
    → resources[], all_built, capabilities[]        # + live links
```

## Notes / scope

- **Stateless, thin wrapper.** No new backend logic; each tool = 1–3 existing
  `/api` calls the MCP server fans out. The SSE endpoints (`suggest`,
  `stream_progress`) are consumed **server-side** so the external agent only ever
  sees plain JSON (send+poll model, no streaming over MCP).
- **Completion protocol** for the turn is pull-based (`getActiveExecution`), not
  SSE — chosen so the MCP call never hangs and works over vanilla request/response.
- **Identity** is injected by the MCP server (the auth-SP reaches the app; the
  deploy-SP builds when remote-deploy is on — see `mcp-auth-spec.md`); the external
  agent supplies only `on_behalf_of_email`, never credentials.
- **Errors** surface as-is: HTTP 403 (viewer/no write), 409 (not the conversation
  driver + stale token — a shared-project case), `extraction_error` on
  `projects action="get"` when the resource-extractor LLM failed. The MCP tools pass
  these through as structured errors, not swallow them.
- **Out of scope for v1** (add later as new actions/params — not new tools): sharing,
  take-over/driver management, clone, delete, provision-architecture, brand, resource
  pickers (clusters/warehouses/catalogs). Keep the surface at 3 tools.

# Company Brand Service — Spec

**Status:** design (not yet implemented)
**Goal:** given a company name (e.g. `Rolls-Royce`), return its **brand** — a
**logo** (image bytes/URL) and a **color palette** (hex list) — by resolving the
official site, exploring a few pages with a thin AI-driven loop, and extracting
the assets. Feeds the `Project.customer` → auto-brand the demo (architecture
diagram logo, dashboard palette, app theme).

## Why

We already capture `Project.customer` (chat-inferred + editable). Knowing the
customer lets us pull their real logo + brand colors and skin the demo to them —
a big "wow" for customer-facing demos. This spec designs a backend service +
route that turns a name into a brand.

## Hard truths (from research — these shape the design)

- **DuckDuckGo keyless search works but is rate-limit-fragile** (`202`/`403`
  under light automated load; the `ddgs` lib and `html.duckduckgo.com` both).
  → **Lead with a domain GUESS, use search only as fallback.**
- **Clearbit logo API is DEAD** (HubSpot sunset Dec 2025). Its successor is
  **Logo.dev** (keyed, high-res, by-domain) — a **v2** enhancement, not v1.
- **We use the OpenAI Agents SDK (`openai-agents`) as the loop** — but pointed
  at our **Databricks serving endpoint** via a custom `AsyncOpenAI` client, with
  **tracing disabled** (else it uploads traces to OpenAI and needs their key).
  Each component is an `@function_tool`. We do NOT use the SDK's hosted
  `WebSearchTool` (that one IS keyed + billed + server-side) — our search is a
  keyless DuckDuckGo `@function_tool`.
- **The agent's job is THIN.** Fetch/parse/palette are deterministic Python
  (each wrapped as an `@function_tool`). The model only makes *selection*
  judgments (which URL is the official site; which candidate image is the real
  logo when heuristics tie) + confirms identity (brand collisions, e.g.
  Rolls-Royce cars vs aerospace) and decides when to re-search.
- **Biggest failure mode: SPA sites** (logo not in server HTML). v1 degrades
  (og:image/favicon/Wikipedia); v2 adds a headless browser.

## Architecture

```
GET /api/brands/resolve?name=Rolls-Royce
        │
        ▼
 BrandService.resolve(name)                       services/brand_service.py
   1. resolve_domain(name)        ── guess <slug>.com → confirm; else DDG search
   2. Agents-SDK run (thin loop): ── Runner.run(agent, f"Find the brand for {name}")
        agent = Agent(model=<databricks endpoint>, tools=[
                  search, fetch_page, get_brand_signals ])   # all @function_tool
        model picks official site + best logo candidate, may re-search
   3. extract_logo(candidates)    ── deterministic scoring cascade (a @function_tool)
   4. extract_palette(logo_bytes) ── colorthief/k-means + CSS --color vars
   5. cache + return
        │
        ▼
 BrandOut { name, domain, confidence, logo_url|logo_data_url, palette[], source, warnings[] }
```

**Agent wiring (OpenAI Agents SDK on the Databricks endpoint):**
```python
from agents import Agent, OpenAIChatCompletionsModel, Runner, function_tool, set_tracing_disabled
set_tracing_disabled(True)                       # no OpenAI key / no trace upload
client = ws.serving_endpoints.get_open_ai_client()   # same client LLMService uses
model  = OpenAIChatCompletionsModel(model=config.ai_gateway_mini, openai_client=client)
agent  = Agent(name="brand-scout", instructions=..., model=model,
               tools=[search, fetch_page, get_brand_signals])
result = await Runner.run(agent, input=f"Find the official brand for {name}")
```
The SDK owns the loop — no hand-rolled tool-call machinery. Verified the SDK
supports a custom `AsyncOpenAI` client + `set_tracing_disabled(True)` for
non-OpenAI, keyless-to-us operation.

**Reuse (from infra research):**
- The **Databricks OpenAI-compatible client** (`ws.serving_endpoints.get_open_ai_client()`,
  the same one `LLMService` builds) — fed to `OpenAIChatCompletionsModel`.
- `httpx` (already a dep) for all fetching. **Never DuckDB** (fetch-only, can't
  search — confirmed; the user meant DuckDuckGo).
- Route/service pattern: `create_router()`, `response_model` + `operation_id`,
  `Dependencies.{Client, Config}` (mirror `routes/me.py`).
- Blob/cache pattern mirrors the architecture-snapshot PNG write.
- **New dep:** `openai-agents` (the Agents SDK). Not currently in pyproject.

## Components

### 1. `resolve_domain(name) -> DomainCandidate` (deterministic-first)
- **Guess:** slugify → try `<slug>.com`, `<slug>.co`, `<slug>.io` with a
  browser-UA `GET`; confirm by matching the page `<title>` / `og:site_name`
  against the name (fuzzy). This beats keyless search for well-known companies
  and avoids the rate-limit.
- **Fallback:** DDG search (`ddgs`) `"<name> official website"` with backoff +
  a small result count; hand the top URLs to the agent to choose.
- **Confidence** score returned so the UI/agent can flag low-confidence.

### 2. Thin agent loop (`LLMService.chat_tools`)
Tools (mostly deterministic Python; the model orchestrates):
- `search(query) -> [url]` — DDG keyless (+ domain-guess shortcut). Best-effort.
- `fetch_page(url) -> {final_url, status, title, og_site_name, links[]}` — httpx
  GET, follow redirects, browser UA, parse with **selectolax** (fast). Returns
  anchors so the model can pick `/`, `/brand`, `/press`.
- `get_brand_signals(url) -> {jsonld_logo, og_image, apple_touch_icon,
  header_img_candidates[], svg_logo_candidates[], css_color_vars[]}` — ONE parse
  pass collapsing image + meta + JSON-LD + CSS extraction (keeps the loop short).
The model's decisions: pick official site (identity confirm), pick logo when
heuristics tie, decide to re-search. Bounded to ~4-6 tool calls.

### 3. `extract_logo(candidates) -> LogoResult` (deterministic scoring cascade)
Ranked best→worst (v1, keyless):
1. **JSON-LD `Organization.logo`** (declared logo, high quality when present).
2. **Inline `<svg>` / header `<img>`** scored by `alt|class|id|filename` matching
   `logo|brand|wordmark`, near page top, links to `/`. SVG preferred (crisp).
3. **`og:image`** (present often, but may be a social card — lower rank).
4. **`apple-touch-icon`** (180×180 PNG — guaranteed-ish fallback).
5. **Wikipedia/Wikimedia** infobox logo (secondary fallback for known cos).
Download the chosen asset with `Referer: <page>` (hotlink protection). Store both
a `logo_url` and inlined `logo_data_url` (base64) so the frontend/diagram can use
it offline.
- **v2:** prepend **Logo.dev** (`img.logo.dev/<domain>?token=`) as #1 — biggest
  reliability jump; needs a token in config.

### 4. `extract_palette(logo_bytes, css_color_vars) -> [hex]`
- Primary: dominant colors from the logo — `colorthief` (median-cut) or a small
  k-means (Pillow+numpy). For SVG, parse `fill=`/`stop-color=` hex directly.
  **Filter near-white/black + low-saturation** clusters (backgrounds dominate).
- Merge in scraped CSS `--brand`/`--primary`/`--color-*` values when present.
- Return an ordered palette (primary first) — reuse the diagram's palette shape.

### 5. Caching + storage
- **`CompanyBrand` table** (new SQLModel): `name` (pk/slug), `domain`,
  `logo_url`, `logo_data` (bytes, compressed), `palette` (JSON), `source`,
  `confidence`, `fetched_at`, `expires_at`. TTL ~30d; return cached first.
- Keyed by normalized name → never re-hit search for the same company (critical
  given DDG rate limits).
- Config: `BRAND_CACHE_TTL_DAYS`, later `LOGO_DEV_TOKEN`, `BRAVE_API_KEY`.

## API

```
GET  /api/brands/resolve?name=<company>          operation_id=resolveBrand
     -> BrandOut (cached or freshly resolved)
POST /api/projects/{id}/brand                    operation_id=setProjectBrand
     -> attach a resolved brand to a project (persist logo + palette for reuse)
```
`BrandOut { name, domain, confidence, logo_url, logo_data_url, palette[],
source, warnings[] }`. Always returns partial results + `warnings` rather than
failing (e.g. "logo=favicon-fallback", "SPA — logo may be incomplete",
"low-confidence domain").

## Frontend (later, separate)
- On the Overview/customer chip: a "Fetch brand" action → calls `resolveBrand`,
  shows the logo + palette swatches, lets the user accept/reject/re-search.
- Accepted brand → feeds the architecture diagram (custom logo) + dashboard
  palette. (Out of scope for the service spec; noted for continuity.)

## Failure modes handled
- Keyless search throttled → domain-guess path + cache + backoff; degrade to
  "name only, no domain" with a warning.
- SPA / WAF-blocked → og:image/favicon/Wikipedia fallback + warning; v2 headless.
- Brand collision (Rolls-Royce cars vs aerospace) → identity-confirm step; return
  `confidence` + `warnings` so the user can correct.
- Hotlink-protected logo → retry with `Referer`; else fall back down the cascade.

## Rollout
- **v1 (keyless):** domain-guess → DDG fallback → selectolax parse → logo cascade
  (no Logo.dev) → colorthief palette → cache. Works well for well-known,
  server-rendered sites; degrades gracefully otherwise.
- **v2 (keys/headless):** Logo.dev token (logo), Brave/Tavily key (search),
  Playwright (SPA logos + computed-style palette), optional Brandfetch
  (logo+colors+fonts in one call).

## New dependencies
- `openai-agents` (the Agents SDK — runs the loop; pointed at the Databricks
  endpoint via a custom client + tracing disabled).
- `selectolax` (fast HTML parse), `colorthief` (or Pillow+numpy k-means),
  `ddgs` (keyless search, best-effort). All small. No DuckDB.

## Open decisions (for the user)
1. **v1 scope:** keyless only, or accept ONE signup (Logo.dev) for a big logo
   reliability jump from day one?
2. **Attach to project now** (`POST /projects/{id}/brand` + persist logo +
   palette) or ship the `resolve` endpoint first and wire project-attach later.

# MCP Auth — the single spec (decision + how-to)

How an **external agent** authenticates through the MCP layer to the Solution
Builder, so the generator can build Databricks resources. One document: the
decision first (for a human choosing), then the mechanics, then a glossary.

---

## TL;DR — the one decision you have to make

Building resources "as the user who called" (**OBO** — on-behalf-of) is desirable
for ownership + audit, **but it forces each user to log in once in a browser.** You
cannot have per-user attribution *and* zero user interaction — proving "it's alice"
requires alice to have authenticated at some point. So the choice is:

| | **Option 1 — Service Principal (M2M)** | **Option 2 — On-behalf-of user (OBO)** |
|---|---|---|
| **User has to do anything?** | ❌ **No — ever.** Fully silent. | ⚠️ **Yes — log in once** in a browser, then silent forever after. |
| **Who owns the created resources** | one shared service principal (`solution-builder-bot`) | the actual calling user (alice owns her pipelines/genie/app) |
| **Who-asked attribution** | only as metadata you attach (tag `requested_by: alice`) | real identity, native in UC + audit logs |
| **UC permissions** | the SP's grants apply to everyone's builds | each user's own grants apply |
| **Audit trail** | "the bot did it" | "alice did it" |
| **Setup effort** | lowest — one SP + secret | one OAuth app registration + a one-time login per user |
| **Fails if the caller is headless** (cron/backend, no browser) | ✅ works | ❌ can't do the interactive login (unless token-exchange, see below) |
| **Good when** | the external app is a trusted shared automation; "who asked" as a tag is enough | you genuinely need per-user ownership / governed catalogs / real audit |

**Rule of thumb:**
- Need to know **who asked** → **Option 1** (M2M + tag the email). Zero friction.
- Need resources genuinely **owned by / audited as the user** → **Option 2** (OBO),
  and accept the one-time login.

**The one-time login is not a quirk of the design — it *is* OBO.** The only way to
remove it entirely is to give up per-user identity (Option 1). See "Softening the
login" below for how to make Option 2's prompt nearly invisible when your users
already have a federated SSO session.

Everything downstream is identical either way: the generator receives
`X-Forwarded-Email` + (for OBO) `X-Forwarded-Access-Token` and runs the build. The
5 MCP tools (`mcp-layer-spec.md`) don't change.

---

## ✅ CHOSEN DESIGN — three orthogonal knobs (identity · builder · target)

The design has **three independent knobs**. Keeping them separate is what makes it
compose cleanly (MCP and remote-deployment are not the same feature).

**Why we can't just spoof the user email (the constraint everything is built around):**
the generator sits behind the Databricks Apps proxy, which sets `X-Forwarded-Email`
from the *authenticated caller* and **strips any client-supplied value**. So a machine
(MCP server) authenticating to the app as a Service Principal CANNOT make
`X-Forwarded-Email` say "alice" — it says the SP. The design embraces that.

### Knob 1 — WHO'S THE CALLER / OWNER (identity)
- **Human in the browser (default, unchanged):** proxy sets `X-Forwarded-Email` = the
  real user (alice) and `X-Forwarded-Access-Token` = alice's token.
- **MCP / Lemma caller:** the MCP server authenticates to the app as an **auth-SP**,
  so the proxy sets `X-Forwarded-Email` = the auth-SP (unspoofable). The generator
  recognizes `X-Forwarded-Email == MCP_AUTH_SP_EMAIL` (conf) ⇒ trusted machine caller
  ⇒ it trusts the **`on_behalf_of_email`** request PARAM (body — never a header) as
  the owner. Trust is sound: the trigger is proxy-enforced, and Lemma is first-party.

### Knob 2 — WHO BUILDS (deployment identity), set by the REMOTE-DEPLOYMENT flag
- **Off (default):** deploy on the local workspace using the **caller's OBO token**
  from the header (`X-Forwarded-Access-Token`). Build runs as the user. Exactly today.
- **On:** deploy using a configured **deploy-SP** (OAuth M2M — `DEPLOY_SP_CLIENT_ID`
  / `DEPLOY_SP_SECRET`; the generator mints a fresh ~1h token per request), **assumed
  to be workspace admin**. The caller's OBO token is NOT used for the build.

### Knob 3 — WHERE (target workspace), when remote-deployment is on
A target workspace host (user's advanced option; a default if they have none). The
build's `.databrickscfg` gets the deploy-SP token + that target host, so resources
land on the chosen workspace — not necessarily the one hosting the app. *(Host
selection is intentionally out of scope for this spec — just know "remote" means the
target workspace may differ from the app's.)*

### How the knobs compose
| Caller (Knob 1) | Remote-deploy (Knob 2) | Owner | Build runs as | Where |
|---|---|---|---|---|
| Human | off | the user | the user (OBO) | local |
| Human | on | the user | **deploy-SP** (admin) | target ws |
| MCP/Lemma | off | `on_behalf_of_email` | *(n/a — MCP mode implies a machine builds; use remote-deploy)* | — |
| MCP/Lemma | on | `on_behalf_of_email` | **deploy-SP** (admin) | target ws |

MCP mode naturally rides remote-deployment (a machine caller has no user OBO token to
build with). Remote-deployment is *also* useful standalone for a human ("alice owns
it, the admin SP builds it remotely"). The two SPs are independent and **both
optional in conf** — absent ⇒ that capability is simply off; purely additive to the
current human-only, local-OBO setup.

### The two service principals
| SP | Conf | Job | Needs |
|---|---|---|---|
| **auth-SP** | `MCP_AUTH_SP_EMAIL` (its identity) | trust trigger — prove the caller is our MCP server | access to the app; **no build perms** |
| **deploy-SP** | `DEPLOY_SP_CLIENT_ID` / `DEPLOY_SP_SECRET` (OAuth M2M) | build the resources (when remote-deploy on) | **workspace admin** on the target ws; **no app access** |

Authenticator ≠ builder, by design (least privilege): the SP that can call the app
can't build; the SP that builds can't call the app.

### How it slots into the code (verified)
- **Caller detection:** handlers already read `X-Forwarded-Email`
  (`backend/core/_headers.py`). Add `is_mcp_caller = (user_email == MCP_AUTH_SP_EMAIL)`;
  when true, use `on_behalf_of_email` (body param) as the caller/owner for
  ownership + per-project authorization.
- **Build-identity swap (Knob 2):** the per-request auth refresher today does
  `write_project_auth_file(project_dir, host, token=request_user_pat(headers))`
  (`backend/core/auth.py:376`). When remote-deploy is on: write the **deploy-SP's
  minted OAuth token** and the **target host** instead. `write_project_auth_file`
  only needs *a* valid `host`+`token` — agnostic to whose — and it's rewritten per
  request, so the ~1h OAuth token stays fresh. This one call site is the whole swap.
- **Deploy-SP token:** minted by the generator (holds the creds) against the TARGET
  workspace: `POST https://<target-host>/oidc/v1/token`,
  `grant_type=client_credentials&scope=all-apis` (HTTP Basic).
- **Attribution:** project owner = caller (header user, or `on_behalf_of_email`);
  record `deployed_by = <deploy-SP>` in `resources.json` so it's auditable that the
  SP created the UC objects (which it owns in UC).

### Trust boundary (state it plainly)
`on_behalf_of_email` is **attribution, not authentication** — the auth-SP asserts the
requester's email; nothing proves alice consented. Sound because the trigger
(`X-Forwarded-Email == auth-SP`) is proxy-enforced + unspoofable and Lemma is
first-party. A compromised Lemma could mislabel a project's owner — not steal
credentials. Resources are owned by the **deploy-SP** in UC (not alice); if you ever
need UC objects genuinely owned/audited as alice, that's true per-user OBO (Option 2
below) — a later opt-in.

### Param contract (mirrored in `mcp-layer-spec.md`)
- `on_behalf_of_email` — **required on `create_solution`**, accepted on every other
  tool (the identity the generator authorizes as when `is_mcp_caller`). Sent as a
  request PARAM (body), never as `X-Forwarded-Email`.
- Lemma never sees any Databricks credential. The MCP server holds the auth-SP creds;
  the generator holds the deploy-SP creds.

The rest of this doc documents the underlying options; the Option 2 (true per-user
OBO) section remains the reference for when resources must be owned by the real user.

---

## How the generator consumes identity (the finish line, shared by both options)

Every generator `/api` handler reads two headers:

- `X-Forwarded-Email` → *who* the caller is (project ownership + permissions).
- `X-Forwarded-Access-Token` → the caller's **Databricks token**. The generator
  writes it into `<project>/.databrickscfg`; the agent's Databricks CLI then runs
  **as that identity** — so every pipeline / Genie space / app / UC table is created
  as it.

So whichever option you pick, the MCP server's job is the same shape: **get a
Databricks token + an email, set those two headers.** The options differ only in
*whose* token it is and *how* it was obtained.

- **Option 1:** the token is the **service principal's** (same for everyone). Email
  is passed as metadata, not identity.
- **Option 2:** the token is the **calling user's** → the build is OBO that user.

---

## Option 1 — Service Principal (M2M) · zero user interaction

The external agent (or the MCP server) authenticates as **one service principal**
using client-credentials — no human, no browser, ever. Every build runs as that SP.

### Steps
1. **Create a service principal + OAuth secret** (account admin, once):
   ```bash
   databricks account service-principals create --json '{"displayName":"solution-builder-bot"}'
   databricks account service-principal-secrets create <sp-id>   # → client_id + secret (store it)
   ```
2. **Grant the SP** the workspace + UC privileges a build needs (create schemas,
   pipelines, apps, serving endpoints, etc.), once.
3. **The MCP server holds the SP credentials** and, on startup or per call, does the
   **client-credentials flow** to get an SP access token:
   `POST https://<workspace-host>/oidc/v1/token`
   `grant_type=client_credentials&scope=all-apis` (HTTP Basic client_id:secret).
4. **Forward to the generator:**
   ```
   X-Forwarded-Access-Token: <SP access token>
   X-Forwarded-Email:        <the SP identity>          # what UC will attribute to
   ```
   Optionally carry the *requesting* human's email as a plain field the tools store
   as metadata (e.g. project description or a tag) so you still see "alice asked."

### Pros / cons
- ✅ No user interaction, works headless, simplest possible.
- ❌ Everything is owned by the SP; per-user UC grants + audit don't reflect the real
  requester; "who asked" is only as trustworthy as the metadata you attach.

---

## Option 2 — On-behalf-of user (OBO) · one-time login per user

The token is the **calling user's**, obtained via an interactive OAuth login the
first time, then refreshed silently. Two sub-variants by *who runs the login*:

### 2a — Direct (custom OAuth app) — the external agent logs the user in
1. **Register a custom OAuth app** (account admin, once):
   ```bash
   databricks account custom-app-integration create --confidential \
     --json '{"name":"solution-builder-mcp",
              "redirect_urls":["https://<agent-host>/oauth/callback"],
              "scopes":["all-apis","offline_access","openid","email","profile"]}'
   # → { client_id, client_secret }   (secret shown ONCE; ~30 min to propagate)
   ```
   - `all-apis` = broad API access (a build touches everything); `offline_access` =
     refresh tokens (so the ~1h expiry is handled without re-prompting);
     `openid email profile` = the ID token carries the user's email.
2. **User logs in once** (Authorization Code + PKCE): the agent bounces the user's
   browser to `https://<workspace-host>/oidc/v1/authorize`, the user signs in +
   consents, Databricks redirects back with a `code`, the agent exchanges it at
   `https://<workspace-host>/oidc/v1/token` for **access + refresh + ID** tokens.
   → the agent now holds a token that **is** the user.
3. **Agent → MCP server** carrying the user's access token.
4. **MCP server → generator:** validate the token (signed JWT — verify issuer/expiry
   against the workspace OIDC keys, or `GET /api/2.0/preview/scim/v2/Me`), read the
   email, forward `X-Forwarded-Email` + `X-Forwarded-Access-Token`. Build runs OBO. ✅
5. **After the first login: silent.** The refresh token mints new access tokens
   automatically; the user isn't prompted again until it's revoked/expires.

### 2b — UC-governed (Unity Catalog HTTP connection) — UC logs the user in
Use when the callers are **inside Databricks** (agents/Genie) and you want UC as the
governance + audit plane. Here **UC is the OAuth client on your behalf** and stores a
per-user token.
1. Your MCP server is an OAuth-conformant resource server (validates the token UC
   forwards; or exposes `authorization_endpoint`/`token_endpoint`, or supports **DCR**
   so UC auto-discovers).
2. **Admin creates the connection in PER-USER mode** (the presence of
   `authorization_endpoint` is what makes it per-user, not M2M):
   ```sql
   CREATE CONNECTION solution_builder_mcp TYPE HTTP OPTIONS (
     host 'https://<your-mcp-host>', port '443', base_path '/',
     client_id '<id>', client_secret '<secret>',
     oauth_scope 'all-apis offline_access',
     authorization_endpoint '<authorize-url>',      -- ← per-user (U2M)
     token_endpoint '<token-url>',
     oauth_credential_exchange_method 'header_only'
   );
   GRANT USE CONNECTION ON CONNECTION solution_builder_mcp TO `data-team@co.com`;
   ```
3. **First use:** each user authorizes once (allowlist redirect
   `<workspace-url>/login/oauth/http.html`); UC stores **that user's** token.
4. **Steady state:** callers hit the UC proxy
   `.../api/2.0/unity-catalog/connections/solution_builder_mcp/proxy/…`; **UC injects
   the caller's own token** → your MCP server → generator → OBO build. ✅
   - ⚠️ If the connection is **M2M / bearer / U2M-shared** instead of per-user, every
     call arrives as ONE identity → **not OBO**. Per-user (or DCR) is mandatory here.

### Pros / cons (both 2a and 2b)
- ✅ Real per-user ownership + native UC permissions + honest audit.
- ⚠️ One interactive login per user (then silent). ❌ Doesn't fit fully-headless
  callers unless you use token exchange (below).

---

## Softening Option 2's login (make the prompt nearly invisible)

The friction is really only the **first, cold** login. It shrinks or disappears if:

- **Federated SSO:** if the external agent and Databricks share an IdP (Okta/Entra/…)
  and the user already has a live SSO session, the "login" is a silent redirect — no
  password screen, often no visible step at all.
- **Admin consent:** an account admin can consent to the OAuth app for the whole org,
  so users skip the *consent dialog* (they still authenticate, silently via SSO).
- **Token exchange (RFC 8693):** if the calling system already holds a user token from
  a federated IdP, it can *exchange* it for a Databricks token with **no new prompt**
  — this is also how a semi-headless caller can still do OBO. Requires account-level
  identity federation to be set up.

If your users live in the same SSO as Databricks, Option 2 in practice feels close to
"click Allow once, never again."

---

## Recommendation

1. **If "who asked" (as attribution) is enough → Option 1 (M2M).** Zero friction,
   simplest, works headless. Tag the requesting user's email as metadata. This fits
   the common "external agent kicks off a demo build" case.
2. **If you need resources genuinely owned/audited as the user → Option 2 (OBO),
   variant 2a (Direct custom OAuth app)** — least moving parts, and the generator's
   existing deployed-mode `.databrickscfg` handoff already does the OBO build. Add
   **2b (UC per-user)** only when in-platform Databricks agents must reach it under UC
   governance.
3. **Start with Option 1, add Option 2 as an opt-in** if/when a customer needs
   per-user ownership. Both share the same header handoff, so moving between them is a
   config change at the MCP server, not a rewrite.

---

## Glossary

- **OAuth** — get a temporary token proving who you are, without sharing a password.
- **Access token** — the ~1h signed proof-of-identity attached to each call.
- **Refresh token** — long-lived; used only to mint fresh access tokens
  (`offline_access` scope). Avoids re-prompting.
- **ID token** — a JWT with user info (email); used to learn *who* logged in.
- **Scope** — what a token may do (`all-apis`, `sql`, `genie`, …).
- **U2M (authorization code + PKCE)** — a real user logs in → user's token → **OBO**.
- **M2M (client credentials)** — an app authenticates as itself (a service principal)
  → machine token → **not OBO**.
- **PKCE** — proof step that stops theft of the auth `code` mid-flight; required for
  public (secret-less) clients.
- **OBO (on-behalf-of)** — the downstream action runs as the end **user**, not a
  shared service principal.
- **Custom OAuth app integration** — registering your client so Databricks issues
  tokens to it (`CustomAppIntegration`).
- **UC HTTP connection** — a governed, credential-storing pointer to an external HTTP/
  MCP endpoint; UC injects the credential (per-user if configured) and audits use.
- **Token exchange (RFC 8693)** — swap a token from one IdP for a Databricks token,
  without a new interactive login (needs identity federation).

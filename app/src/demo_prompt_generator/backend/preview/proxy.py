"""
Reverse proxy: /preview/{project_id}/{path} → http://localhost:<port>/<path>.

Also rewrites the response body + injects a runtime shim so the child Vite
app's absolute-path URLs resolve back through this proxy instead of the
parent origin. Without the rewrite the iframe's browser would try to load
e.g. `/@vite/client` from the parent Vite server (localhost:5173) and 404.

What we rewrite/shim:
- HTML: `<script src="/…">`, `<link href="/…">` etc. → prefixed with
  `/preview/<id>`. Shim `<script>` injected immediately after `<head>`.
- JS / TS source modules: `import "/…"`, `from "/…"`, `import("/…")` →
  prefixed. Native ESM loader bypasses the runtime shim, so we have to fix
  these in the body before the browser parses it.
- Runtime shim patches: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`.
  Rewrites absolute-path URLs (and ws://localhost:<HMR_PORT>/) on the way
  out. Sets `window.__PREVIEW_BASENAME__` for the child router.

Cache headers: when we mutate the body, the upstream's ETag stops matching,
so we strip cache validators from both directions to prevent the browser
from reusing stale pre-rewrite bodies via 304s.
"""

from __future__ import annotations

import asyncio
import os
import re
from collections import OrderedDict
from typing import TYPE_CHECKING, NamedTuple

import httpx
from fastapi import Request
from fastapi.responses import Response, StreamingResponse

from ..services.shutdown import track_live_connection

if TYPE_CHECKING:
    from .registry import PreviewState


# Hop-by-hop headers — never forwarded per RFC 7230.
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


# Cache-validator request headers — strip so the upstream always sends a fresh
# body that we can rewrite. (If we forwarded these, upstream might return 304
# and the browser would use its un-rewritten cached body.)
_STRIP_REQUEST_HEADERS = {"if-none-match", "if-modified-since"}


# The Databricks Apps proxy attaches the viewing user's OBO token to every
# request it forwards to the generator — and our reverse proxy would forward it
# on to the child app. For a SAME-workspace preview that's correct (the child
# should act as the viewing user). For a REMOTE-TARGET (cross-workspace SP)
# preview it is WRONG: a host-workspace user token is not valid for the target
# workspace, so if the child's authHeaders sees it, it sends a host-ws token to
# a target-ws endpoint → 401/400. Stripping it here (at the boundary, where we
# know the deploy mode) lets the child fall through to the deployer-SP oauth-m2m
# creds already in its env — keeping the app's auth.ts dumb (no SP special-case).
_USER_TOKEN_HEADER = "x-forwarded-access-token"


def _clean_request_headers(headers, *, strip_user_token: bool = False) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers.items():
        kl = k.lower()
        if kl in _HOP_BY_HOP or kl == "host" or kl in _STRIP_REQUEST_HEADERS:
            continue
        if strip_user_token and kl == _USER_TOKEN_HEADER:
            continue
        out[k] = v
    return out


def _clean_response_headers(headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers.items():
        kl = k.lower()
        if kl in _HOP_BY_HOP or kl == "content-length":
            continue
        out[k] = v
    return out


_CACHE_VALIDATOR_HEADERS = {"etag", "last-modified", "cache-control", "expires"}


def _strip_cache(headers: dict[str, str]) -> dict[str, str]:
    """Drop cache validators after we've mutated the body — otherwise a
    follow-up `If-None-Match` against the original ETag would let the browser
    reuse a stale, un-rewritten cached body. HTTP headers are case-insensitive,
    so we match on lowercase and drop any casing variant."""
    for k in [k for k in headers if k.lower() in _CACHE_VALIDATOR_HEADERS]:
        del headers[k]
    headers["Cache-Control"] = "no-store"
    return headers


# ---------------------------------------------------------------------------
# Rewritten-body cache for immutable URLs
# ---------------------------------------------------------------------------

# Vite pre-bundled deps: /node_modules/.vite/deps/<pkg>.js?v=<hash>. The hash is
# derived from the dependency graph, so that URL names exactly one body. Source
# modules (/src/...) and HTML documents change when the agent edits them, so they
# are never cached. Neither is `?t=` (an HMR timestamp, not a content identity).
_IMMUTABLE_DEP_PREFIX = "node_modules/.vite/deps/"
_REWRITE_CACHE_MAX_ENTRIES = 512


def _rewrite_cache_budget_bytes() -> int:
    try:
        mb = float(os.environ.get("PREVIEW_REWRITE_CACHE_MB", "64"))
    except ValueError:
        mb = 64.0
    return max(0, int(mb * 1024 * 1024))


def _immutable_cache_key(project_id: str, path: str, query: str) -> tuple[str, str, str] | None:
    """Cache key for a URL whose rewritten body is fixed by the URL, else None.

    The rewrite reads only the project id (the `/preview/<id>` prefix, and the
    shim built from it) and the upstream body, and the body is fixed by the
    `?v=` hash, so (project_id, path, query) is the complete key. Paths with a
    `..` segment are refused so the key can never name a source module.
    """
    if not path.startswith(_IMMUTABLE_DEP_PREFIX) or ".." in path.split("/"):
        return None
    if not any(part.startswith("v=") for part in query.split("&")):
        return None
    return (project_id, path, query)


class _RewrittenBody(NamedTuple):
    status_code: int
    headers: dict[str, str]
    body: bytes


class _RewriteCache:
    """LRU of rewritten bodies, bounded by total bytes and entry count.

    Only called from the event loop (proxy_request and the stop routes), so no lock.
    """

    def __init__(self, max_bytes: int, max_entries: int) -> None:
        self._max_bytes = max_bytes
        self._max_entries = max_entries
        self._entries: "OrderedDict[tuple[str, str, str], _RewrittenBody]" = OrderedDict()
        self._bytes = 0

    def get(self, key: tuple[str, str, str]) -> _RewrittenBody | None:
        entry = self._entries.get(key)
        if entry is not None:
            self._entries.move_to_end(key)
        return entry

    def put(self, key: tuple[str, str, str], entry: _RewrittenBody) -> None:
        size = len(entry.body)
        if size > self._max_bytes:
            return
        self._drop(key)
        self._entries[key] = entry
        self._bytes += size
        while self._bytes > self._max_bytes or len(self._entries) > self._max_entries:
            oldest = next(iter(self._entries))
            self._drop(oldest)

    def forget_project(self, project_id: str) -> None:
        for key in [k for k in self._entries if k[0] == project_id]:
            self._drop(key)

    def _drop(self, key: tuple[str, str, str]) -> None:
        entry = self._entries.pop(key, None)
        if entry is not None:
            self._bytes -= len(entry.body)


_rewrite_cache = _RewriteCache(
    max_bytes=_rewrite_cache_budget_bytes(), max_entries=_REWRITE_CACHE_MAX_ENTRIES
)


def forget_project_rewrites(project_id: str) -> None:
    """Drop a project's cached rewrites. Called when its preview stops or restarts."""
    _rewrite_cache.forget_project(project_id)


# ONE upstream client for the whole proxy. A client per request rebuilt the TLS
# context (~16 ms of loop CPU each) and never reused a connection. Created lazily
# on the serving loop; closed by close_shared_client() at app shutdown.
_shared_client: httpx.AsyncClient | None = None

# Buffered (HTML/JS) bodies are read whole before we rewrite them, so bound that
# read: a child that stalls mid-body must not pin the request. Streams have none.
_BUFFERED_READ_TIMEOUT_SECONDS = 60.0


def _upstream_client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        # No read timeout: a proxied SSE or a slow agent call legitimately waits
        # for minutes. Connecting to the local child must be quick, though.
        _shared_client = httpx.AsyncClient(
            timeout=httpx.Timeout(None, connect=10.0),
            limits=httpx.Limits(max_connections=256, max_keepalive_connections=64),
        )
    return _shared_client


async def close_shared_client() -> None:
    """Close the shared upstream client. Called from the app lifespan teardown."""
    global _shared_client
    client, _shared_client = _shared_client, None
    if client is not None:
        await client.aclose()


async def proxy_request(
    request: Request,
    state: "PreviewState",
    path: str,
    *,
    strip_user_token: bool = False,
) -> Response:
    """Forward one HTTP request to the child app. Bumps the idle timer.

    `strip_user_token=True` (remote-target preview) drops the viewing user's
    forwarded OBO token so the child authenticates as the deployer SP against
    the target workspace instead of sending a host-workspace token there. See
    _clean_request_headers.
    """
    state.bump_activity()
    if state.port is None:
        return Response("preview not ready", status_code=503)

    target = f"http://127.0.0.1:{state.port}/{path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    # A content-addressed dependency is rewritten once and then served from memory:
    # the rewrite scan is the CPU cost, and a hit also skips the upstream fetch.
    cache_key = (
        _immutable_cache_key(state.project_id, path, request.url.query)
        if request.method == "GET"
        else None
    )
    if cache_key is not None:
        hit = _rewrite_cache.get(cache_key)
        if hit is not None:
            return Response(content=hit.body, status_code=hit.status_code, headers=dict(hit.headers))

    headers = _clean_request_headers(request.headers, strip_user_token=strip_user_token)
    client = _upstream_client()
    upstream_req = client.build_request(
        method=request.method,
        url=target,
        headers=headers,
        content=request.stream(),
    )
    # Tracked so SIGTERM can cancel a child that hangs before its headers, and a
    # buffered body still being read (the drain would otherwise wait out the whole
    # graceful window). Streaming bodies track themselves in body_iter below.
    async with track_live_connection():
        try:
            upstream = await client.send(upstream_req, stream=True)
        except (httpx.ConnectError, httpx.ReadError, httpx.TimeoutException) as e:
            return Response(f"upstream error: {e}", status_code=502)

        content_type = upstream.headers.get("content-type", "")
        out_headers = _clean_response_headers(upstream.headers)
        if "text/event-stream" in content_type:
            out_headers["X-Accel-Buffering"] = "no"
            out_headers["Cache-Control"] = "no-cache"

        # HTML and JS/TS are buffered: the whole body must be read to rewrite it.
        is_html = "text/html" in content_type
        is_js = (
            "javascript" in content_type
            or "typescript" in content_type
            or "/x-typescript" in content_type
        )
        if is_html or is_js:
            try:
                body = await asyncio.wait_for(
                    upstream.aread(), timeout=_BUFFERED_READ_TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                return Response("upstream timed out", status_code=504)
            except httpx.RequestError as e:
                return Response(f"upstream error: {e}", status_code=502)
            finally:
                await upstream.aclose()
            out_headers.pop("content-length", None)
            if is_html:
                # HTML: rewrite absolute-path href/src attributes + inject the shim so
                # runtime network calls (fetch, WebSocket) reach the child via the proxy.
                rewritten = _rewrite_html(body, state.project_id)
            else:
                # JS/TS (Vite serves source modules as JS): rewrite `import "/..."`,
                # `from "/..."`, `import("/...")`. Needed because the browser's native
                # ESM loader bypasses our fetch/WS shims — we have to fix the URLs
                # inside the JS before the browser parses it.
                rewritten = _rewrite_js_imports(body, state.project_id)
            final_headers = _strip_cache(out_headers)
            if cache_key is not None and upstream.status_code == 200:
                _rewrite_cache.put(
                    cache_key, _RewrittenBody(200, dict(final_headers), rewritten)
                )
            return Response(
                content=rewritten,
                status_code=upstream.status_code,
                headers=final_headers,
                media_type=content_type,
            )

        async def body_iter():
            # Track this streaming task so the SIGTERM handler can cancel it: it parks
            # on aiter_raw() waiting for the child (an idle proxied SSE sends nothing
            # for minutes), so only a task-cancel — not a between-chunks flag poll —
            # unblocks it before uvicorn's shutdown drain times out. CancelledError
            # then unwinds through the finally. See services/shutdown.py.
            async with track_live_connection():
                try:
                    async for chunk in upstream.aiter_raw():
                        yield chunk
                finally:
                    await upstream.aclose()

        return StreamingResponse(
            body_iter(),
            status_code=upstream.status_code,
            headers=out_headers,
            media_type=content_type or None,
        )


# ---------------------------------------------------------------------------
# HTML rewrite + shim injection
# ---------------------------------------------------------------------------

# Match absolute-path URLs in src="/..." and href="/..." (but NOT "//..." which
# is scheme-relative, and NOT already-prefixed ones).
_ATTR_RE = re.compile(
    rb'(\s(?:src|href)=)(["\'])(/(?!/)(?!preview/)[^"\'>]*)(["\'])',
    re.IGNORECASE,
)


# Match `import "/..."`, `import x from "/..."`, `export x from "/..."`,
# `import("/...")`. Skip already-prefixed (`/preview/<id>/`), scheme-relative
# (`//host/...`), and non-absolute (`./foo`, `../foo`, `react`).
_JS_IMPORT_RE = re.compile(
    rb'(\b(?:from|import)\s*[\(]?\s*)(["\'])'
    rb'(/(?!/)(?!preview/)[^"\']*)'
    rb'(["\'])',
)


def _rewrite_js_imports(body: bytes, project_id: str) -> bytes:
    prefix = f"/preview/{project_id}".encode()

    def _prefix_import(m: "re.Match[bytes]") -> bytes:
        lead, q1, path, q2 = m.group(1), m.group(2), m.group(3), m.group(4)
        return lead + q1 + prefix + path + q2

    return _JS_IMPORT_RE.sub(_prefix_import, body)


# Match inline `<script type="module"> ... </script>` blocks so we can rewrite
# absolute-path import paths INSIDE them. Without this, Vite's @vitejs/plugin-
# react preamble (inlined as a module script with `import "/@react-refresh"`)
# resolves the import against the parent origin → 404 → $RefreshReg$/$RefreshSig$
# never set → first JSX module throws "can't detect preamble" → blank page.
# Non-greedy + DOTALL so we match multi-line bodies; case-insensitive on the
# opening tag attrs.
_INLINE_MODULE_SCRIPT_RE = re.compile(
    rb'(<script\b[^>]*\btype=["\']module["\'][^>]*>)(.*?)(</script>)',
    re.IGNORECASE | re.DOTALL,
)


def _rewrite_html(body: bytes, project_id: str) -> bytes:
    prefix = f"/preview/{project_id}".encode()

    def _prefix_attr(m: "re.Match[bytes]") -> bytes:
        attr, q1, path, q2 = m.group(1), m.group(2), m.group(3), m.group(4)
        return attr + q1 + prefix + path + q2

    rewritten = _ATTR_RE.sub(_prefix_attr, body)

    # Inline module scripts in HTML carry their own `import "/..."` statements
    # that the native ESM loader will fetch directly — bypassing our runtime
    # fetch shim AND the JS-content-type rewrite path. Rewrite them in place.
    def _prefix_inline_module(m: "re.Match[bytes]") -> bytes:
        opening, body_bytes, closing = m.group(1), m.group(2), m.group(3)
        return opening + _rewrite_js_imports(body_bytes, project_id) + closing

    rewritten = _INLINE_MODULE_SCRIPT_RE.sub(_prefix_inline_module, rewritten)

    shim = _shim_script(project_id).encode()
    # Inject shim as the FIRST thing after <head> so it runs before any child
    # <script> executes. If no <head>, prepend to the document.
    lowered = rewritten.lower()
    head_idx = lowered.find(b"<head")
    if head_idx == -1:
        return shim + rewritten
    head_close = rewritten.find(b">", head_idx)
    if head_close == -1:
        return shim + rewritten
    return rewritten[: head_close + 1] + shim + rewritten[head_close + 1 :]


def _shim_script(project_id: str) -> str:
    """
    Runtime shim injected into the child app's HTML <head>. Rewrites
    absolute-path URLs in `fetch()` and `WebSocket` so the child's calls
    reach the proxy instead of the parent origin.

    Kept inline (no external file) so there's no extra round-trip before
    the child's own scripts run.
    """
    # f-string: only `project_id` is substituted. Everything else is JS.
    return f"""<script>
(function() {{
  var PREFIX = "/preview/{project_id}";
  // Expose the proxy basename so the child app's router (or anything that
  // computes URLs from window.location) can strip it. React Router accepts
  // `basename` on createBrowserRouter; other routers have similar options.
  window.__PREVIEW_BASENAME__ = PREFIX;

  // ---- Route reporter (preview-only) -------------------------------------
  // Tell the parent (the generator UI) which page of the demo the user is
  // currently looking at, so a chat message can carry a "context hint"
  // (e.g. preview-app/operations). Fires on every client-side navigation.
  // We report the CHILD-app route (PREFIX stripped), not the proxied path.
  function _previewReportRoute() {{
    try {{
      var p = location.pathname;
      if (p.indexOf(PREFIX) === 0) p = p.slice(PREFIX.length) || "/";
      parent.postMessage({{ type: "preview-route", path: p }}, "*");
    }} catch (_) {{}}
  }}
  ["pushState", "replaceState"].forEach(function (m) {{
    var orig = history[m];
    history[m] = function () {{
      var r = orig.apply(this, arguments);
      _previewReportRoute();
      return r;
    }};
  }});
  window.addEventListener("popstate", _previewReportRoute);
  window.addEventListener("load", _previewReportRoute);
  _previewReportRoute(); // initial route, before the child router mounts

  // ---- @vitejs/plugin-react preamble fallback ----------------------------
  // Pre-seed the React-Refresh globals as no-ops so the plugin's boundary
  // check ("can't detect preamble") doesn't throw when the real preamble
  // fails to load. The real runtime overwrites these with proper hooks.
  if (!window.$RefreshReg$) window.$RefreshReg$ = function () {{}};
  if (!window.$RefreshSig$) window.$RefreshSig$ = function () {{ return function (t) {{ return t; }}; }};

  // ---- Error catcher (preview-only) --------------------------------------
  // Forwards uncaught errors / unhandled rejections to the parent's
  // /preview/<id>/api/log/client-error so they land in the server's stderr
  // (and the auto-fix tail). Fires for module-evaluation failures too —
  // those happen BEFORE the child app's own error reporter is installed,
  // which is why we wire it here from the proxy shim instead of relying
  // on the template.
  function _previewSendError(payload) {{
    try {{
      var url = PREFIX + "/api/log/client-error";
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {{
        navigator.sendBeacon(url, new Blob([body], {{ type: "application/json" }}));
      }} else {{
        fetch(url, {{
          method: "POST",
          headers: {{ "content-type": "application/json" }},
          body: body,
          keepalive: true,
        }});
      }}
    }} catch (_) {{}}
  }}
  window.addEventListener("error", function (ev) {{
    _previewSendError({{
      source: "preview-window",
      message: (ev.error && ev.error.message) || ev.message || "unknown",
      stack: ev.error && ev.error.stack,
      url: location.href,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
    }});
    // Visible fallback so the user sees a hint instead of a blank page.
    var root = document.getElementById("root");
    if (root && !root.firstChild) {{
      root.innerHTML =
        '<div style="font:14px/1.5 system-ui;padding:24px;color:#b91c1c">' +
        '<strong>App failed to load.</strong><br/>' +
        'See the preview logs panel for the error details.' +
        '</div>';
    }}
  }});
  window.addEventListener("unhandledrejection", function (ev) {{
    var r = (ev && ev.reason) || {{}};
    _previewSendError({{
      source: "preview-unhandledrejection",
      message: r.message || String(r),
      stack: r.stack,
      url: location.href,
    }});
  }});
  function shouldRewrite(path) {{
    if (typeof path !== "string") return false;
    if (!path.startsWith("/")) return false;        // relative — leave alone
    if (path.startsWith("//")) return false;        // scheme-relative
    if (path.startsWith(PREFIX + "/") || path === PREFIX) return false;
    return true;
  }}
  function rewritePath(path) {{
    return shouldRewrite(path) ? PREFIX + path : path;
  }}
  function rewriteUrl(url) {{
    if (typeof url !== "string") return url;
    // Same-origin absolute URL? Rewrite the pathname part.
    try {{
      var u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin && shouldRewrite(u.pathname)) {{
        u.pathname = PREFIX + u.pathname;
        return u.toString();
      }}
    }} catch (_) {{}}
    return rewritePath(url);
  }}

  // ---- fetch --------------------------------------------------------------
  var origFetch = window.fetch;
  window.fetch = function(input, init) {{
    if (typeof input === "string") {{
      return origFetch(rewriteUrl(input), init);
    }}
    if (input instanceof Request) {{
      var newUrl = rewriteUrl(input.url);
      if (newUrl !== input.url) {{
        // Re-create the Request with the rewritten URL (Request is immutable).
        return origFetch(new Request(newUrl, input), init);
      }}
    }}
    return origFetch(input, init);
  }};

  // ---- XMLHttpRequest -----------------------------------------------------
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {{
    arguments[1] = rewriteUrl(url);
    return origOpen.apply(this, arguments);
  }};

  // ---- WebSocket (Vite HMR) ----------------------------------------------
  // Vite's client connects to `ws://localhost:<HMR_PORT>/?token=…` which is
  // cross-origin from the iframe. Redirect any ws:// to localhost/127.0.0.1
  // through the parent origin + proxy prefix; the parent's WS proxy bridges
  // to the child's HMR server.
  var OrigWS = window.WebSocket;
  var LOCAL_HOSTS = {{ "localhost": 1, "127.0.0.1": 1, "[::1]": 1 }};
  function WrappedWS(url, protocols) {{
    try {{
      var u = new URL(url, window.location.origin.replace(/^http/, "ws"));
      if (LOCAL_HOSTS[u.hostname]) {{
        var wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
        var path = u.pathname || "/";
        if (!path.startsWith(PREFIX + "/") && path !== PREFIX) {{
          path = PREFIX + (path.startsWith("/") ? path : "/" + path);
        }}
        url = wsProto + "//" + window.location.host + path + u.search;
      }}
    }} catch (_) {{}}
    return protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
  }}
  WrappedWS.prototype = OrigWS.prototype;
  WrappedWS.CONNECTING = OrigWS.CONNECTING;
  WrappedWS.OPEN = OrigWS.OPEN;
  WrappedWS.CLOSING = OrigWS.CLOSING;
  WrappedWS.CLOSED = OrigWS.CLOSED;
  window.WebSocket = WrappedWS;

  // ---- EventSource -------------------------------------------------------
  if (window.EventSource) {{
    var OrigES = window.EventSource;
    function WrappedES(url, init) {{
      return new OrigES(rewriteUrl(url), init);
    }}
    WrappedES.prototype = OrigES.prototype;
    WrappedES.CONNECTING = OrigES.CONNECTING;
    WrappedES.OPEN = OrigES.OPEN;
    WrappedES.CLOSED = OrigES.CLOSED;
    window.EventSource = WrappedES;
  }}
}})();
</script>"""

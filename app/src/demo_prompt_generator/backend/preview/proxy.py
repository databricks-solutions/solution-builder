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

import re
from typing import TYPE_CHECKING

import httpx
from fastapi import Request
from fastapi.responses import Response, StreamingResponse

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


def _clean_request_headers(headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers.items():
        kl = k.lower()
        if kl in _HOP_BY_HOP or kl == "host" or kl in _STRIP_REQUEST_HEADERS:
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


async def proxy_request(
    request: Request,
    state: "PreviewState",
    path: str,
) -> Response:
    """Forward one HTTP request to the child app. Bumps the idle timer."""
    state.bump_activity()
    if state.port is None:
        return Response("preview not ready", status_code=503)

    target = f"http://127.0.0.1:{state.port}/{path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    headers = _clean_request_headers(request.headers)
    client = httpx.AsyncClient(timeout=None)

    async def _close_client() -> None:
        try:
            await client.aclose()
        except Exception:
            pass

    try:
        upstream_req = client.build_request(
            method=request.method,
            url=target,
            headers=headers,
            content=request.stream(),
        )
        upstream = await client.send(upstream_req, stream=True)
    except (httpx.ConnectError, httpx.ReadError) as e:
        await _close_client()
        return Response(f"upstream error: {e}", status_code=502)

    content_type = upstream.headers.get("content-type", "")
    out_headers = _clean_response_headers(upstream.headers)
    if "text/event-stream" in content_type:
        out_headers["X-Accel-Buffering"] = "no"
        out_headers["Cache-Control"] = "no-cache"

    # HTML: rewrite absolute-path href/src attributes + inject the shim so
    # runtime network calls (fetch, WebSocket) reach the child via the proxy.
    if "text/html" in content_type:
        body = await upstream.aread()
        await upstream.aclose()
        await _close_client()
        rewritten = _rewrite_html(body, state.project_id)
        out_headers.pop("content-length", None)
        return Response(
            content=rewritten,
            status_code=upstream.status_code,
            headers=_strip_cache(out_headers),
            media_type=content_type,
        )

    # JS/TS (Vite serves source modules as JS): rewrite `import "/..."`,
    # `from "/..."`, `import("/...")`. Needed because the browser's native
    # ESM loader bypasses our fetch/WS shims — we have to fix the URLs
    # inside the JS before the browser parses it.
    if (
        "javascript" in content_type
        or "typescript" in content_type
        or "/x-typescript" in content_type
    ):
        body = await upstream.aread()
        await upstream.aclose()
        await _close_client()
        rewritten = _rewrite_js_imports(body, state.project_id)
        out_headers.pop("content-length", None)
        return Response(
            content=rewritten,
            status_code=upstream.status_code,
            headers=_strip_cache(out_headers),
            media_type=content_type,
        )

    async def body_iter():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await _close_client()

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

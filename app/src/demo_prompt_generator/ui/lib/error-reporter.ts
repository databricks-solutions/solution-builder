/**
 * Frontend error reporter.
 *
 * Forwards JS errors, unhandled promise rejections, and 5xx API failures to
 * POST /api/client_errors so they land in the same event_logs table the
 * backend writes to. Weekly review can then `SELECT * FROM event_logs WHERE
 * severity='error'` and see both sides of the stack.
 *
 * - Idempotent: safe to call install() more than once
 * - Best-effort: a reporter failure must never break the app
 * - Throttled: caps duplicate reports per session to avoid log floods
 */
import { apiUrl } from "./config";

type ErrorPayload = {
  error_type: string;
  message: string;
  stack?: string;
  url?: string;
  user_agent?: string;
  project_id?: string;
  request_id?: string;
  extra?: Record<string, unknown>;
};

const seen = new Map<string, number>();
const SEEN_LIMIT_PER_KEY = 5;
let installed = false;

function fingerprint(p: ErrorPayload): string {
  return `${p.error_type}::${p.message?.slice(0, 200) ?? ""}`;
}

function projectIdFromLocation(): string | undefined {
  // Routes look like /project/<id> (path or hash, depending on Electron vs web)
  const src = window.location.pathname + window.location.hash;
  const m = src.match(/\/project\/([^/?#]+)/);
  return m?.[1];
}

export function reportError(payload: Omit<ErrorPayload, "url" | "user_agent" | "project_id"> & {
  project_id?: string;
}): void {
  try {
    const fp = fingerprint(payload as ErrorPayload);
    const count = (seen.get(fp) ?? 0) + 1;
    seen.set(fp, count);
    if (count > SEEN_LIMIT_PER_KEY) return;

    const body: ErrorPayload = {
      ...payload,
      url: window.location.href,
      user_agent: navigator.userAgent,
      project_id: payload.project_id ?? projectIdFromLocation(),
    };

    // Use keepalive so the POST survives a page-unload-triggered error.
    fetch(apiUrl("/api/client_errors"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      // Reporter failures are intentionally swallowed — there's nothing the
      // user can do about them and we don't want to spam the console.
    });
  } catch {
    // Same — never throw from the reporter itself.
  }
}

function installWindowHandlers(): void {
  window.addEventListener("error", (event: ErrorEvent) => {
    const err = event.error as Error | undefined;
    reportError({
      error_type: err?.name ?? "WindowError",
      message: event.message ?? String(err ?? "unknown"),
      stack: err?.stack,
      extra: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const err = reason instanceof Error ? reason : undefined;
    reportError({
      error_type: err?.name ?? "UnhandledRejection",
      message: err?.message ?? String(reason ?? "unknown"),
      stack: err?.stack,
    });
  });
}

/**
 * Wrap window.fetch so /api/* responses with status >= 500 (or network
 * errors against /api/*) are reported. We only care about API failures —
 * static asset misses are not actionable.
 */
function installFetchWrapper(): void {
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const isApi = typeof url === "string" && url.includes("/api/");
    // Don't recurse into the reporter's own POST.
    const isReporter = typeof url === "string" && url.endsWith("/api/client_errors");

    try {
      const res = await origFetch(input, init);
      if (isApi && !isReporter && res.status >= 500) {
        // Best-effort: read the request_id from the response body if present.
        let request_id: string | undefined;
        try {
          const cloned = res.clone();
          const ct = cloned.headers.get("content-type") ?? "";
          if (ct.includes("application/json")) {
            const body = (await cloned.json()) as { request_id?: string };
            request_id = body?.request_id;
          }
        } catch {
          // ignore parse failures
        }
        reportError({
          error_type: `HTTP_${res.status}`,
          message: `${init?.method ?? "GET"} ${url} → ${res.status}`,
          request_id,
          extra: { status: res.status, status_text: res.statusText },
        });
      }
      return res;
    } catch (e) {
      if (isApi && !isReporter) {
        const err = e instanceof Error ? e : undefined;
        reportError({
          error_type: err?.name ?? "FetchError",
          message: `${init?.method ?? "GET"} ${url}: ${err?.message ?? String(e)}`,
          stack: err?.stack,
        });
      }
      throw e;
    }
  };
}

export function installErrorReporter(): void {
  if (installed) return;
  installed = true;
  try {
    installWindowHandlers();
    installFetchWrapper();
  } catch {
    // If install itself fails, leave the app alone.
  }
}

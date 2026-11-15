import express, { type Application } from 'express';

/**
 * Dev-only endpoint: receives client-side errors (ErrorBoundary, window.onerror,
 * unhandledrejection, and the inline catcher in index.html that fires for
 * module-evaluation failures before main.tsx runs) and prints them in the
 * same terminal as backend logs.
 *
 * Lands on stderr with the distinctive `CLIENT ERR ▸` prefix so it stands
 * out in the preview log stream and gets picked up by the auto-fix tailing
 * tooling.
 *
 * Only registered when DEV_CLIENT_ERROR_LOG=1 (set by start.sh). Never
 * registered in prod — Databricks Apps deploy never sets this var.
 */
export function registerDevLogRoutes(
  app: Application,
  logErrorCompact: (prefix: string, err: unknown) => void,
): void {
  app.post('/api/log/client-error', express.json({ limit: '64kb' }), (req, res) => {
    const {
      message,
      stack,
      source,
      url,
      filename,
      lineno,
      colno,
    } = (req.body ?? {}) as {
      message?: string;
      stack?: string;
      source?: string;
      url?: string;
      filename?: string;
      lineno?: number;
      colno?: number;
    };
    // Build a one-line summary for the auto-fix tail.
    const loc =
      filename != null
        ? ` ${filename}${lineno != null ? `:${lineno}` : ''}${colno != null ? `:${colno}` : ''}`
        : '';
    const summary = `CLIENT ERR ▸ [${source ?? 'unknown'}]${loc} ${message ?? 'unknown client error'}`;
    // Write to stderr so it's surfaced as an error event in the preview
    // log stream (the registry pumps stderr → log_buffer with `stream="stderr"`,
    // and the auto-fix detector treats stderr lines as candidates).
    process.stderr.write(summary + '\n');
    if (stack) {
      process.stderr.write(`CLIENT ERR ▸   stack: ${stack.split('\n').slice(0, 6).join('\n  ')}\n`);
    }
    if (url) {
      process.stderr.write(`CLIENT ERR ▸   page: ${url}\n`);
    }
    // Keep the existing compact-log path too — drizzle/pg context helpers
    // there don't apply, but the consistent prefix in stdout is useful if
    // someone is tailing one or the other.
    logErrorCompact(
      `[client${source ? `:${source}` : ''}]${url ? ` ${url}` : ''}`,
      { message: message ?? 'unknown client error', stack },
    );
    res.status(204).end();
  });
}

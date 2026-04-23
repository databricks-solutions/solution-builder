import express, { type Application } from 'express';

/**
 * Dev-only endpoint: receives client-side errors (ErrorBoundary, window.onerror,
 * unhandledrejection) and prints them in the same terminal as backend logs.
 *
 * Only registered when DEV_CLIENT_ERROR_LOG=1 (set by start.sh). Never
 * registered in prod — Databricks Apps deploy never sets this var.
 */
export function registerDevLogRoutes(
  app: Application,
  logErrorCompact: (prefix: string, err: unknown) => void,
): void {
  app.post('/api/log/client-error', express.json({ limit: '64kb' }), (req, res) => {
    const { message, stack, source, url } = (req.body ?? {}) as {
      message?: string;
      stack?: string;
      source?: string;
      url?: string;
    };
    logErrorCompact(
      `[client${source ? `:${source}` : ''}]${url ? ` ${url}` : ''}`,
      { message: message ?? 'unknown client error', stack },
    );
    res.status(204).end();
  });
}

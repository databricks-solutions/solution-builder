/**
 * Dev-only: forward browser errors to the server terminal so they show up
 * alongside backend logs. Compiled out in prod builds via `import.meta.env.DEV`.
 *
 * Matching backend endpoint is registered only when DEV_CLIENT_ERROR_LOG=1
 * (see start.sh + server/routes/dev-log.ts).
 */

type ClientErrorPayload = {
  message: string;
  stack?: string;
  source: 'boundary' | 'window' | 'unhandledrejection';
  url: string;
};

export function reportClientError(
  err: unknown,
  source: ClientErrorPayload['source'],
): void {
  if (!import.meta.env.DEV) return;
  const e = err as { message?: string; stack?: string } | undefined;
  const payload: ClientErrorPayload = {
    message: e?.message ?? String(err ?? 'unknown'),
    stack: e?.stack,
    source,
    url: window.location.href,
  };
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/log/client-error',
        new Blob([body], { type: 'application/json' }),
      );
    } else {
      void fetch('/api/log/client-error', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      });
    }
  } catch {
    // Never let the reporter itself crash the app.
  }
}

export function installGlobalErrorHandlers(): void {
  if (!import.meta.env.DEV) return;
  window.addEventListener('error', (ev) => {
    reportClientError(ev.error ?? ev.message, 'window');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    reportClientError(ev.reason, 'unhandledrejection');
  });
}

/**
 * dbdemos usage tracker — a JS port of the Python `dbdemos-tracker` package
 * (its `Tracker.track_app_view`).
 *
 * Sends one fire-and-forget APP-VIEW event per page load, with the same payload
 * the Python middleware sends, so demo apps aggregate with dbdemos / the
 * Solution Builder. Only a sha256 hash of @databricks.com emails is sent (no
 * email, no data); other users are anonymous.
 *
 * `appId` must be unique per demo: `config/app.json` → `dbdemosAppId`
 * (seed templates use the template id; generated demos use `<slug>-<resource_suffix>`).
 * Disabled when appId is empty or DBDEMOS_TRACKER_DISABLED=1.
 */
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const URL = 'https://ppxrzfxige.execute-api.us-west-2.amazonaws.com/v1/analytics';
const CATEGORY = 'demo-app';
const DEV_WORKSPACE = '1660015457675682'; // the tracker's own test workspace: never reported
const MAX_IN_FLIGHT = 20;
const TIMEOUT_MS = 2000;
const STATIC_EXT = /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|json|txt|webp)$/i;
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'max-age=0',
  'content-type': 'application/json',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36',
};

let inFlight = 0;

function userHash(email: string): string | undefined {
  return email.endsWith('@databricks.com')
    ? createHash('sha256').update(email).digest('hex')
    : undefined;
}

/** Page loads only: GET, not an API call, not a static asset. */
function isPageView(req: Request): boolean {
  return req.method === 'GET' && !req.path.startsWith('/api') && !STATIC_EXT.test(req.path)
    && !req.path.startsWith('/assets/') && !req.path.startsWith('/@');
}

export function trackAppView(appId: string, email: string, appPath: string): void {
  const orgId = process.env.DATABRICKS_WORKSPACE_ID ?? 'unknown';
  if (orgId === DEV_WORKSPACE || inFlight >= MAX_IN_FLIGHT) return;
  const payload: Record<string, string | number> = {
    category: CATEGORY,
    org_id: orgId,
    demo_name: appId,
    event: 'APP-VIEW',
    version: 1,
    path: `/_dbdemos/${CATEGORY}/${appId}`,
    app_path: appPath,
  };
  const hash = userHash(email);
  if (hash) payload.user_hash = hash;
  inFlight++;
  fetch(URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS) })
    .catch(() => { /* telemetry must never affect the app */ })
    .finally(() => { inFlight--; });
}

/** Express middleware: register first inside `appkit.server.extend`, so it sees page loads before the static client. */
export function dbdemosTracker(appId: string | undefined) {
  const enabled = !!appId && process.env.DBDEMOS_TRACKER_DISABLED !== '1';
  return (req: Request, _res: Response, next: NextFunction) => {
    if (enabled && isPageView(req)) {
      const email = req.headers['x-forwarded-email'];
      if (typeof email === 'string' && email) {
        try { trackAppView(appId!, email, req.path); } catch { /* never break a request */ }
      }
    }
    next();
  };
}

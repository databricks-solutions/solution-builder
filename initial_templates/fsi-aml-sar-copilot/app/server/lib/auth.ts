import type { Request } from 'express';
import { getExecutionContext } from '@databricks/appkit';

/**
 * Build the Authorization header for an outbound Databricks call.
 *
 * - Prod: Databricks Apps injects `x-forwarded-access-token` for OBO — use it
 *   so the call is attributed to the viewing user (MLflow traces, audit logs,
 *   UC permissions).
 * - Dev / no forwarded token: delegate to the SDK's auth chain via the
 *   current WorkspaceClient. This picks up the CLI profile, handles OAuth
 *   refresh automatically (no more 1-hour token expiry), works with service
 *   principal creds, Azure CLI, etc. — whatever the user's local config is.
 *
 * ── Keep this DUMB — no service-principal / oauth-m2m special-casing here ────
 * When this app runs against a REMOTE TARGET workspace (cross-workspace deploy),
 * the launcher authenticates it as the deployer service principal purely via
 * ENV: it sets DATABRICKS_AUTH_TYPE=oauth-m2m + DATABRICKS_CLIENT_ID/SECRET +
 * DATABRICKS_HOST for the target and REMOVES DATABRICKS_TOKEN from the child's
 * env. So the SDK's default credential chain (below) resolves oauth-m2m on its
 * own — every path in this app (this helper, execSql, mlflow, warehouse, the
 * Lakebase pool) authenticates correctly with ZERO app-side auth logic. Do NOT
 * re-introduce a pinned WorkspaceClient here: the env is the single source of
 * truth (see the generator's core/auth.py). An earlier fix pinned oauth-m2m in
 * this file to work around a PRESENT-but-empty DATABRICKS_TOKEN; that empty
 * token is no longer injected, so the workaround is unnecessary and would only
 * risk drift between this file and its ~10 shipped copies.
 *
 * Callers do `const headers = await authHeaders(req); h.set('Content-Type', ...)`
 * and pass `headers` straight to `fetch()`.
 */
export async function authHeaders(req: Request): Promise<Headers> {
  const h = new Headers();
  const userToken = req.headers['x-forwarded-access-token'] as string | undefined;
  if (userToken) {
    h.set('Authorization', `Bearer ${userToken}`);
    return h;
  }
  const { client } = getExecutionContext();
  await client.config.authenticate(h);
  return h;
}

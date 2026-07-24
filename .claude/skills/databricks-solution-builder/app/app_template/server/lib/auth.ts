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

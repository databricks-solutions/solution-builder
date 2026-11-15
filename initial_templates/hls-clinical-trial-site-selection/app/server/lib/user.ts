/**
 * User identity resolution for Databricks Apps.
 *
 * Two code paths share the same header→env fall-through logic:
 *
 *   - `getCurrentUserEmail(req)`   — used everywhere we need a stable
 *     per-user key (persist conversations, scope audit rows, etc.).
 *
 *   - `getCurrentUserInfo(req)`    — used by `/api/me` to send the full
 *     identity down to the browser (name + email + workspace).
 *
 * In prod, Databricks Apps injects `x-forwarded-email` +
 * `x-forwarded-preferred-username` on every request (OBO). In dev none of
 * those exist, so we fall back to env vars then a safe placeholder so the
 * app still boots.
 */
import type { Request } from 'express';

const PLACEHOLDER_EMAIL = 'local_user@databricks.com';

export function getCurrentUserEmail(req: Request): string {
  const h = req.headers;
  const forwardedEmail = (h['x-forwarded-email'] as string) ?? '';
  if (forwardedEmail) return forwardedEmail;
  const forwardedUser = (h['x-forwarded-user'] as string) ?? '';
  if (forwardedUser.includes('@')) return forwardedUser;
  return process.env.DEV_USER_EMAIL ?? PLACEHOLDER_EMAIL;
}

export type UserInfo = {
  userName: string;
  userEmail: string | null;
  workspaceUrl: string;
  workspaceId: string | null;
};

export function getCurrentUserInfo(req: Request): UserInfo {
  const h = req.headers;
  const userName =
    (h['x-forwarded-preferred-username'] as string) ??
    (h['x-forwarded-user'] as string) ??
    process.env.USER ??
    'dev-user';
  const userEmail = (h['x-forwarded-email'] as string) ?? null;
  return {
    userName,
    userEmail,
    workspaceUrl: process.env.DATABRICKS_HOST ?? '',
    workspaceId: process.env.DATABRICKS_WORKSPACE_ID ?? null,
  };
}

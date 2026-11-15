import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

// The SP path resolves the app's own credentials via the AppKit client.
vi.mock('@databricks/appkit', () => ({
  getExecutionContext: () => ({
    client: { config: { authenticate: (h: Headers) => Promise.resolve(h.set('Authorization', 'Bearer SP')) } },
  }),
}));

const { authedFetch, usesSpFallback } = await import('./auth.js');

const reqWithUserToken = () => ({ headers: { 'x-forwarded-access-token': 'USER' } }) as unknown as Request;
const authOf = (call: unknown[]) => new Headers((call[1] as RequestInit).headers).get('Authorization');

afterEach(() => vi.unstubAllGlobals());

describe('authedFetch — OBO first, one SP retry on 401/403', () => {
  it('uses the viewer token when it is accepted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const req = reqWithUserToken();
    const resp = await authedFetch(req, 'https://h/api', { headers: { 'Content-Type': 'application/json' } });
    expect(resp.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authOf(fetchMock.mock.calls[0])).toBe('Bearer USER');
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Content-Type')).toBe('application/json');
    expect(usesSpFallback(req)).toBe(false);
  });

  it('retries once as the SP on 403 and stays on the SP for the rest of the request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Invalid Token', { status: 403 }))
      .mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const req = reqWithUserToken();
    expect((await authedFetch(req, 'https://h/a')).status).toBe(200);
    expect(fetchMock.mock.calls.map(authOf)).toEqual(['Bearer USER', 'Bearer SP']);
    expect(usesSpFallback(req)).toBe(true);
    await authedFetch(req, 'https://h/b');
    expect(authOf(fetchMock.mock.calls[2])).toBe('Bearer SP');
  });

  it('does not retry non-auth failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await authedFetch(reqWithUserToken(), 'https://h/a')).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/**
 * Pull the server's error message out of a non-2xx response. Most of our
 * routes (chat decide, admin, etc.) return `{ "error": "..." }`; some
 * return plain text; some return nothing. Try in that order; fall back
 * to "HTTP <status>" so consumers always have *something* to surface.
 *
 * Use this in every fetch helper so the UI can show a real reason
 * ("Database is still initializing — please retry in a moment.") instead
 * of a generic "/api/foo failed: 503".
 */
export async function okOrThrow(res: Response, label: string): Promise<Response> {
  if (res.ok) return res;
  let detail = '';
  const ctype = res.headers.get('content-type') ?? '';
  try {
    if (ctype.includes('json')) {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error ?? body.message ?? '';
    } else {
      detail = (await res.text()).slice(0, 500);
    }
  } catch {
    /* body unreadable — fall through */
  }
  throw new Error(`${label}: ${res.status}${detail ? ` — ${detail}` : ''}`);
}

/**
 * One-shot data loader for boot-time API calls (config, me, warehouse,
 * activity feed, etc.). Returns `{data, error, loading, retry}` so views
 * can render a real error state + retry button instead of spinning on
 * `Loading…` forever when an upstream call fails (e.g. migration gate
 * 503s, MLflow unreachable, OBO token misconfigured).
 *
 * Pass a stable `loader` (define outside the component, or wrap with
 * useCallback). The hook re-runs when the loader identity changes.
 *
 * Cancellation: a stale response that resolves after unmount or after a
 * loader change is ignored (won't setState on dead components).
 */
type Resource<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  retry: () => void;
};

function useResource<T>(loader: () => Promise<T>): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader()
      .then((v) => {
        if (cancelled) return;
        setData(v);
        setError(null);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loader, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, retry };
}

type Me = {
  userName: string;
  userEmail: string | null;
  workspaceUrl: string;
  workspaceId: string | null;
  isUserContext: boolean;
};

export type ScriptStep = {
  /** Optional short label; falls back to `prompt` (truncated in the UI). */
  label?: string;
  prompt: string;
  /** Lowercase substrings the previous assistant message must contain for
   *  this step to be "recommended next". First step (empty) is the entry. */
  triggerAfter?: string[];
};

type AppConfig = {
  /** Pinned MLflow experiment id, used by AppHeader's "Experiment" link. */
  mlflowExperimentId: string | null;
  /** Auto-created experiment that holds the agent's traces. The chat's
   * "View trace" deep-link points here. See server/server.ts. */
  agentMlflowExperimentId: string | null;
  dashboardId: string;
  branding: { appName: string };
  assistantScript: ScriptStep[];
};

async function fetchMe(): Promise<Me> {
  const res = await okOrThrow(await fetch('/api/me'), '/api/me');
  return res.json();
}

async function fetchConfig(): Promise<AppConfig> {
  const res = await okOrThrow(await fetch('/api/config'), '/api/config');
  return res.json();
}

export type Warehouse = {
  id: string | null;
  name: string | null;
  state: string | null;
};

export async function fetchWarehouse(): Promise<Warehouse> {
  const res = await okOrThrow(await fetch('/api/warehouse'), '/api/warehouse');
  return res.json();
}

/** One workspace resource: its id (or endpoint name) + a deep-link URL.
 *  Composed server-side from DATABRICKS_HOST + config/app.json. Either
 *  field can be the empty string when the resource isn't configured for
 *  this demo — callers should treat empty `url` as "render the tile
 *  non-clickable". */
export type ResourceEntry = { id: string; url: string };

/** All workspace resources exposed by /api/resources. Keys map 1:1 to
 *  the buildResources() table in server/routes/config.ts. */
export type WorkspaceResources = {
  dashboard:     ResourceEntry;
  genie:         ResourceEntry;
  pipeline:      ResourceEntry;
  warehouse:     ResourceEntry;
  lakebase:      ResourceEntry;
  mas:           ResourceEntry;
  ka:            ResourceEntry;
  gateway:       ResourceEntry;
  databricksOne: ResourceEntry;
  agentBricks:   ResourceEntry;
  catalog:       ResourceEntry;
  model:         ResourceEntry;
  volume:        ResourceEntry;
  app:           ResourceEntry;
};

export async function fetchResources(): Promise<WorkspaceResources> {
  const res = await okOrThrow(await fetch('/api/resources'), '/api/resources');
  return res.json();
}

/** The persistent dock conversation for the current user. */
export type DockConversation = {
  id: string;
  title: string;
  kind: 'default' | 'demo_dock';
  createdAt: string;
  updatedAt: string;
};

export async function fetchDockConversation(): Promise<DockConversation> {
  const res = await okOrThrow(
    await fetch('/api/dock-conversation'),
    '/api/dock-conversation',
  );
  return res.json();
}

export async function resetDemoState(): Promise<void> {
  await okOrThrow(
    await fetch('/api/admin/reset', { method: 'POST' }),
    '/api/admin/reset',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Session context — fetched ONCE at the app root, consumed by every page.
//
// Why: /api/me and /api/config are immutable for the page's lifetime and
// were previously fetched independently by AppHeader, AppSidebar, HomeView,
// ChatDock, ChatView, OperationsView, DashboardView — 8-10 redundant
// requests per page load (doubled in dev under Strict Mode).
//
// Pattern: wrap the router in <SessionProvider> once, then call
// `const { me, config } = useSession()` anywhere downstream. The provider
// holds the single fetch state, surfaces error/retry, and renders a
// minimal loading shell while the boot calls are in flight.
// ────────────────────────────────────────────────────────────────────────
type SessionValue = {
  me: Me | null;
  config: AppConfig | null;
  meError: string | null;
  configError: string | null;
  retry: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const meRes = useResource(fetchMe);
  const configRes = useResource(fetchConfig);
  const value: SessionValue = {
    me: meRes.data,
    config: configRes.data,
    meError: meRes.error,
    configError: configRes.error,
    retry: () => {
      meRes.retry();
      configRes.retry();
    },
  };
  return createElement(SessionContext.Provider, { value }, children);
}

/** Read the session-wide me + config (fetched once at the root). */
export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) {
    throw new Error('useSession() called outside <SessionProvider>');
  }
  return v;
}

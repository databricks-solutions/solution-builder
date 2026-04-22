export type Me = {
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

export type AppConfig = {
  agentEndpointName: string;
  mlflowExperimentId: string | null;
  agentMlflowExperimentId: string | null;
  dashboardId: string;
  branding: { appName: string };
  assistantScript: ScriptStep[];
};

export async function fetchMe(): Promise<Me> {
  const res = await fetch('/api/me');
  if (!res.ok) throw new Error(`/api/me failed: ${res.status}`);
  return res.json();
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`/api/config failed: ${res.status}`);
  return res.json();
}

export type Warehouse = {
  id: string | null;
  name: string | null;
  state: string | null;
};

export async function fetchWarehouse(): Promise<Warehouse> {
  const res = await fetch('/api/warehouse');
  if (!res.ok) throw new Error(`/api/warehouse failed: ${res.status}`);
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
  const res = await fetch('/api/dock-conversation');
  if (!res.ok) throw new Error(`/api/dock-conversation: ${res.status}`);
  return res.json();
}

export async function resetDemoState(): Promise<void> {
  const res = await fetch('/api/admin/reset', { method: 'POST' });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string;
    };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
}

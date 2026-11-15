/**
 * Top bar — surfaces the Databricks context the app is running in.
 *
 * Template intent: this is where the viewer SEES the Databricks stack at
 * a glance. We show:
 *   - Current user + workspace (from `/api/me`)
 *   - The SQL warehouse the analytics plugin is pointed at
 *     (name + state) — reminds the viewer this is a live warehouse
 *   - "Agent traces ↗"  → deep-link to the MLflow experiment that holds
 *                         OpenAI Agents SDK spans (root + per-tool + LLM)
 *   - "Agent traces ↗"    → deep-link to the MLflow experiment of the agent
 *                         endpoint (server-side traces, one per turn)
 *   - "Reset demo"      → wipes + re-syncs the Lakebase mirror
 *
 * Keep these pills visible; they're the "show, don't tell" for traces +
 * observability.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
  SidebarTrigger,
  Spinner,
} from '@databricks/appkit-ui/react';
import { AlertTriangle, ArrowUpRight, FlaskConical, RotateCcw } from 'lucide-react';
import { resetDemoState, useSession } from '@/lib/api';
import { conversationStore } from '@/lib/conversations';
import { dataMutated } from '@/lib/events';

export function AppHeader() {
  // me + config come from SessionProvider in App.tsx — fetched ONCE at the
  // root and shared by every consumer (header, sidebar, home, dock, etc.).
  const { me, config, meError, configError, retry: retryBoot } = useSession();
  const bootError = meError ?? configError;

  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleReset() {
    setResetting(true);
    setResetError(null);
    try {
      await resetDemoState();
      conversationStore.clear();
      dataMutated.emit();
      setResetOpen(false);
      navigate('/');
    } catch (e) {
      setResetError((e as Error).message);
    } finally {
      setResetting(false);
    }
  }

  const initials = (me?.userName ?? '?')
    .split(/[@.\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');

  const experimentBase = me?.workspaceUrl?.replace(/\/$/, '') ?? null;
  const masExperimentUrl =
    experimentBase && config?.mlflowExperimentId
      ? `${experimentBase}/ml/experiments/${config.mlflowExperimentId}`
      : null;
  const agentExperimentUrl =
    experimentBase && config?.agentMlflowExperimentId
      ? `${experimentBase}/ml/experiments/${config.agentMlflowExperimentId}`
      : null;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <div className="flex-1" />
      {bootError && (
        <button
          type="button"
          onClick={retryBoot}
          className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive hover:bg-destructive/15 transition-colors"
          title={`Backend error: ${bootError}\nClick to retry /api/me + /api/config.`}
        >
          <AlertTriangle className="size-3.5" />
          Backend error — click to retry
        </button>
      )}
      {agentExperimentUrl && (
        <a
          href={agentExperimentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          title="Open the MLflow experiment that stores agent traces"
        >
          <FlaskConical className="size-3.5" />
          Agent traces
          <ArrowUpRight className="size-3" />
        </a>
      )}
      {masExperimentUrl && (
        <a
          href={masExperimentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          title="Open the MLflow experiment that stores the agent traces"
        >
          <FlaskConical className="size-3.5" />
          Agent traces
          <ArrowUpRight className="size-3" />
        </a>
      )}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogTrigger asChild>
          <button
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent)] text-white px-2.5 sm:px-3 py-1 text-xs font-medium hover:brightness-95 transition-all shadow-sm"
            title="Roll the demo back to Monday morning: 24 new submissions, nothing reviewed"
            aria-label="Reset demo"
          >
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">Reset the demo</span>
            <span className="sm:hidden">Reset demo</span>
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent
          className="sm:max-w-[560px]"
          // Radix's AlertDialog blocks outside-click by default (it's meant for
          // destructive confirmations). For this "play it again" reset, we want
          // the lighter Dialog behavior — click outside or Esc dismisses.
          // appkit-ui's TS types narrow to a div-shape; the Radix props pass
          // through at runtime via the spread, so we cast to bypass the type.
          {...({
            onPointerDownOutside: () => !resetting && setResetOpen(false),
            onEscapeKeyDown: () => !resetting && setResetOpen(false),
          } as object)}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the demo</AlertDialogTitle>
            <AlertDialogDescription>
              Reviews were drafted, referred and issued. This wipes the desk's Lakebase tables and chat
              history, deletes the desk's write-back rows in Delta (uw_decisions) and re-syncs today's
              queue from Delta — all 24 submissions back to new, nothing reviewed or issued.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {resetError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {resetError}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleReset();
              }}
              disabled={resetting}
              className="bg-[var(--accent)] text-white hover:brightness-95"
            >
              {resetting ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Resetting…
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <RotateCcw className="size-4" />
                  Reset to the storm start
                </span>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-full hover:bg-muted px-2 py-1 transition-colors"
            aria-label="User menu"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials || '?'}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium hidden sm:inline">
              {me?.userName ?? '…'}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <div className="font-medium">{me?.userName ?? '—'}</div>
            {me?.userEmail && (
              <div className="text-xs text-muted-foreground font-normal">
                {me.userEmail}
              </div>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="text-xs">
            {me?.isUserContext ? 'OBO (user) auth' : 'Service principal auth'}
          </DropdownMenuItem>
          {agentExperimentUrl && (
            <DropdownMenuItem asChild>
              <a href={agentExperimentUrl} target="_blank" rel="noopener noreferrer">
                Open Agent traces ↗
              </a>
            </DropdownMenuItem>
          )}
          {masExperimentUrl && (
            <DropdownMenuItem asChild>
              <a href={masExperimentUrl} target="_blank" rel="noopener noreferrer">
                Open Agent traces ↗
              </a>
            </DropdownMenuItem>
          )}
          {me?.workspaceUrl && (
            <DropdownMenuItem asChild>
              <a href={me.workspaceUrl} target="_blank" rel="noopener noreferrer">
                Open workspace ↗
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

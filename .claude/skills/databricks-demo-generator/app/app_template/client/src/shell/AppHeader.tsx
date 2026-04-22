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
 *   - "MAS traces ↗"    → deep-link to the MLflow experiment of the MAS
 *                         endpoint (server-side traces, one per turn)
 *   - "Reset demo"      → wipes + re-syncs the Lakebase mirror
 *
 * Keep these pills visible; they're the "show, don't tell" for traces +
 * observability.
 */
import { useEffect, useState } from 'react';
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
import { ArrowUpRight, FlaskConical, RotateCcw } from 'lucide-react';
import { fetchConfig, fetchMe, resetDemoState, type AppConfig, type Me } from '@/lib/api';
import { conversationStore } from '@/lib/conversations';
import { dataMutated } from '@/lib/events';

export function AppHeader() {
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    fetchMe().then(setMe).catch(console.error);
    fetchConfig().then(setConfig).catch(console.error);
  }, []);

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
          title="Open the MLflow experiment that stores MAS traces"
        >
          <FlaskConical className="size-3.5" />
          MAS traces
          <ArrowUpRight className="size-3" />
        </a>
      )}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogTrigger asChild>
          <button
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            title="Wipe the app's Lakebase tables (conversations, feedback, customers/orders/returns) and re-sync from Delta"
          >
            <RotateCcw className="size-3.5" />
            Reset demo
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset demo state?</AlertDialogTitle>
            <AlertDialogDescription>
              This truncates the app's Lakebase tables —{' '}
              <strong>conversations</strong>, <strong>messages</strong>,{' '}
              <strong>feedback</strong>, plus the mirror of{' '}
              <strong>customers</strong>, <strong>orders</strong>, and{' '}
              <strong>returns</strong> (emails &amp; AI audit trail included)
              — then re-syncs the mirror from Delta.
              <br />
              <br />
              The Delta source tables, MLflow experiments, and your workspace
              are untouched. MLflow assessments already recorded on traces
              will remain in MLflow.
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetting ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Resetting…
                </span>
              ) : (
                'Reset everything'
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
                Open MAS traces ↗
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

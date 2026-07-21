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
import { AlertTriangle, ArrowUpRight, FlaskConical, GitBranch, RotateCcw } from 'lucide-react';
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
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent)] text-white px-2.5 sm:px-3 py-1 text-xs font-medium hover:brightness-95 transition-all shadow-sm"
            title="Roll the demo back to a clean state using a Lakebase branch reset"
            aria-label="Reset demo"
          >
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">Reset the demo with Lakebase Branching</span>
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
            <AlertDialogTitle>Reset the demo with Lakebase Branching</AlertDialogTitle>
            <AlertDialogDescription>
              You just played the demo — refunds were approved, emails went out, the
              audit trail filled up. To run it again from the top, we need a clean
              slate. Lakebase branching makes that one click.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Lakebase branching pitch — the reset IS the branching story.
              We sell the pattern (fork main, work on a side branch, throw it away)
              and frame the click as exactly that. */}
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <GitBranch className="size-4 text-[var(--accent)]" />
              Branch the database, not just the code
            </div>

            <BranchDiagram />

            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>Lakebase</strong> is Databricks-native serverless Postgres with
              <strong> copy-on-write branches</strong> — fork
              <code className="mx-1 rounded bg-background px-1 py-0.5 font-mono text-[11px] text-foreground border border-border">production</code>
              into a side branch instantly, with zero data copy. Try a schema
              migration, replay a customer scenario, ship a release candidate —
              throw the branch away when you're done. Same workflow your engineers
              already use on Git for code, now applied to the OLTP database
              powering this app.
            </p>

            <pre className="rounded bg-background border border-border p-2 text-[11px] font-mono text-foreground overflow-x-auto">
{`$ databricks postgres create-branch dev-reset \\
    --source-branch projects/<id>/branches/production`}
            </pre>
          </div>

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
                  <Spinner /> Branching and restoring…
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <GitBranch className="size-4" />
                  Branch &amp; restore the demo state
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

/**
 * Tiny git-graph SVG: a `production` line running left → right with a `dev-reset`
 * branch arc forking off about 1/3 in. Two commit dots per line. Pure illustration —
 * no animation, no data. Used in the Reset dialog to sell the Lakebase branching pattern.
 */
function BranchDiagram() {
  return (
    <svg
      viewBox="0 0 480 120"
      className="w-full h-auto"
      aria-hidden
    >
      {/* production lane */}
      <line x1="20" y1="35" x2="460" y2="35" stroke="var(--primary)" strokeWidth="2.5" />
      <circle cx="60"  cy="35" r="5" fill="var(--primary)" />
      <circle cx="200" cy="35" r="5" fill="var(--primary)" />
      <circle cx="340" cy="35" r="5" fill="var(--primary)" />
      <circle cx="440" cy="35" r="6" fill="var(--primary)" stroke="var(--background)" strokeWidth="2" />
      <text x="20"  y="22" fontSize="11" fontWeight="700" fill="var(--primary)">production</text>
      <text x="440" y="22" fontSize="9"  fontWeight="600" fill="var(--muted-foreground)" textAnchor="end">HEAD · live</text>

      {/* fork arc from production at x=200 down to dev-reset lane y=80 */}
      <path
        d="M 200 35 C 220 35, 230 80, 260 80"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
      />
      {/* dev-reset lane */}
      <line x1="260" y1="80" x2="460" y2="80" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="4 3" />
      <circle cx="280" cy="80" r="5" fill="var(--accent)" />
      <circle cx="360" cy="80" r="5" fill="var(--accent)" />
      <circle cx="440" cy="80" r="6" fill="var(--accent)" stroke="var(--background)" strokeWidth="2" />
      <text x="280" y="100" fontSize="11" fontWeight="700" fill="var(--accent)">dev-reset</text>
      <text x="280" y="114" fontSize="9"  fontWeight="600" fill="var(--muted-foreground)">
        try the new schema · throw away when done
      </text>
    </svg>
  );
}

/**
 * Per-assistant-message feedback row + trace deep link.
 *
 * Two pieces of the Databricks story live here:
 *
 *   1. **View trace** — deep-links to the MLflow experiment entry for this
 *      turn. Every agent run opens a root span and child spans per tool
 *      call + LLM call; clicking this link lets the viewer explore the
 *      whole tree. The UX matters because "traces" is abstract — seeing
 *      them right there, one click from the message, is how you *sell*
 *      observability.
 *
 *   2. **Thumbs up/down** — POSTs to `/api/messages/:id/feedback`, which
 *      both writes an audit row in Lakebase AND calls MLflow's
 *      `assessments` API to attach the rating to the trace. Thumbs-down
 *      pops a modal asking "what was the issue?" — the rationale is
 *      persisted alongside the trace as a HUMAN-source assessment, which
 *      feeds evaluation workflows (MLflow eval datasets, LLM-as-judge,
 *      etc.). Again, the UI makes the data story visible.
 */
import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import { Spinner } from '@databricks/appkit-ui/react';

type FeedbackValue = 'up' | 'down' | null;

type Props = {
  messageId?: string;
  traceId?: string | null;
  workspaceUrl: string;
  experimentId: string | null;
};

export function FeedbackRow({
  messageId,
  traceId,
  workspaceUrl,
  experimentId,
}: Props) {
  const [value, setValue] = useState<FeedbackValue>(null);
  const [thanks, setThanks] = useState(false);
  const [pending, setPending] = useState<FeedbackValue>(null);
  const [error, setError] = useState<string | null>(null);
  const [downOpen, setDownOpen] = useState(false);

  // The "View trace" deep-link needs THREE pieces, all from /api/config:
  //   • traceId      — set on the assistant message after `response.completed`
  //   • experimentId — `agentMlflowExperimentId` (auto-created at server boot
  //                    from `agentMlflowExperimentPath`); falls back to the
  //                    pinned legacy `mlflowExperimentId` if used.
  //   • workspaceUrl — `Me.workspaceUrl` (window.location of the workspace)
  // If any are missing the link is hidden and we render "Trace pending…".
  // The most common cause of a stuck "Trace pending…" is `experimentId`
  // being null — set `agentMlflowExperimentPath` in config/app.json so the
  // server can auto-create the experiment. See server.ts AppConfig docs.
  const traceUrl =
    traceId && experimentId && workspaceUrl
      ? `${workspaceUrl.replace(/\/$/, '')}/ml/experiments/${experimentId}/traces?selectedEvaluationId=${traceId}`
      : null;

  async function submit(v: 'up' | 'down', rationale?: string) {
    if (!messageId) {
      setValue(v);
      setThanks(true);
      setTimeout(() => setThanks(false), 2200);
      return;
    }
    setPending(v);
    setError(null);
    try {
      const res = await fetch(`/api/messages/${messageId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: v, rationale }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setValue(v);
      setThanks(true);
      setTimeout(() => setThanks(false), 2200);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {traceUrl ? (
          <a
            href={traceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            title={`Open MLflow trace ${traceId}`}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ background: 'var(--accent)' }}
            />
            View trace
            <ArrowUpRight className="size-3" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-muted-foreground/60">
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
            Trace pending…
          </span>
        )}
        <div className="inline-flex items-center rounded-full border border-border bg-card overflow-hidden">
          <FeedbackButton
            icon={<ThumbsUp className="size-3.5" />}
            active={value === 'up'}
            pending={pending === 'up'}
            onClick={() => void submit('up')}
            label="Helpful"
          />
          <span className="h-4 w-px bg-border" />
          <FeedbackButton
            icon={<ThumbsDown className="size-3.5" />}
            active={value === 'down'}
            pending={pending === 'down'}
            onClick={() => setDownOpen(true)}
            label="Not helpful"
          />
        </div>
        {thanks && (
          <span className="text-muted-foreground animate-pulse">Thanks</span>
        )}
        {error && <span className="text-destructive">Error: {error}</span>}
      </div>

      {downOpen && (
        <ThumbsDownModal
          onClose={() => setDownOpen(false)}
          onSubmit={async (rationale) => {
            await submit('down', rationale);
          }}
          traceUrl={traceUrl}
        />
      )}
    </>
  );
}

function FeedbackButton({
  icon,
  active,
  pending,
  onClick,
  label,
}: {
  icon: React.ReactNode;
  active: boolean;
  pending: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center px-2.5 py-1 transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      } disabled:opacity-50`}
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------

type ModalProps = {
  onClose: () => void;
  onSubmit: (rationale: string) => Promise<void>;
  traceUrl: string | null;
};

function ThumbsDownModal({ onClose, onSubmit, traceUrl }: ModalProps) {
  const [rationale, setRationale] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = rationale.trim();
    if (!trimmed) return;
    setState('saving');
    setError(null);
    try {
      await onSubmit(trimmed);
      setState('saved');
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--overlay)' }}
      onClick={state === 'saving' ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ThumbsDown className="size-4 text-muted-foreground" />
            <div className="text-sm font-semibold">What was the issue?</div>
          </div>
          <button
            onClick={onClose}
            disabled={state === 'saving'}
            className="size-7 rounded-md hover:bg-muted inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {state === 'saved' ? (
          <div className="px-5 py-6 flex flex-col items-center gap-4 text-center">
            <div className="size-12 rounded-full bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)] flex items-center justify-center">
              <CheckCircle2 className="size-6" />
            </div>
            <div>
              <div className="font-semibold text-sm">
                Your feedback has been saved
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                The assessment is now attached to this trace in MLflow.
              </div>
            </div>
            <div className="flex items-center gap-2">
              {traceUrl && (
                <a
                  href={traceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-4 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity"
                >
                  Review in MLflow
                  <ArrowUpRight className="size-3.5" />
                </a>
              )}
              <button
                onClick={onClose}
                className="inline-flex items-center rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="e.g. Didn't return the lot number I asked for"
              disabled={state === 'saving'}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40 disabled:opacity-60 resize-none"
              autoFocus
            />
            {error && (
              <div className="text-xs text-destructive">
                Couldn't save: {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={state === 'saving'}
                className="rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={state === 'saving' || !rationale.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-4 py-1.5 text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {state === 'saving' ? (
                  <>
                    <Spinner />
                    Saving…
                  </>
                ) : (
                  'Send feedback'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

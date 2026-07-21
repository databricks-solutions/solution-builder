/**
 * Modal that kicks off an agent-driven adaptation of a forked demo's story.
 *
 * A freshly forked project is a verbatim copy of a template — the fastest way
 * to make it your own is to tell the agent what to change. This dialog gives
 * that first prompt a home instead of leaving the user staring at the chat box
 * wondering what to type.
 *
 * Two modes, chosen by the caller:
 *   - "full"     → substantially rewrite the whole story (new industry, angle,
 *                  persona, business context).
 *   - "customer" → keep the solution/story intact, just swap in a new customer
 *                  name + details (a re-brand, not a redesign).
 *
 * The dialog collects free-form instructions and hands them back to the parent,
 * which assembles the actual agent prompt (prompt-engineering lives alongside
 * the other agent handlers in the route).
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, UserRoundCog, Rocket, Sparkles, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type StoryAdaptMode = "full" | "customer";

interface StoryAdaptDialogProps {
  /** null → closed. The mode also drives the copy shown in the dialog. */
  mode: StoryAdaptMode | null;
  isOpen: boolean;
  onClose: () => void;
  /** Hand the typed instructions to the parent, which builds + sends the
   *  agent prompt. Returning a promise keeps the dialog in its busy state
   *  until the send has kicked off. */
  onSubmit: (mode: StoryAdaptMode, instructions: string) => Promise<void> | void;
}

const COPY: Record<
  StoryAdaptMode,
  { title: string; icon: typeof Pencil; description: string; label: string; placeholder: string; cta: string }
> = {
  full: {
    title: "Modify the entire story",
    icon: Pencil,
    description:
      "Reshape this demo's narrative — new industry, angle, persona, or business context. The agent rewrites the story to match your direction.",
    label: "What should the new story be about?",
    placeholder:
      "e.g. Retarget this to a regional bank fighting fraud. The persona is a risk analyst who needs to spot anomalous transactions in real time and explain them to auditors.",
    cta: "Rewrite story",
  },
  customer: {
    title: "Adapt the customer name & details",
    icon: UserRoundCog,
    description:
      "Keep the same solution and story — just re-brand it for a different customer. The agent swaps in the new company, persona names, and product references.",
    label: "Who's the new customer?",
    placeholder:
      "e.g. Swap LuxeBeauty for “Northwind Outfitters”, an outdoor-apparel retailer. Persona is Maya Chen, VP of Merchandising. Keep everything else the same.",
    cta: "Adapt details",
  },
};

export const StoryAdaptDialog = memo(function StoryAdaptDialog({
  mode,
  isOpen,
  onClose,
  onSubmit,
}: StoryAdaptDialogProps) {
  const [instructions, setInstructions] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset every time the dialog reopens (or switches mode).
  useEffect(() => {
    if (isOpen) {
      setInstructions("");
      setIsSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, mode]);

  const handleSubmit = useCallback(async () => {
    const trimmed = instructions.trim();
    if (!trimmed || isSubmitting || !mode) return;
    setIsSubmitting(true);
    try {
      await onSubmit(mode, trimmed);
      onClose();
    } catch (err) {
      // The send failed to start — surface nothing fancy, just let the user
      // retry. (handleSendMessage no-ops silently while streaming.)
      console.error("Story adaptation failed to start:", err);
      setIsSubmitting(false);
    }
  }, [instructions, isSubmitting, mode, onSubmit, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl+Enter submits — Enter alone inserts a newline (multi-line input).
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (!mode) return null;
  const copy = COPY[mode];
  const Icon = copy.icon;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <label
            htmlFor="story-adapt-instructions"
            className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
          >
            {copy.label}
          </label>
          <Textarea
            id="story-adapt-instructions"
            ref={textareaRef}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={copy.placeholder}
            className="min-h-[140px] resize-y text-sm"
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            The agent picks this up in the chat and gets to work — you can keep
            refining from there. <kbd className="rounded bg-muted px-1">⌘</kbd>+
            <kbd className="rounded bg-muted px-1">Enter</kbd> to send.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !instructions.trim()} className="gap-1.5">
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Icon className="h-4 w-4" />
                {copy.cta}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default StoryAdaptDialog;

// ---------------------------------------------------------------------------
// StoryAdaptActions — the fork "start here" band. This is the clear next step
// on a freshly forked project: build the demo as-is, or tell the agent what to
// change first. Deliberately prominent (accent frame + primary CTA) so a user
// landing on the page knows exactly what to do. Self-contained — owns the
// dialog + open-state — so any surface can drop it in.
// ---------------------------------------------------------------------------

interface StoryAdaptActionsProps {
  /** Disables every action while the agent is streaming (send would no-op). */
  isStreaming?: boolean;
  /** Kick off generation immediately, keeping the story unchanged. */
  onUseAsIs: () => void;
  /** Assemble + send the agent prompt for the chosen adapt mode. */
  onAdaptStory: (mode: StoryAdaptMode, instructions: string) => Promise<void> | void;
  className?: string;
}

const ADAPT_CARDS: Array<{
  mode: StoryAdaptMode;
  icon: typeof Pencil;
  title: string;
  blurb: string;
}> = [
  {
    mode: "customer",
    icon: UserRoundCog,
    title: "Adapt the customer",
    blurb: "Re-brand it — new company, persona & details. Same solution.",
  },
  {
    mode: "full",
    icon: Pencil,
    title: "Modify the story",
    blurb: "New industry, angle, or persona — reshape the whole narrative.",
  },
];

export const StoryAdaptActions = memo(function StoryAdaptActions({
  isStreaming,
  onUseAsIs,
  onAdaptStory,
  className,
}: StoryAdaptActionsProps) {
  const [adaptMode, setAdaptMode] = useState<StoryAdaptMode | null>(null);

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-primary/30 bg-primary/[0.04] p-5 sm:p-6 shadow-sm",
        className,
      )}
    >
      {/* soft accent glow so the band reads as the focal CTA */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground">Make this demo yours</h2>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              This is your own editable copy. Build it exactly as written, or tell the agent what to
              change first.
            </p>
          </div>
        </div>

        {/* Primary action — the default path: just generate. */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <Button
            size="lg"
            onClick={onUseAsIs}
            disabled={isStreaming}
            className="gap-2 shadow-sm"
          >
            <Rocket className="h-4 w-4" />
            Build it as-is
            <ArrowRight className="h-4 w-4 opacity-80" />
          </Button>
          <span className="text-xs text-muted-foreground">
            Keeps the story unchanged and generates the whole demo.
          </span>
        </div>

        {/* Secondary — adapt first. Quieter than the primary CTA. */}
        <div className="mt-5 pt-4 border-t border-primary/15">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2.5">
            Or adapt it first
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5">
            {ADAPT_CARDS.map(({ mode, icon: Icon, title, blurb }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAdaptMode(mode)}
                disabled={isStreaming}
                className="flex-1 group flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50 disabled:pointer-events-none"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{title}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {isStreaming && (
          <p className="text-xs text-muted-foreground mt-3">
            The agent is working — these will re-enable when it's done.
          </p>
        )}
      </div>

      <StoryAdaptDialog
        mode={adaptMode}
        isOpen={adaptMode !== null}
        onClose={() => setAdaptMode(null)}
        onSubmit={async (mode, instructions) => {
          await onAdaptStory(mode, instructions);
        }}
      />
    </section>
  );
});

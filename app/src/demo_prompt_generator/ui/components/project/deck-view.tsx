import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Maximize2,
  MonitorPlay,
  PencilLine,
  Presentation,
  Printer,
  RefreshCw,
  Send,
  StickyNote,
  SunMoon,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { apiUrl } from "../../lib/config";
import type { ProjectFile } from "../../lib/custom-api";
import { editRequestText, mayAskToSend } from "../../lib/deck-edits";
import { noDeckState } from "../../lib/deck-status";
import {
  type DeckCommand,
  type DeckHostState,
  DECK_FRAME_NAME,
  deckUrlWithBuilds,
  hostCommand,
  hostWindowName,
  parseHostPrint,
  parseHostState,
  presenterUrl,
  readBuildsPref,
  writeBuildsPref,
} from "../../lib/deck-host";

/** The POV deck needs a deck kit that this build doesn't ship: off, so no entry point
 *  offers it. A project that already has a deck still shows its Deck tab. */
export const POV_DECK_AVAILABLE = false;

/** The POV deck files the skill's `stages/pov-deck.md` writes under `deck/`. */
export const POV_DECK_PATH = "deck/pov_deck.html";
const RUNBOOK_PATH = "deck/sa_runbook.html";

export function hasPovDeck(files: ProjectFile[]): boolean {
  return files.some((f) => f.path === POV_DECK_PATH);
}

/** A deck file served as a real page by `GET /api/projects/{id}/deck/{file}`, so the
 *  deck's presenter window and relative links resolve (an iframe `srcDoc` would not). */
function deckUrl(projectId: string, path: string): string {
  return apiUrl(`/api/projects/${projectId}/${path}`);
}

interface DeckViewProps {
  projectId: string;
  files: ProjectFile[];
  hasReadme: boolean;
  isStreaming: boolean;
  /** True while the running turn is one the page started as a deck turn (lib/deck-status.ts). */
  deckTurnRunning?: boolean;
  onGeneratePovDeck?: () => void;
  /** Receives a batch of change notes the user confirmed in the host dialog. Passed whenever the
   *  page can take edits, even if this user can't run the agent right now: the deck clears its notes
   *  once it hands them over, so the handler gives them back to copy instead of losing them.
   *  Undefined only where there is no agent at all, and then the deck offers its own Copy. */
  onSendDeckEdits?: (text: string) => void;
}

/** The Deck tab: the html-it POV deck embedded live, or the prompt to make one. */
export const DeckView = memo(function DeckView({
  projectId,
  files,
  hasReadme,
  isStreaming,
  deckTurnRunning = false,
  onGeneratePovDeck,
  onSendDeckEdits,
}: DeckViewProps) {
  const hasDeck = hasPovDeck(files);
  const hasRunbook = files.some((f) => f.path === RUNBOOK_PATH);
  // Re-key the frame when the deck file changes, so a regenerated deck reloads.
  const deckStamp = files.find((f) => f.path === POV_DECK_PATH)?.last_modified ?? "";

  // The deck's edit mode sends change notes to its host page once the host says it listens: post
  // {type:'htmlit:edit-host'} on each load, then take {type:'htmlit:edit-request'} back from this
  // frame only. The sandboxed deck has an opaque origin, so '*' is the only target it can be given;
  // the handshake carries nothing. Without the handshake (no sender), the deck offers Copy instead.
  // A request only opens the dialog below; the user's click there is what sends (lib/deck-edits.ts).
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sendEditsRef = useRef(onSendDeckEdits);
  sendEditsRef.current = onSendDeckEdits;
  const canSendEdits = !!onSendDeckEdits;
  const [pendingEdits, setPendingEdits] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const lastSentRef = useRef<string | null>(null);
  const askToSend = useCallback((text: string | null) => {
    pendingRef.current = text;
    setPendingEdits(text);
  }, []);
  const confirmSend = useCallback(() => {
    const text = pendingRef.current;
    askToSend(null);
    if (!text) return;
    lastSentRef.current = text;
    sendEditsRef.current?.(text);
  }, [askToSend]);
  const offerEditHost = useCallback(() => {
    if (!canSendEdits) return;
    frameRef.current?.contentWindow?.postMessage({ type: "htmlit:edit-host", version: 1 }, "*");
  }, [canSendEdits]);
  useEffect(() => offerEditHost(), [offerEditHost]);   // a sender that appears after load
  useEffect(() => {
    if (!canSendEdits) return;
    const onMessage = (ev: MessageEvent) => {
      if (!frameRef.current || ev.source !== frameRef.current.contentWindow) return;
      const text = editRequestText(ev.data);
      if (text && mayAskToSend(text, { pending: pendingRef.current, lastSent: lastSentRef.current })) askToSend(text);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [canSendEdits, askToSend]);

  // The deck's toolbar, repeated in this bar (lib/deck-host.ts). The deck reports its state; until
  // it does (a deck built before the host toolbar), the deck buttons stay disabled.
  const [deckState, setDeckState] = useState<DeckHostState | null>(null);
  const [buildsOn, setBuildsOn] = useState(() => readBuildsPref(typeof window === "undefined" ? undefined : window.localStorage));
  const buildsOnRef = useRef(buildsOn);
  const titleBeforePrint = useRef<string | null>(null);
  buildsOnRef.current = buildsOn;
  const sendCommand = useCallback((cmd: DeckCommand, value?: boolean) => {
    frameRef.current?.contentWindow?.postMessage(hostCommand(cmd, value), "*");
  }, []);
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!frameRef.current || ev.source !== frameRef.current.contentWindow) return;
      // While the deck prints, this page carries the deck's first-slide title, which names the PDF.
      const pr = parseHostPrint(ev.data);
      if (pr) {
        if (pr.phase === "before" && pr.title) {
          if (titleBeforePrint.current === null) titleBeforePrint.current = document.title;
          document.title = pr.title;
        } else if (pr.phase === "after" && titleBeforePrint.current !== null) {
          document.title = titleBeforePrint.current;
          titleBeforePrint.current = null;
        }
        return;
      }
      const st = parseHostState(ev.data);
      if (!st) return;
      setDeckState(st);
      // A deck starts with html-it's builds on; apply this browser's choice (on by default) once it reports.
      if (st.builds !== buildsOnRef.current) sendCommand("builds", buildsOnRef.current);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendCommand]);
  // The print dialog is modal, so the next click or key press on this page means printing ended:
  // put the app's title back even if the deck's "after" message never came.
  useEffect(() => {
    const restore = () => {
      if (titleBeforePrint.current === null) return;
      document.title = titleBeforePrint.current;
      titleBeforePrint.current = null;
    };
    window.addEventListener("pointerdown", restore, true);
    window.addEventListener("keydown", restore, true);
    return () => {
      restore();
      window.removeEventListener("pointerdown", restore, true);
      window.removeEventListener("keydown", restore, true);
    };
  }, []);
  const toggleBuilds = useCallback(() => {
    const next = !buildsOnRef.current;
    setBuildsOn(next);
    writeBuildsPref(window.localStorage, next);
    sendCommand("builds", next);
  }, [sendCommand]);
  const fitDeck = useCallback(() => {
    // Full screen is asked for here, on the click, because a browser grants it only to the
    // frame that was clicked. The deck scales itself to the new size.
    const f = frameRef.current;
    if (!f) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void f.requestFullscreen?.().catch(() => sendCommand("state"));
  }, [sendCommand]);
  // Present opens the presenter here, on the click: a browser opens a pop-up only from a click
  // in the same frame, so asking the deck to open it was blocked (Morgan, 2026-11-06). The
  // presenter finds the deck's frame by name and links to it (kit patch presenter_link.py), and
  // this window's name lets its "deck: linked" come back here. A deck built before that patch
  // reports no presenter address, so it gets the command and explains its own button.
  const presenterRef = useRef<Window | null>(null);
  const deckStateRef = useRef<DeckHostState | null>(null);
  deckStateRef.current = deckState;
  const presentDeck = useCallback(() => {
    const open = presenterRef.current;
    if (open && !open.closed && deckStateRef.current?.present) {
      open.focus();
      return;
    }
    const back = hostWindowName(projectId);
    const url = presenterUrl(deckUrl(projectId, POV_DECK_PATH), deckStateRef.current?.presenter ?? null, window.location.href, back);
    if (!url) {
      sendCommand("present");
      return;
    }
    window.name = back;
    const w = Math.min(1600, window.screen.availWidth || 1280);
    const h = Math.min(1000, window.screen.availHeight || 800);
    presenterRef.current = window.open(url, "htmlit-presenter", `width=${w},height=${h}`);
    if (!presenterRef.current) sendCommand("present");
  }, [projectId, sendCommand]);
  const onFrameLoad = useCallback(() => {
    setDeckState(null);
    offerEditHost();
    sendCommand("state");
  }, [offerEditHost, sendCommand]);

  if (!hasDeck) {
    const state = noDeckState({ hasReadme, isStreaming, deckTurnRunning });
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md space-y-4 text-center">
          <Presentation className="mx-auto h-10 w-10 text-muted-foreground" />
          {state === "building" ? (
            <>
              <h3 className="text-lg font-semibold">Building the POV deck…</h3>
              <p className="text-sm text-muted-foreground">
                The agent is turning the story into a client-facing deck and a runbook with
                html-it. Follow along in the chat; the deck appears here when it is written.
              </p>
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold">No POV deck yet</h3>
              <p className="text-sm text-muted-foreground">
                {state === "needs-story"
                  ? "The deck is built from the story, so it is available once the story is written."
                  : "Generate a client-facing deck and a runbook for whoever presents it, built from this project's story."}
              </p>
              {state === "busy" && (
                <p className="text-xs text-muted-foreground">Available when the agent finishes its current step.</p>
              )}
              {onGeneratePovDeck && (
                <Button onClick={onGeneratePovDeck} disabled={state !== "ready"} className="gap-1.5">
                  <Presentation className="h-4 w-4" />
                  Generate POV deck
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const src = deckUrl(projectId, POV_DECK_PATH);
  const ready = deckState !== null;
  const notReadyTitle = "Regenerate the deck to use these buttons here. The deck's own toolbar works now.";
  const toolButton = (
    label: string,
    Icon: typeof SunMoon,
    onClick: () => void,
    opts: { pressed?: boolean; title: string },
  ) => (
    <Button
      key={label}
      variant={opts.pressed ? "secondary" : "ghost"}
      size="sm"
      className="h-7 gap-1 px-2"
      onClick={onClick}
      disabled={!ready}
      aria-pressed={opts.pressed}
      title={ready ? opts.title : notReadyTitle}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="text-xs">{label}</span>
    </Button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">POV deck</span>
        <span className="text-xs text-muted-foreground">built with html-it</span>
        <div className="ml-3 flex flex-wrap items-center gap-1" role="toolbar" aria-label="Deck tools">
          {toolButton("Theme", SunMoon, () => sendCommand("theme"), {
            pressed: deckState?.theme === "dark",
            title: "Switch the deck between light and dark",
          })}
          {toolButton("Notes", StickyNote, () => sendCommand("notes"), {
            pressed: deckState?.notes,
            title: "Show the speaker notes under each slide",
          })}
          {toolButton("Edit", PencilLine, () => sendCommand("edit"), {
            pressed: deckState?.edit,
            title: "Pick a part of a slide and say what should change",
          })}
          {toolButton("Present", MonitorPlay, presentDeck, {
            pressed: deckState?.present,
            title: "Open the presenter view: the script, this slide, and the next one",
          })}
          {toolButton("Fit", Maximize2, fitDeck, { title: "Show the deck full screen" })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2"
                disabled={!ready}
                title={ready ? "Save the deck as a PDF or a PowerPoint (.pptx) file, which Google Slides also opens" : notReadyTitle}
              >
                <Printer className="h-3.5 w-3.5" />
                <span className="text-xs">Print</span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => sendCommand("pdf")}>PDF, one slide per page</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => sendCommand("slides")}>PowerPoint (.pptx)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {toolButton(buildsOn ? "Builds on" : "Builds off", Layers, toggleBuilds, {
            pressed: buildsOn,
            title: buildsOn
              ? "On: each click reveals the next part of a slide. Turn off to show every slide whole."
              : "Every slide shows whole, and a click moves to the next slide. Turn on to reveal one part per click. Remembered in this browser.",
          })}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {hasRunbook && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" asChild>
              <a href={deckUrl(projectId, RUNBOOK_PATH)} target="_blank" rel="noopener">
                <FileText className="h-3.5 w-3.5" />
                <span className="text-xs">Runbook</span>
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" asChild>
            <a href={deckUrlWithBuilds(src, buildsOn)} target="_blank" rel="noopener">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="text-xs">Open in new tab</span>
            </a>
          </Button>
          {onGeneratePovDeck && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              onClick={onGeneratePovDeck}
              disabled={isStreaming}
              title="Rebuild the deck from the current story"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="text-xs">Regenerate</span>
            </Button>
          )}
        </div>
      </div>
      <iframe
        ref={frameRef}
        key={deckStamp}
        src={src}
        onLoad={onFrameLoad}
        title="POV deck"
        name={DECK_FRAME_NAME}
        className="w-full flex-1 border-0 bg-white"
        // No allow-same-origin: the deck is agent-written, and with allow-scripts it would
        // cancel the sandbox and run as the viewer. The deck route also sends a CSP sandbox
        // header, which covers the deck opened in a new tab and the presenter popup. allow-popups: the deck's
        // Present button opens its presenter view in a second window.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        allow="fullscreen; clipboard-write"
      />
      <Dialog open={pendingEdits !== null} onOpenChange={(open) => !open && askToSend(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send these deck changes to the agent?</DialogTitle>
            <DialogDescription>
              The agent changes these words in the deck and the runbook, usually in under a minute.
              Regenerate rebuilds the deck from its story and drops these edits. The deck has
              cleared these notes, so copy them before you close this if you want to keep them.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs">
            {pendingEdits}
          </pre>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              className="gap-1.5"
              onClick={() => void navigator.clipboard?.writeText(pendingEdits ?? "")}
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            <Button variant="outline" onClick={() => askToSend(null)}>
              Close
            </Button>
            <Button className="gap-1.5" onClick={confirmSend}>
              <Send className="h-4 w-4" />
              Send to agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

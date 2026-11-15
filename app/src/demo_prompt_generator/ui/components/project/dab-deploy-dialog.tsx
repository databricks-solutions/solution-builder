/**
 * DAB dialog — opened by the project's Download button. Modes:
 *
 * - **Has a DAB** (`hasDab`): renders the project's own `dab_instructions.md`
 *   (the deploy runbook the agent wrote) so the user knows how to deploy the
 *   bundle. Primary action is the zip download; a secondary action asks Solution
 *   Builder to review/update the DAB against the latest changes.
 * - **No DAB**: explains that a bundle makes redeploying in another workspace
 *   much easier, offers to create one (sends the package-as-DAB instruction to
 *   the chat), and still lets the user download the project as-is.
 * - **Creating** (after "Create a DAB"): the dialog stays open and shows a
 *   waiting state while the agent works, then re-checks — if a bundle now
 *   exists it flips to the deploy-runbook view; otherwise it points the user at
 *   the discussion for details.
 *
 * The create/update actions fire chat instructions (wired by the parent); this
 * component renders, routes clicks, and watches the streaming state.
 */
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Prose } from "@/components/markdown-prose";
import { getProjectFile } from "@/lib/custom-api";
import { Download, Loader2, Package, RefreshCw } from "lucide-react";

const INSTRUCTIONS_FILE = "dab_instructions.md";

export function DabDeployDialog({
  projectId,
  open,
  onOpenChange,
  hasDab,
  hasInstructionsFile,
  isStreaming,
  isWorkshop = false,
  onDownload,
  onCreateDab,
  onUpdateDab,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the project ships a databricks.yml. */
  hasDab: boolean;
  /** Whether dab_instructions.md is in the (refreshed) file list. Drives a
   *  re-fetch the moment the agent's write lands, so the content tracks the
   *  same source of truth as hasDab rather than a one-shot fetch. */
  hasInstructionsFile: boolean;
  /** Whether an agent turn is currently streaming. */
  isStreaming: boolean;
  /** Workshop mode — the attendee-kit instructions; onDownload must be the kit. */
  isWorkshop?: boolean;
  /** Triggers the actual zip download. */
  onDownload: () => Promise<void> | void;
  /** Ask the agent to package the project as a DAB (chat instruction). */
  onCreateDab: () => void;
  /** Ask the agent to review/update the existing DAB (chat instruction). */
  onUpdateDab: () => void;
}) {
  const [instructions, setInstructions] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // "absent" = the file genuinely 404s (no instructions shipped); "error" = a
  // transient/other failure (network, folder mid-restore) — we retried and
  // still couldn't read it, so DON'T claim it's missing. null = have content.
  const [loadOutcome, setLoadOutcome] = useState<"absent" | "error" | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Bumped to force a re-fetch (retry button).
  const [reloadKey, setReloadKey] = useState(0);
  // Set when the user clicks "Create a DAB" — keeps the dialog open through the
  // agent turn so we can re-check for the bundle when it finishes.
  const [creating, setCreating] = useState(false);
  const [createFinishedNoDab, setCreateFinishedNoDab] = useState(false);

  // Lazy-load the instructions each time the dialog opens for a DAB project
  // (cheap, and keeps it fresh if the agent re-ran the DAB step since last open).
  // A DAB project WILL have dab_instructions.md, so a miss right after creation
  // is a race (file-list refreshed before the file settled on disk / DB) — retry
  // a few times with backoff before concluding anything, and tell a genuine 404
  // (absent) apart from a transient failure (error) so we never wrongly claim the
  // file is missing while also saying the bundle ships.
  useEffect(() => {
    if (!open || !hasDab) return;
    let alive = true;
    setLoading(true);
    setLoadOutcome(null);

    const isNotFound = (e: unknown) => String(e).includes("404");

    const attempt = async (tries: number, delayMs: number): Promise<void> => {
      try {
        const f = await getProjectFile(projectId, INSTRUCTIONS_FILE);
        if (alive) { setInstructions(f.content); setLoadOutcome(null); }
      } catch (e) {
        if (!alive) return;
        if (tries > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
          if (alive) return attempt(tries - 1, delayMs * 2);
        }
        // Out of retries: a 404 means genuinely absent; anything else is a
        // transient/read error we shouldn't misreport as "no file".
        setInstructions(null);
        setLoadOutcome(isNotFound(e) ? "absent" : "error");
      }
    };

    attempt(3, 500).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // hasInstructionsFile is in the deps so the fetch re-runs the instant the
    // agent's dab_instructions.md write shows up in the refreshed file list.
  }, [open, hasDab, hasInstructionsFile, projectId, reloadKey]);

  // Reset transient state whenever the dialog closes.
  useEffect(() => {
    if (!open) { setCreating(false); setCreateFinishedNoDab(false); }
  }, [open]);

  // While "creating", watch for the agent turn to finish. `isStreaming` flips
  // true when the message sends, then false when the turn ends; when it ends we
  // re-evaluate. If a DAB now exists, `hasDab` is true → the has-DAB view takes
  // over (clear the creating flag). If not, surface the "no bundle produced" note.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (!creating) return;
    if (isStreaming) { wasStreamingRef.current = true; return; }
    // isStreaming is false. Only act once we've actually seen it go true first.
    if (!wasStreamingRef.current) return;
    wasStreamingRef.current = false;
    setCreating(false);
    setCreateFinishedNoDab(!hasDab);
  }, [creating, isStreaming, hasDab]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await onDownload();
      onOpenChange(false);
    } finally {
      setDownloading(false);
    }
  };

  const handleCreate = () => {
    setCreateFinishedNoDab(false);
    setCreating(true);
    onCreateDab();
  };

  // --- Creating: waiting state -------------------------------------------
  if (creating) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Creating your Databricks Asset Bundle…</DialogTitle>
            <DialogDescription>
              Solution Builder is packaging this project into a deployable bundle. This can take
              a minute or two.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Follow along in the chat to see what it&rsquo;s building — you can keep this open;
              it&rsquo;ll show the deploy steps here as soon as the bundle is ready.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        {hasDab ? (
          <>
            <DialogHeader>
              <DialogTitle>Deploy this Databricks Asset Bundle</DialogTitle>
              <DialogDescription>
                The download includes a <code>databricks.yml</code> bundle. Here&rsquo;s how to deploy it — the same steps ship in the zip as <code>{INSTRUCTIONS_FILE}</code>.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading deploy instructions…
                </div>
              ) : instructions ? (
                <Prose>{instructions}</Prose>
              ) : loadOutcome === "error" ? (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Couldn&rsquo;t load the deploy instructions just now.</p>
                  <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This project ships a <code>databricks.yml</code>, but no{" "}
                  <code>{INSTRUCTIONS_FILE}</code> was found. After unzipping, deploy with{" "}
                  <code>databricks bundle deploy</code> from the project root — see the bundle
                  file for the resources it creates.
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Made changes since this bundle was written? Ask Solution Builder to review the
              latest project state and update the DAB.
            </p>

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                variant="outline"
                onClick={onUpdateDab}
                disabled={isStreaming}
                title={isStreaming ? "Wait for the current response to finish" : undefined}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Review / update DAB
              </Button>
              <Button onClick={handleDownload} disabled={downloading}>
                {downloading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Downloading…</>
                ) : (
                  <><Download className="mr-2 h-4 w-4" /> Download zip</>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : isWorkshop ? (
          <>
            {/* Workshop: the attendee kit (onDownload is the kit, never the
                project zip). One zip, two parts: a zip to import into the
                workspace (Import takes a zip, not a folder) and the page to open locally. */}
            <DialogHeader>
              <DialogTitle>Download the kit</DialogTitle>
              <DialogDescription>
                One zip with everything your attendees need.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-3 text-sm">
              {[
                ["Unzip it", "You get the workshop page and a second zip ending in _workshop.zip."],
                [
                  "Import the _workshop.zip into your workspace",
                  "Workspace → your folder → Import, the zip as-is. It holds the script that loads the starting data and the context (story + specs) that drives Genie Code.",
                ],
                ["Open workshop.html in your browser", "Follow the steps; each one is a prompt you paste into Genie Code."],
              ].map(([title, desc], i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-medium text-foreground">{title}</div>
                    <div className="text-muted-foreground">{desc}</div>
                  </div>
                </li>
              ))}
            </ol>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={downloading}>
                Cancel
              </Button>
              <Button onClick={handleDownload} disabled={downloading}>
                {downloading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Downloading…</>
                ) : (
                  <><Download className="mr-2 h-4 w-4" /> Download the kit</>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Download project</DialogTitle>
              <DialogDescription>
                This project doesn&rsquo;t have a Databricks Asset Bundle yet.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              <p>
                You can download the project as-is. But to <strong>redeploy it in another
                workspace</strong>, a Databricks Asset Bundle (<code>databricks.yml</code>) is far
                easier — one <code>databricks bundle deploy</code> recreates the schema, pipeline,
                dashboard, jobs, and app, and it ships with a <code>{INSTRUCTIONS_FILE}</code>{" "}
                runbook. Solution Builder can generate it for you.
              </p>
              {createFinishedNoDab && (
                <p className="mt-3 text-foreground">
                  It looks like no bundle was produced this time — check the discussion for
                  details, then try again or download as-is.
                </p>
              )}
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="outline" onClick={handleDownload} disabled={downloading}>
                {downloading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Downloading…</>
                ) : (
                  <><Download className="mr-2 h-4 w-4" /> Download as-is</>
                )}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={isStreaming}
                title={isStreaming ? "Wait for the current response to finish" : undefined}
              >
                <Package className="mr-2 h-4 w-4" /> Create a DAB
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

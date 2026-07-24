/**
 * ShareDialog — invite teammates to a project at a role (viewer/editor),
 * see/adjust existing shares, and revoke access. Owner-only surface.
 *
 * Used from the project workspace header and the Projects list page, so the
 * share UX stays identical in both places.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Share2, Trash2, Eye, Pencil, Check, AlertTriangle, Link2, Copy } from "lucide-react";
import {
  shareProject,
  updateProjectShare,
  listProjectShares,
  unshareProject,
  setProjectLinkAccess,
  type ProjectShareOut,
  type ShareRole,
  type LinkAccess,
} from "@/lib/custom-api";

interface ShareDialogProps {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current "anyone with the link" access (from the loaded project). */
  initialLinkAccess?: LinkAccess;
  /** The URL to share — a deep link (e.g. …?tab=architecture&archTab=…). Falls
   *  back to the project URL. Used by the canvas "Share live with others" entry. */
  linkUrl?: string;
  /** Notified when link access changes so the parent can update its project. */
  onLinkAccessChange?: (v: LinkAccess) => void;
}

const ROLE_OPTIONS: {
  value: ShareRole;
  icon: typeof Eye;
  title: string;
  desc: string;
}[] = [
  {
    value: "viewer",
    icon: Eye,
    title: "Viewer",
    desc: "Read-only. Can view and clone.",
  },
  {
    value: "editor",
    icon: Pencil,
    title: "Editor",
    desc: "Can edit files and run the agent.",
  },
];

export function ShareDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  initialLinkAccess = "none",
  linkUrl,
  onLinkAccessChange,
}: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shares, setShares] = useState<ProjectShareOut[]>([]);
  // "Anyone with the link" state.
  const [linkAccess, setLinkAccess] = useState<LinkAccess>(initialLinkAccess);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = linkUrl ||
    (typeof window !== "undefined" ? `${window.location.origin}/project/${projectId}` : "");

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setMessage("");
    setRole("viewer");
    setError(null);
    setLinkAccess(initialLinkAccess);
    setCopied(false);
    // Reset to empty first so the "Shared with" section doesn't briefly show a
    // previous project's shares while this load is in flight.
    setShares([]);
    listProjectShares(projectId)
      .then(setShares)
      .catch(() => setShares([]));
  }, [open, projectId, initialLinkAccess]);

  // Toggle / change "anyone with the link" access. Optimistic; reverts on error.
  const applyLinkAccess = async (next: LinkAccess) => {
    const prev = linkAccess;
    setLinkAccess(next);
    setLinkBusy(true);
    setError(null);
    try {
      await setProjectLinkAccess(projectId, next);
      onLinkAccessChange?.(next);
    } catch (err) {
      setLinkAccess(prev);
      setError(err instanceof Error ? err.message : "Failed to update link access");
    } finally {
      setLinkBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can select the field manually */ }
  };

  const handleShare = async () => {
    if (!email.trim()) return;
    setIsSharing(true);
    setError(null);
    try {
      const created = await shareProject(projectId, email.trim(), role, message.trim() || undefined);
      setShares((prev) => [...prev.filter((s) => s.id !== created.id), created]);
      setEmail("");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share project");
    } finally {
      setIsSharing(false);
    }
  };

  const handleChangeRole = async (shareId: number, newRole: ShareRole) => {
    setShares((prev) =>
      prev.map((s) => (s.id === shareId ? { ...s, role: newRole } : s))
    );
    try {
      await updateProjectShare(projectId, shareId, newRole);
    } catch {
      listProjectShares(projectId).then(setShares).catch(() => {});
    }
  };

  const handleUnshare = async (shareId: number) => {
    try {
      await unshareProject(projectId, shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch (err) {
      console.error("Failed to unshare:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Project
          </DialogTitle>
          <DialogDescription>
            Share &ldquo;{projectName}&rdquo; — with anyone who has the link, or invite a teammate by email.
          </DialogDescription>
        </DialogHeader>

        {/* Anyone with the link */}
        <div className="rounded-lg border border-border p-3 space-y-2.5">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={linkAccess !== "none"}
              disabled={linkBusy}
              onChange={(e) => applyLinkAccess(e.target.checked ? "editor" : "none")}
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Link2 className="h-3.5 w-3.5" /> Anyone with the link can access
                {linkBusy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">
                No invite needed — anyone signed in who opens the link joins live.
              </span>
            </span>
          </label>

          {linkAccess !== "none" && (
            <>
              {/* viewer/editor for link access */}
              <div className="flex items-center gap-2 pl-6">
                {(["viewer", "editor"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={linkBusy}
                    onClick={() => applyLinkAccess(v)}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] transition-colors ${
                      linkAccess === v ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {v === "viewer" ? <Eye className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                    {v === "viewer" ? "Can view" : "Can edit"}
                  </button>
                ))}
              </div>
              {/* copyable link */}
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[12px] text-muted-foreground focus:outline-none"
                />
                <Button type="button" variant="outline" size="sm" onClick={copyLink} className="shrink-0">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
                </Button>
              </div>
              {linkAccess === "editor" && (
                <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  <span>Anyone with the link can edit live. The agent runs as whoever holds the conversation.</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="relative py-0.5 text-center">
          <span className="bg-background px-2 text-[11px] uppercase tracking-wider text-muted-foreground">or invite by email</span>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="share-email" className="text-sm font-medium text-foreground">
              Email address
            </label>
            <input
              id="share-email"
              type="email"
              placeholder="colleague@databricks.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleShare();
              }}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            />
          </div>

          <div>
            <span className="text-sm font-medium text-foreground">Access level</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = role === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRole(opt.value)}
                    className={`text-left cursor-pointer rounded-lg border px-3 py-2 transition-colors ${
                      active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <Icon className="h-3.5 w-3.5" /> {opt.title}
                      {active && <Check className="h-3.5 w-3.5 ml-auto text-primary" />}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
            {role === "editor" && (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>
                  Concurrent edits are not yet supported and will create unexpected
                  behavior, with the AI switching identity during execution.
                </span>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="share-message" className="text-sm font-medium text-foreground">
              Message{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="share-message"
              type="text"
              placeholder="Check out this solution..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleShare();
              }}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={handleShare} disabled={!email.trim() || isSharing} className="w-full">
            {isSharing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sharing...
              </>
            ) : (
              "Share"
            )}
          </Button>
        </div>

        {shares.length > 0 && (
          <div className="border-t border-border pt-4 mt-2">
            <h4 className="text-sm font-medium text-foreground mb-2">Shared with</h4>
            <ul className="space-y-2">
              {shares.map((share) => (
                  <li key={share.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <span className="text-foreground truncate block">
                        {share.shared_with_email}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {share.status === "pending"
                          ? "Invitation pending"
                          : share.status === "declined"
                          ? "Declined"
                          : "Accepted"}
                      </span>
                    </div>
                    <select
                      value={share.role}
                      onChange={(e) => handleChangeRole(share.id, e.target.value as ShareRole)}
                      className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      title="Change access level"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                    <button
                      onClick={() => handleUnshare(share.id)}
                      className="cursor-pointer text-muted-foreground hover:text-destructive transition-colors p-1"
                      title="Remove access"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ShareDialog;

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
import { Loader2, Share2, Trash2, Eye, Pencil, Check } from "lucide-react";
import {
  shareProject,
  updateProjectShare,
  listProjectShares,
  unshareProject,
  type ProjectShareOut,
  type ShareRole,
} from "@/lib/custom-api";

interface ShareDialogProps {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
}: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shares, setShares] = useState<ProjectShareOut[]>([]);
  const [isLoadingShares, setIsLoadingShares] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setMessage("");
    setRole("viewer");
    setError(null);
    setIsLoadingShares(true);
    listProjectShares(projectId)
      .then(setShares)
      .catch(() => setShares([]))
      .finally(() => setIsLoadingShares(false));
  }, [open, projectId]);

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Share Project
          </DialogTitle>
          <DialogDescription>
            Share &ldquo;{projectName}&rdquo; with a teammate via their email.
          </DialogDescription>
        </DialogHeader>

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
                    className={`text-left rounded-lg border px-3 py-2 transition-colors ${
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

        {(shares.length > 0 || isLoadingShares) && (
          <div className="border-t border-border pt-4 mt-2">
            <h4 className="text-sm font-medium text-foreground mb-2">Shared with</h4>
            {isLoadingShares ? (
              <div className="flex items-center gap-2 text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading...</span>
              </div>
            ) : (
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
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      title="Remove access"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ShareDialog;

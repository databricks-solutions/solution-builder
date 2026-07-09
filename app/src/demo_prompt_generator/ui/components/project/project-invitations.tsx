/**
 * ProjectInvitations — the pending share-invitation banner.
 *
 * Self-contained: fetches the current user's pending invitations, renders an
 * Accept/Decline card per invite, and handles the response. Used on both the
 * home page (above Recent Projects) and the Projects list so the surface stays
 * identical. Renders nothing when there are no pending invitations.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mail, Check, Loader2 } from "lucide-react";
import {
  listShareInvitations,
  respondToShare,
  type ProjectShareOut,
} from "@/lib/custom-api";

/** "alice.smith@databricks.com" → "alice.smith". Keeps the card compact. */
function formatEmailShort(email: string): string {
  return email.split("@")[0] ?? email;
}

interface ProjectInvitationsProps {
  /** Controlled: when provided, the parent owns the list (e.g. home page loads
   *  it via one combined call). When omitted, the component self-fetches. */
  invitations?: ProjectShareOut[];
  /** Fired after a response so a controlled parent can drop the invite (and, on
   *  accept, refresh its "shared with me" list). */
  onResponded?: (projectId: string, accepted: boolean) => void;
  className?: string;
}

export function ProjectInvitations({
  invitations: invitationsProp,
  onResponded,
  className,
}: ProjectInvitationsProps) {
  const [selfInvites, setSelfInvites] = useState<ProjectShareOut[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const controlled = invitationsProp !== undefined;
  const invitations = controlled ? invitationsProp : selfInvites;

  useEffect(() => {
    if (controlled) return; // parent owns the data
    listShareInvitations()
      .then(setSelfInvites)
      .catch(() => setSelfInvites([]));
  }, [controlled]);

  const handleRespond = async (projectId: string, accept: boolean) => {
    setRespondingId(projectId);
    try {
      await respondToShare(projectId, accept);
      if (controlled) {
        onResponded?.(projectId, accept);
      } else {
        setSelfInvites((prev) => prev.filter((i) => i.project_id !== projectId));
      }
    } catch (err) {
      console.error("Failed to respond to invitation:", err);
    } finally {
      setRespondingId(null);
    }
  };

  if (invitations.length === 0) return null;

  return (
    <section className={className}>
      <div className="flex items-center gap-2 mb-3">
        <Mail className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Invitations</h2>
        <span className="text-xs text-muted-foreground">({invitations.length})</span>
      </div>
      <div className="space-y-2">
        {invitations.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {inv.project_name || "A project"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {formatEmailShort(inv.owner_email)} shared this with you as{" "}
                <span className="font-medium">
                  {inv.role === "editor" ? "an editor" : "a viewer"}
                </span>
                {inv.message ? ` — “${inv.message}”` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                disabled={respondingId === inv.project_id}
                onClick={() => handleRespond(inv.project_id, false)}
              >
                Decline
              </Button>
              <Button
                size="sm"
                disabled={respondingId === inv.project_id}
                onClick={() => handleRespond(inv.project_id, true)}
              >
                {respondingId === inv.project_id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5 mr-1" /> Accept
                  </>
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default ProjectInvitations;

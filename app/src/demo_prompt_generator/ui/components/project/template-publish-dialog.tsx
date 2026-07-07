/**
 * Template publish dialog — handles both new submission and update flows.
 *
 * Doubles as light enablement: a larger modal that explains WHAT publishing a
 * template does (share a proven demo → reviewed → teammates fork & adapt), with
 * a small animated flow so the value is obvious at a glance.
 */

import { memo, useState, useCallback } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Upload,
  FileEdit,
  Loader2,
  CheckCircle,
  FileText,
  AlertCircle,
  Layers,
  Library,
  Users,
} from "lucide-react";
import {
  submitTemplateFromProject,
  updateTemplateFromProject,
  type TemplateDetail,
} from "../../lib/custom-api";

interface TemplatePublishDialogProps {
  projectId: string;
  projectName: string;
  projectDescription: string | null;
  fileCount: number;
  linkedTemplate: TemplateDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmitted: (template: TemplateDetail) => void;
}

// One stage of the "how sharing works" flow illustration.
function FlowStage({
  icon: Icon,
  title,
  sub,
  delay,
  accent,
}: {
  icon: React.ElementType;
  title: string;
  sub: string;
  delay: number;
  accent?: boolean;
}) {
  return (
    <div
      className="flex-1 flex flex-col items-center text-center gap-2 animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${
          accent ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30" : "bg-primary/10 text-primary"
        }`}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="space-y-0.5">
        <p className="text-xs font-semibold leading-tight">{title}</p>
        <p className="text-[11px] text-muted-foreground leading-tight max-w-[9rem]">{sub}</p>
      </div>
    </div>
  );
}

// The animated connector between two stages — a track with a dot flowing L→R.
function FlowConnector({ delay }: { delay: number }) {
  return (
    <div className="relative h-px flex-1 mt-6 self-start min-w-8 bg-border/70">
      <span
        className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-primary animate-flow-dot"
        style={{ animationDelay: `${delay}ms` }}
      />
    </div>
  );
}

export const TemplatePublishDialog = memo(function TemplatePublishDialog({
  projectId,
  projectName,
  projectDescription,
  fileCount,
  linkedTemplate,
  isOpen,
  onClose,
  onSubmitted,
}: TemplatePublishDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitNew = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const template = await submitTemplateFromProject(projectId);
      setSubmitted(true);
      onSubmitted(template);
      setTimeout(() => {
        setSubmitted(false);
        onClose();
      }, 2500);
    } catch (err) {
      console.error("Failed to submit template:", err);
      setError(err instanceof Error ? err.message : "Failed to submit template");
    } finally {
      setIsSubmitting(false);
    }
  }, [projectId, isSubmitting, onSubmitted, onClose]);

  const handleUpdate = useCallback(async () => {
    if (isSubmitting || !linkedTemplate) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const updated = await updateTemplateFromProject(linkedTemplate.id, projectId);
      setSubmitted(true);
      onSubmitted(updated);
      setTimeout(() => {
        setSubmitted(false);
        onClose();
      }, 2500);
    } catch (err) {
      console.error("Failed to update template:", err);
      setError(err instanceof Error ? err.message : "Failed to update template");
    } finally {
      setIsSubmitting(false);
    }
  }, [projectId, linkedTemplate, isSubmitting, onSubmitted, onClose]);

  const isUpdate = !!linkedTemplate;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              {isUpdate ? (
                <FileEdit className="h-5 w-5 text-primary" />
              ) : (
                <Upload className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <DialogTitle>
                {isUpdate ? "Update template" : "Share as a template"}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {isUpdate
                  ? "Sync the published template with your current project files."
                  : "Turn this demo into a reusable starting point your team can clone and tailor — instead of building from a blank page."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Enablement: the animated "how sharing works" flow. */}
        <div className="rounded-xl border bg-muted/20 px-5 py-5">
          <div className="flex items-stretch justify-between gap-1">
            <FlowStage
              icon={Layers}
              title="Your demo"
              sub="Its story, architecture & specs"
              delay={0}
            />
            <FlowConnector delay={200} />
            <FlowStage
              icon={Library}
              title="Reviewed & published"
              sub="An admin approves it into the gallery"
              delay={150}
              accent
            />
            <FlowConnector delay={700} />
            <FlowStage
              icon={Users}
              title="Teammates fork & adapt"
              sub="They clone it and tailor it via the AI"
              delay={300}
            />
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Sharing spreads a proven solution — teammates start from your work,
            swap in their industry, data and capabilities, and ship faster.
          </p>
        </div>

        {/* What's actually captured + the template's identity. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Template Name
              </label>
              <p className="text-sm font-medium mt-0.5">{projectName}</p>
            </div>
            {projectDescription && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Description
                </label>
                <p className="text-sm text-foreground/80 mt-0.5 line-clamp-3">{projectDescription}</p>
              </div>
            )}
            {isUpdate && linkedTemplate && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Current Status
                </label>
                <div className="mt-0.5">
                  <Badge
                    variant={linkedTemplate.status === "APPROVED" ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {linkedTemplate.status === "REVIEW_REQUESTED" ? "Pending Review" : linkedTemplate.status.toLowerCase()}
                  </Badge>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card/40 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-primary/70" />
              <span className="text-sm font-medium">
                {fileCount} file{fileCount !== 1 ? "s" : ""} included
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The narrative, architecture and specs travel with the template.
              Code and live Databricks resources are regenerated fresh in each
              fork, so every clone stays clean.
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {isSubmitting && (
            <p className="text-xs text-muted-foreground mr-auto self-center">
              Analyzing content and generating summary...
            </p>
          )}
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={isUpdate ? handleUpdate : handleSubmitNew}
            disabled={isSubmitting || submitted || fileCount === 0}
            className="gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating template...
              </>
            ) : submitted ? (
              <>
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="font-medium">{isUpdate ? "Updated!" : "Submitted!"}</span>
              </>
            ) : (
              <>
                {isUpdate ? (
                  <FileEdit className="h-4 w-4" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {isUpdate ? "Update Template" : "Submit for Review"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default TemplatePublishDialog;

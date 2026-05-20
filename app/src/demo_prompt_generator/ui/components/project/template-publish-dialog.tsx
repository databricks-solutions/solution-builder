/**
 * Template publish dialog — handles both new submission and update flows.
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
import { Upload, FileEdit, Loader2, CheckCircle, FileText, AlertCircle } from "lucide-react";
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isUpdate ? "bg-primary/10" : "bg-primary/10"}`}>
              {isUpdate ? (
                <FileEdit className="h-5 w-5 text-primary" />
              ) : (
                <Upload className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <DialogTitle>
                {isUpdate ? "Update Template" : "Publish as Template"}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {isUpdate
                  ? "Sync the template with your current project files."
                  : "Make this solution available for others to clone and customize."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {/* Template info */}
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
                <p className="text-sm text-foreground/80 mt-0.5">{projectDescription}</p>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Files Included
              </label>
              <div className="flex items-center gap-1.5 mt-0.5">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{fileCount} file{fileCount !== 1 ? "s" : ""}</span>
              </div>
            </div>

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

/**
 * Modal for editing a project's description.
 *
 * Two ways to edit: type into the textarea directly, or give a free-form
 * instruction to the mini LLM ("make it shorter", "add ROI angle", etc.)
 * and let it rewrite the textarea contents. The user always reviews before
 * saving — the AI assist never auto-commits.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, AlertCircle, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { aiEditProjectDescription } from "@/lib/custom-api";

interface DescriptionEditDialogProps {
  projectId: string;
  isOpen: boolean;
  initialDescription: string;
  onClose: () => void;
  onSave: (description: string) => Promise<void> | void;
}

export const DescriptionEditDialog = memo(function DescriptionEditDialog({
  projectId,
  isOpen,
  initialDescription,
  onClose,
  onSave,
}: DescriptionEditDialogProps) {
  const [description, setDescription] = useState(initialDescription);
  const [instruction, setInstruction] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Snapshot of the description as it was *before* the most recent AI edit,
  // so a user can undo the suggestion in one click without losing manual
  // tweaks they made before invoking the AI.
  const [preAiDescription, setPreAiDescription] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset state every time the dialog reopens — the parent owns the source
  // of truth for the saved description.
  useEffect(() => {
    if (isOpen) {
      setDescription(initialDescription);
      setInstruction("");
      setError(null);
      setPreAiDescription(null);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, initialDescription]);

  const handleAiEdit = useCallback(async () => {
    const trimmed = instruction.trim();
    if (!trimmed || isAiLoading) return;
    setIsAiLoading(true);
    setError(null);
    try {
      const result = await aiEditProjectDescription(
        projectId,
        description,
        trimmed,
      );
      setPreAiDescription(description);
      setDescription(result.description);
      setInstruction("");
    } catch (err) {
      console.error("AI description edit failed:", err);
      setError(err instanceof Error ? err.message : "AI edit failed");
    } finally {
      setIsAiLoading(false);
    }
  }, [projectId, description, instruction, isAiLoading]);

  const handleUndoAi = useCallback(() => {
    if (preAiDescription === null) return;
    setDescription(preAiDescription);
    setPreAiDescription(null);
  }, [preAiDescription]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSave(description.trim());
      onClose();
    } catch (err) {
      console.error("Save description failed:", err);
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [description, isSaving, onClose, onSave]);

  const handleInstructionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleAiEdit();
      }
    },
    [handleAiEdit],
  );

  const isBusy = isAiLoading || isSaving;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isBusy && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Edit description</DialogTitle>
          <DialogDescription>
            Update the description manually, or ask the AI to rewrite it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label
              htmlFor="project-description"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
            >
              Description
            </label>
            <Textarea
              id="project-description"
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this demo shows, who it's for, and the key Databricks capabilities involved."
              className="min-h-[140px] resize-y text-sm"
              disabled={isBusy}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{description.length} characters</span>
              {preAiDescription !== null && (
                <button
                  type="button"
                  onClick={handleUndoAi}
                  className="flex items-center gap-1 text-primary hover:underline"
                  disabled={isBusy}
                >
                  <Undo2 className="h-3 w-3" />
                  Undo AI edit
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
            <label
              htmlFor="ai-instruction"
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              AI assist
            </label>
            <div className="flex gap-2">
              <Input
                id="ai-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={handleInstructionKeyDown}
                placeholder="e.g. make it shorter, rewrite for executives, add ROI angle"
                className="h-9 text-sm"
                disabled={isBusy}
              />
              <Button
                type="button"
                onClick={handleAiEdit}
                disabled={isBusy || !instruction.trim()}
                className="h-9 gap-1.5"
              >
                {isAiLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Rewriting...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Rewrite
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The suggestion replaces the textarea — review before saving.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isBusy}>
            {isSaving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export default DescriptionEditDialog;

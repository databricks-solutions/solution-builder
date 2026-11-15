/**
 * Deploy-target control (Tier-2 "scale" feature) — the account-level
 * cross-workspace deploy target the user sets once; it applies to every
 * solution they build.
 *
 * PORTABLE + SELF-CONTAINED by design. It loads its own settings, owns the
 * validate → save flow, and renders:
 *   • collapsed: a muted one-liner ("Deploying to …") + Edit/Open, OR
 *   • open: the editor — paste a workspace URL + validation verdict.
 *
 * The parent decides WHERE to mount it (inline under the composer today; a
 * redesign can drop it into an "advanced options" popup) — this component makes
 * no assumption about its container. When the whole feature is off
 * (`cross_workspace_deploy_enabled` false, e.g. a generic Tier-1 build) it
 * renders nothing.
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pointer, Pencil, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getMySettings,
  updateMySettings,
  validateMyTarget,
  type UserSettings,
  type TargetValidation,
} from "@/lib/custom-api";

function shortHostName(host: string): string {
  return host
    .replace(/^https?:\/\//, "")
    .replace(/\.cloud\.databricks\.com\/?$/, "")
    .replace(/\/$/, "");
}

export function DeployTargetControl() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [targetEditorOpen, setTargetEditorOpen] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);
  const [validatingTarget, setValidatingTarget] = useState(false);
  const [targetValidation, setTargetValidation] = useState<TargetValidation | null>(null);

  useEffect(() => {
    getMySettings()
      .then(setSettings)
      .catch(() => {
        /* Non-fatal — the control just doesn't render its current value. */
      });
  }, []);

  const openTargetEditor = useCallback(() => {
    setTargetInput(
      settings?.target_workspace_host ?? settings?.effective_target_workspace_host ?? "",
    );
    setTargetValidation(null);
    setTargetEditorOpen(true);
  }, [settings]);

  // Paste-URL Save: validate then persist.
  const saveTarget = useCallback(async () => {
    const host = targetInput.trim();
    if (!host) {
      setSavingTarget(true);
      try {
        const updated = await updateMySettings(null);
        setSettings(updated);
        setTargetEditorOpen(false);
        setTargetValidation(null);
      } catch (e) {
        console.error("Failed to clear deploy target", e);
      } finally {
        setSavingTarget(false);
      }
      return;
    }
    setValidatingTarget(true);
    setTargetValidation(null);
    try {
      const verdict = await validateMyTarget(host);
      setValidatingTarget(false);
      setTargetValidation(verdict);
      if (!verdict.can_deploy) return; // keep editor open so the user can fix it
      setSavingTarget(true);
      const updated = await updateMySettings(host);
      setSettings(updated);
      setTargetEditorOpen(false);
      setTargetValidation(null);
    } catch (e) {
      setValidatingTarget(false);
      console.error("Failed to save deploy target", e);
    } finally {
      setSavingTarget(false);
    }
  }, [targetInput]);

  // Whole feature off (generic Tier-1 build / no deployer SP) → render nothing.
  if (settings && settings.cross_workspace_deploy_enabled === false) return null;

  return (
    <>
      {/* Collapsed one-liner. */}
      {!targetEditorOpen &&
        (() => {
          const openHost =
            settings?.target_workspace_host ||
            settings?.effective_target_workspace_host ||
            null;
          const onCustomWorkspace =
            !!settings?.target_workspace_host &&
            settings.target_workspace_host !== settings.default_target_workspace_host;
          return (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Pointer className="size-3 shrink-0" />
              <span>
                {onCustomWorkspace ? (
                  <>
                    Deploying to your workspace{" "}
                    <span className="font-medium text-foreground">
                      {shortHostName(settings!.target_workspace_host!)}
                    </span>
                  </>
                ) : (
                  "Deploying to the shared default workspace"
                )}
              </span>
              <button
                type="button"
                onClick={openTargetEditor}
                title="Change target workspace"
                className="inline-flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-muted hover:text-foreground transition-colors"
              >
                <Pencil className="size-3" />
                Edit
              </button>
              {openHost && (
                <a
                  href={openHost}
                  target="_blank"
                  rel="noreferrer"
                  title="Open workspace home"
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-muted hover:text-foreground transition-colors"
                >
                  <ExternalLink className="size-3" />
                  Open
                </a>
              )}
            </div>
          );
        })()}

      {/* Expanded editor — paste a workspace URL + Save. */}
      {targetEditorOpen && (
        <div className="text-xs text-muted-foreground">
          <div className="space-y-1.5 rounded-md border border-border bg-background/60 p-3">
            <div className="flex items-center gap-2">
              <Input
                value={targetInput}
                onChange={(e) => {
                  setTargetInput(e.target.value);
                  setTargetValidation(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveTarget();
                }}
                placeholder="https://your-workspace.cloud.databricks.com (blank = shared default)"
                className="h-8 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void saveTarget()}
                disabled={savingTarget}
              >
                {validatingTarget ? "Checking…" : savingTarget ? "Saving…" : "Save"}
              </Button>
            </div>

            {/* Validation verdict. */}
            {targetValidation && (
              <div
                className={cn(
                  "rounded-md border px-3 py-2 text-xs space-y-1",
                  targetValidation.can_deploy
                    ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
                    : targetValidation.status === "needs_admin"
                      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      : "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
                )}
              >
                <div className="font-medium">
                  {targetValidation.can_deploy
                    ? `✓ Ready — deploys into ${targetValidation.catalog} (${targetValidation.region})`
                    : targetValidation.status === "needs_admin"
                      ? "⚠ Deployer SP needs workspace-admin access"
                      : "✗ Can't deploy here"}
                </div>
                <div>{targetValidation.message}</div>
                {targetValidation.status === "needs_admin" && (
                  <div className="space-y-1.5 pt-0.5">
                    {targetValidation.admin_settings_url && (
                      <a
                        href={targetValidation.admin_settings_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block font-medium underline underline-offset-2 hover:no-underline"
                      >
                        Open this workspace's Service Principals settings ↗
                      </a>
                    )}
                    {targetValidation.deployer_sp_application_id && (
                      <div className="flex items-center gap-1.5">
                        <span className="opacity-80">Add this service principal:</span>
                        <code className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono text-[11px]">
                          {targetValidation.deployer_sp_application_id}
                        </code>
                        <button
                          type="button"
                          onClick={() =>
                            navigator.clipboard?.writeText(
                              targetValidation.deployer_sp_application_id || "",
                            )
                          }
                          className="underline underline-offset-2 hover:no-underline"
                          title="Copy application ID"
                        >
                          copy
                        </button>
                        <span className="opacity-70">
                          ({targetValidation.deployer_sp_name}) — grant it the Admin role,
                          then re-select the workspace.
                        </span>
                      </div>
                    )}
                    <div className="opacity-70">
                      Note: you must already be a workspace admin on this workspace to add
                      the service principal.
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Applies to every solution you build.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

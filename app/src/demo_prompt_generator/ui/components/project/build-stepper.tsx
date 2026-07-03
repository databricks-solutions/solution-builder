/**
 * Build pipeline stepper — visual indicator of project progress.
 *
 * Auto-detects the current stage from files:
 * DRAFTING → SUMMARIZED → ARCHITECTED → SPECIFICATION → BUILT → BUNDLED
 *
 * Includes an action dropdown for stage-specific operations.
 */

import { useMemo } from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Check,
  Circle,
  Loader2,
  FileText,
  Network,
  Hammer,
  Rocket,
  Download,
  Upload,
  ChevronDown,
  Play,
  RefreshCw,
} from "lucide-react";
import {
  type ProjectStage,
  type ProjectFile,
} from "../../lib/custom-api";

// ---------------------------------------------------------------------------
// Stage metadata
// ---------------------------------------------------------------------------

// Per-stage validation checks surfaced in tooltips on the top stepper.
// The 6-state ProjectStage enum is kept as the backend source of truth;
// the UI collapses to 4 lifecycle stages via getLifecycleStages() below.
interface StageCheck {
  label: string;
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Stage detection from files
// ---------------------------------------------------------------------------

const MIN_README_CHARS = 200;

export interface StageInfo {
  stage: ProjectStage;
  checks: Record<ProjectStage, StageCheck[]>;
  hasReadme: boolean;
  hasArch: boolean;
  hasSpecifications: boolean;
  hasCode: boolean;
  hasDeployedResources: boolean;
  hasDab: boolean;
}

export function detectStageFromFiles(
  files: ProjectFile[],
  deployedResourceCount = 0,
): StageInfo {
  const paths = files.map((f) => f.path);
  const fileMap = new Map(files.map((f) => [f.path, f]));

  // Compute all checks
  const readme = fileMap.get("README.md");
  const hasReadme = !!readme && readme.size >= MIN_README_CHARS;
  const hasArch = fileMap.has("architecture.md");
  const hasSpecifications = paths.some((p) => p.startsWith("specifications/"));
  const hasCode = paths.some(
    (p) => (p.endsWith(".py") || p.endsWith(".sql")) && !p.startsWith("src/deploy/")
  );
  // BUILT now means resources are actually live in the workspace (visible
  // in the deployed-resources bar), not merely that code files exist on disk.
  const hasDeployedResources = deployedResourceCount > 0;
  const hasDab = fileMap.has("databricks.yml");

  const checks: Record<ProjectStage, StageCheck[]> = {
    DRAFTING: [],
    SUMMARIZED: [
      { label: "README.md exists (>200 chars)", passed: hasReadme },
    ],
    ARCHITECTED: [
      { label: "README.md exists", passed: hasReadme },
      { label: "architecture.md exists", passed: hasArch },
    ],
    SPECIFICATION: [
      { label: "README.md exists", passed: hasReadme },
      { label: "architecture.md exists", passed: hasArch },
      { label: "specifications/*.md files exist", passed: hasSpecifications },
    ],
    BUILT: [
      { label: "specifications/*.md files exist", passed: hasSpecifications },
      { label: "Code files (.py or .sql) exist", passed: hasCode },
      { label: "Resources deployed to workspace", passed: hasDeployedResources },
    ],
    BUNDLED: [
      { label: "Resources deployed to workspace", passed: hasDeployedResources },
      { label: "databricks.yml exists", passed: hasDab },
    ],
  };

  // Determine current stage (most advanced that's reached). BUILT now
  // requires actually-deployed resources, not just code on disk — code
  // alone keeps the project in SPECIFICATION.
  let stage: ProjectStage = "DRAFTING";
  if (hasDab) {
    stage = "BUNDLED";
  } else if (hasDeployedResources) {
    stage = "BUILT";
  } else if (hasSpecifications) {
    stage = "SPECIFICATION";
  } else if (hasArch) {
    stage = "ARCHITECTED";
  } else if (hasReadme) {
    stage = "SUMMARIZED";
  }

  return { stage, checks, hasReadme, hasArch, hasSpecifications, hasCode, hasDeployedResources, hasDab };
}

// ---------------------------------------------------------------------------
// Lifecycle stages — user-facing 4-state collapse of the backend 6-state
// ProjectStage. Both the top stepper and the "AI is working" panel render
// from this. Keeps the backend ProjectStage enum untouched (the DB column
// stays 6-state); the UI just groups them.
//
//   STORY_AND_ARCH  ← DRAFTING + SUMMARIZED + ARCHITECTED
//   SPECIFICATION   ← SPECIFICATION
//   RESOURCES       ← BUILT (strict: all expected resources deployed)
//   DAB             ← BUNDLED
// ---------------------------------------------------------------------------

export type LifecycleStageKey =
  | "STORY_AND_ARCH"
  | "SPECIFICATION"
  | "RESOURCES"
  | "DAB";

export type LifecycleStageStatus = "pending" | "active" | "done";

export interface LifecycleStageInfo {
  key: LifecycleStageKey;
  label: string;
  shortLabel: string;
  blurb: string;
  status: LifecycleStageStatus;
}

/** Derive the 4-state lifecycle view from the file-level stage info.
 *
 *  Active = the first not-yet-done stage. Done = its completion gate is met.
 *  RESOURCES uses the strict gate (all expected resources live), not just
 *  "any resource live" — the user-facing tile should mean *all* resources,
 *  per spec.
 *
 *  @param info         Output of detectStageFromFiles
 *  @param expectedRes  Total resources the project plans to build (from
 *                      capabilities.buildable). When 0 or unknown, RESOURCES
 *                      falls back to the lenient gate (any resource live).
 */
export function getLifecycleStages(
  info: StageInfo,
  liveResourceCount: number,
  expectedResourceCount: number,
): LifecycleStageInfo[] {
  const storyArchDone = info.hasReadme && info.hasArch;
  const specDone = info.hasSpecifications;
  const resourcesDone =
    expectedResourceCount > 0
      ? liveResourceCount >= expectedResourceCount
      : info.hasDeployedResources;
  const dabDone = info.hasDab;

  // First not-done stage is active. Cascade so we never show two active.
  let activeKey: LifecycleStageKey | null = null;
  if (!storyArchDone) activeKey = "STORY_AND_ARCH";
  else if (!specDone) activeKey = "SPECIFICATION";
  else if (!resourcesDone) activeKey = "RESOURCES";
  else if (!dabDone) activeKey = "DAB";

  const status = (
    key: LifecycleStageKey,
    done: boolean,
  ): LifecycleStageStatus =>
    done ? "done" : activeKey === key ? "active" : "pending";

  return [
    {
      key: "STORY_AND_ARCH",
      label: "Story & Architecture",
      shortLabel: "Story",
      blurb: "Customer narrative, pitch, and architecture diagram.",
      status: status("STORY_AND_ARCH", storyArchDone),
    },
    {
      key: "SPECIFICATION",
      label: "Specifications",
      shortLabel: "Spec",
      blurb: "Detailed plans for each resource.",
      status: status("SPECIFICATION", specDone),
    },
    {
      key: "RESOURCES",
      label: "Resources",
      shortLabel: "Build",
      blurb: "Databricks resources live in your workspace.",
      status: status("RESOURCES", resourcesDone),
    },
    {
      key: "DAB",
      label: "Bundle",
      shortLabel: "DAB",
      blurb: "Packaged for repeatable deployment.",
      status: status("DAB", dabDone),
    },
  ];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BuildStepperProps {
  isStreaming: boolean;
  /** Project files — used to auto-detect current stage */
  files: ProjectFile[];
  /** Count of resources currently deployed and visible in the resources bar.
   *  Drives the RESOURCES lifecycle pill (combined with expectedResourceCount). */
  deployedResourceCount?: number;
  /** Total resources the project plans to build (buildable capability count).
   *  RESOURCES is "done" only when `deployedResourceCount >= expectedResourceCount`.
   *  When 0/unknown, falls back to "any resource live". */
  expectedResourceCount?: number;
  /** Callbacks for stage actions */
  onCreateArchitecture?: () => void;
  onUpdateArchitecture?: () => void;
  /** Architecture-first project awaiting its build: when set, the stepper's
   *  primary action is "Build the solution for this architecture" (opens the
   *  story/capabilities dialog) and the downstream create-actions are hidden
   *  until the build kicks off. */
  onBuildSolution?: () => void;
  onCreateSpec?: () => void;
  onUpdateSpec?: () => void;
  onBuildResources?: () => void;
  onUpdateResources?: () => void;
  onPackageDAB?: () => void;
  onUpdateDAB?: () => void;
  onDownloadDAB?: () => void;
  onPublishTemplate?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BuildStepper({
  isStreaming,
  files,
  deployedResourceCount = 0,
  expectedResourceCount = 0,
  onCreateArchitecture,
  onUpdateArchitecture,
  onBuildSolution,
  onCreateSpec,
  onUpdateSpec,
  onBuildResources,
  onUpdateResources,
  onPackageDAB,
  onUpdateDAB,
  onDownloadDAB,
  onPublishTemplate,
}: BuildStepperProps) {
  // Auto-detect stage from files + live deploy state. The 6-state result
  // drives action-button logic (which "next step" button to surface);
  // the rendered pills below collapse to 4 lifecycle stages.
  const stageInfo = useMemo(
    () => detectStageFromFiles(files, deployedResourceCount),
    [files, deployedResourceCount],
  );
  const { hasReadme, hasArch, hasSpecifications, hasCode, hasDab } = stageInfo;
  const lifecycle = useMemo(
    () =>
      getLifecycleStages(stageInfo, deployedResourceCount, expectedResourceCount),
    [stageInfo, deployedResourceCount, expectedResourceCount],
  );

  // Build the list of available actions based on current state
  const actions: Array<{
    label: string;
    icon: React.ElementType;
    onClick: () => void;
    variant?: "default" | "primary";
  }> = [];

  // Architecture-first: the ONLY sensible next steps are building the solution
  // from the diagram (primary) or updating the diagram — the downstream
  // create-actions (specs, resources) only make sense once the build ran.
  if (onBuildSolution) {
    actions.push({
      label: "Build the solution for this architecture",
      icon: Rocket,
      onClick: onBuildSolution,
      variant: "primary",
    });
    if (hasArch && onUpdateArchitecture) {
      actions.push({
        label: "Update Architecture Diagram",
        icon: Network,
        onClick: onUpdateArchitecture,
      });
    }
  }

  // Architecture actions
  if (!onBuildSolution && !hasArch && onCreateArchitecture) {
    actions.push({
      label: "Create Architecture Diagram",
      icon: Network,
      onClick: onCreateArchitecture,
      variant: "primary",
    });
  } else if (!onBuildSolution && hasArch && onUpdateArchitecture) {
    actions.push({
      label: "Update Architecture Diagram",
      icon: Network,
      onClick: onUpdateArchitecture,
    });
  }

  // Specification actions
  if (!onBuildSolution && !hasSpecifications && onCreateSpec) {
    actions.push({
      label: "Create Specifications",
      icon: FileText,
      onClick: onCreateSpec,
      variant: !hasArch ? undefined : "primary",
    });
  } else if (!onBuildSolution && hasSpecifications && onUpdateSpec) {
    actions.push({
      label: "Update Specifications",
      icon: FileText,
      onClick: onUpdateSpec,
    });
  }

  // Build actions
  if (!hasCode && onBuildResources) {
    actions.push({
      label: "Build Databricks Resources",
      icon: Hammer,
      onClick: onBuildResources,
      variant: !hasSpecifications ? undefined : "primary",
    });
  } else if (hasCode && onUpdateResources) {
    actions.push({
      label: "Update Resources",
      icon: Hammer,
      onClick: onUpdateResources,
    });
  }

  // DAB actions
  if (!hasDab && onPackageDAB) {
    actions.push({
      label: "Package as DAB",
      icon: Rocket,
      onClick: onPackageDAB,
      variant: !hasCode ? undefined : "primary",
    });
  } else if (hasDab && onUpdateDAB) {
    actions.push({
      label: "Update DAB",
      icon: Rocket,
      onClick: onUpdateDAB,
    });
  }

  // If all stages are done, make Download ZIP the primary action
  const allDone = hasReadme && hasArch && hasSpecifications && hasCode;
  if (allDone && onDownloadDAB) {
    actions.push({
      label: "Download ZIP",
      icon: Download,
      onClick: onDownloadDAB,
      variant: "primary",
    });
  }

  // Find the primary action (next step to do)
  const primaryAction = actions.find((a) => a.variant === "primary") || actions[0];

  // Icon per lifecycle stage. Story+Arch uses Network (architecture beats
  // out story alone visually); Resources uses Hammer; DAB uses Rocket.
  const LIFECYCLE_ICONS: Record<LifecycleStageKey, React.ElementType> = {
    STORY_AND_ARCH: Network,
    SPECIFICATION: FileText,
    RESOURCES: Hammer,
    DAB: Rocket,
  };

  return (
    <div className="flex items-center gap-3">
      {/* Stepper pills — 4 collapsed lifecycle stages. HIDDEN while the
          project is architecture-first (onBuildSolution set): the pipeline
          hasn't started yet, so the pills read as noise next to the single
          "Build the solution" CTA. They come back once the build kicks off. */}
      {!onBuildSolution && (
      <div className="flex items-center gap-1">
        <TooltipProvider delayDuration={200}>
          {lifecycle.map((s, idx) => {
            const Icon = LIFECYCLE_ICONS[s.key];
            const isCompleted = s.status === "done";
            const isCurrent = s.status === "active";
            // "Next" connector pulse: the segment leading INTO the active
            // stage from the previous one shows the rolling primary fill.
            const isNextConnector =
              idx > 0 && lifecycle[idx - 1].status === "done" && isCurrent;

            return (
              <div key={s.key} className="flex items-center">
                {idx > 0 && (
                  <div className="relative h-0.5 w-4 sm:w-7 mx-0.5 rounded-full overflow-hidden">
                    <div className={`absolute inset-0 ${
                      isCompleted || isCurrent ? "bg-primary" : "bg-border"
                    }`} />
                    {isNextConnector && (
                      <div className="absolute inset-0">
                        <div className="absolute inset-y-0 left-0 bg-primary animate-progress-pulse" />
                      </div>
                    )}
                  </div>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        isCompleted
                          ? "bg-primary/10 text-primary border-primary/20"
                          : isCurrent
                            ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                            : "bg-muted/60 text-muted-foreground/70 border-border"
                      }`}
                    >
                      {isCompleted ? (
                        <Check className="h-3 w-3" />
                      ) : isCurrent ? (
                        <Icon className="h-3 w-3" />
                      ) : (
                        <Circle className="h-3 w-3" />
                      )}
                      <span className="hidden sm:inline">{s.shortLabel}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="p-3 bg-slate-900 border-slate-700">
                    <p className="font-semibold text-white mb-1">{s.label}</p>
                    <p className="text-sm text-white/80">{s.blurb}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </TooltipProvider>
      </div>
      )}

      {/* Action button group: main button + dropdown for more options */}
      {isStreaming ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="hidden sm:inline">Working...</span>
        </div>
      ) : actions.length > 0 ? (
        <div className="flex items-center">
          {/* Main action button - clicking executes primary action directly */}
          {primaryAction && (
            <Button
              variant={primaryAction.variant === "primary" ? "default" : "outline"}
              className="h-9 gap-2 px-4 text-sm rounded-r-none border-r-0 cursor-pointer whitespace-nowrap"
              onClick={primaryAction.onClick}
            >
              {primaryAction.variant === "primary" ? (
                <Play className="h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {primaryAction.label}
            </Button>
          )}
          {/* Dropdown trigger for additional actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={primaryAction?.variant === "primary" ? "default" : "outline"}
                className="h-9 px-2 rounded-l-none cursor-pointer"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {actions.map((action, idx) => {
                const ActionIcon = action.icon;
                return (
                  <DropdownMenuItem
                    key={idx}
                    onClick={action.onClick}
                    className={`cursor-pointer ${action.variant === "primary" ? "font-medium" : ""}`}
                  >
                    <ActionIcon className="h-4 w-4 mr-2" />
                    {action.label}
                    {action.variant === "primary" && (
                      <span className="ml-auto text-[10px] text-muted-foreground">Next</span>
                    )}
                  </DropdownMenuItem>
                );
              })}

              {/* Download (when not already primary) and Publish */}
              {((!allDone && onDownloadDAB) || onPublishTemplate) && (
                <>
                  <DropdownMenuSeparator />
                  {!allDone && onDownloadDAB && (
                    <DropdownMenuItem onClick={onDownloadDAB} className="cursor-pointer">
                      <Download className="h-4 w-4 mr-2" />
                      Download ZIP
                    </DropdownMenuItem>
                  )}
                  {onPublishTemplate && (
                    <DropdownMenuItem onClick={onPublishTemplate} className="cursor-pointer">
                      <Upload className="h-4 w-4 mr-2" />
                      Publish as Template
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}

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
  CheckCircle2,
  XCircle,
  ChevronDown,
  Play,
  RefreshCw,
} from "lucide-react";
import {
  type ProjectStage,
  type ProjectFile,
  PROJECT_STAGES,
} from "../../lib/custom-api";

// ---------------------------------------------------------------------------
// Stage metadata
// ---------------------------------------------------------------------------

interface StageMeta {
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  description: string;
}

interface StageCheck {
  label: string;
  passed: boolean;
}

const STAGE_META: Record<ProjectStage, StageMeta> = {
  DRAFTING: {
    label: "Draft",
    shortLabel: "Draft",
    icon: FileText,
    description: "Create your demo story via chat",
  },
  SUMMARIZED: {
    label: "Summary",
    shortLabel: "Summary",
    icon: FileText,
    description: "README.md with demo narrative",
  },
  ARCHITECTED: {
    label: "Architecture",
    shortLabel: "Arch",
    icon: Network,
    description: "architecture.md diagram",
  },
  SPECIFICATION: {
    label: "Specification",
    shortLabel: "Spec",
    icon: FileText,
    description: "instructions/*.md files",
  },
  BUILT: {
    label: "Built",
    shortLabel: "Built",
    icon: Hammer,
    description: ".py/.sql code files",
  },
  BUNDLED: {
    label: "Bundle",
    shortLabel: "DAB",
    icon: Rocket,
    description: "databricks.yml bundle",
  },
};

// ---------------------------------------------------------------------------
// Stage detection from files
// ---------------------------------------------------------------------------

const MIN_README_CHARS = 200;

export interface StageInfo {
  stage: ProjectStage;
  checks: Record<ProjectStage, StageCheck[]>;
  hasReadme: boolean;
  hasArch: boolean;
  hasInstructions: boolean;
  hasCode: boolean;
  hasDab: boolean;
}

export function detectStageFromFiles(files: ProjectFile[]): StageInfo {
  const paths = files.map((f) => f.path);
  const fileMap = new Map(files.map((f) => [f.path, f]));

  // Compute all checks
  const readme = fileMap.get("README.md");
  const hasReadme = !!readme && readme.size >= MIN_README_CHARS;
  const hasArch = fileMap.has("architecture.md");
  const hasInstructions = paths.some((p) => p.startsWith("instructions/"));
  const hasCode = paths.some(
    (p) => (p.endsWith(".py") || p.endsWith(".sql")) && !p.startsWith("src/deploy/")
  );
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
      { label: "instructions/*.md files exist", passed: hasInstructions },
    ],
    BUILT: [
      { label: "instructions/*.md files exist", passed: hasInstructions },
      { label: "Code files (.py or .sql) exist", passed: hasCode },
    ],
    BUNDLED: [
      { label: "Code files (.py or .sql) exist", passed: hasCode },
      { label: "databricks.yml exists", passed: hasDab },
    ],
  };

  // Determine current stage (most advanced that's reached)
  let stage: ProjectStage = "DRAFTING";
  if (hasDab) {
    stage = "BUNDLED";
  } else if (hasCode) {
    stage = "BUILT";
  } else if (hasInstructions) {
    stage = "SPECIFICATION";
  } else if (hasArch) {
    stage = "ARCHITECTED";
  } else if (hasReadme) {
    stage = "SUMMARIZED";
  }

  return { stage, checks, hasReadme, hasArch, hasInstructions, hasCode, hasDab };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BuildStepperProps {
  isStreaming: boolean;
  /** Project files — used to auto-detect current stage */
  files: ProjectFile[];
  /** Callbacks for stage actions */
  onCreateArchitecture?: () => void;
  onUpdateArchitecture?: () => void;
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
  onCreateArchitecture,
  onUpdateArchitecture,
  onCreateSpec,
  onUpdateSpec,
  onBuildResources,
  onUpdateResources,
  onPackageDAB,
  onUpdateDAB,
  onDownloadDAB,
  onPublishTemplate,
}: BuildStepperProps) {
  // Auto-detect stage from files
  const stageInfo = useMemo(() => detectStageFromFiles(files), [files]);
  const { stage: currentStage, checks, hasArch, hasInstructions, hasCode, hasDab } = stageInfo;
  const currentIdx = PROJECT_STAGES.indexOf(currentStage);

  // Build the list of available actions based on current state
  const actions: Array<{
    label: string;
    icon: React.ElementType;
    onClick: () => void;
    variant?: "default" | "primary";
  }> = [];

  // Architecture actions
  if (!hasArch && onCreateArchitecture) {
    actions.push({
      label: "Create Architecture Diagram",
      icon: Network,
      onClick: onCreateArchitecture,
      variant: "primary",
    });
  } else if (hasArch && onUpdateArchitecture) {
    actions.push({
      label: "Update Architecture Diagram",
      icon: Network,
      onClick: onUpdateArchitecture,
    });
  }

  // Specification actions
  if (!hasInstructions && onCreateSpec) {
    actions.push({
      label: "Create Specifications",
      icon: FileText,
      onClick: onCreateSpec,
      variant: !hasArch ? undefined : "primary",
    });
  } else if (hasInstructions && onUpdateSpec) {
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
      variant: !hasInstructions ? undefined : "primary",
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

  // Find the primary action (next step to do)
  const primaryAction = actions.find((a) => a.variant === "primary") || actions[0];

  return (
    <div className="flex items-center gap-3">
      {/* Stepper dots */}
      <div className="flex items-center gap-1">
        <TooltipProvider delayDuration={200}>
          {PROJECT_STAGES.map((stage, idx) => {
            const meta = STAGE_META[stage];
            const Icon = meta.icon;

            const isCompleted = idx < currentIdx;
            const isCurrent = idx === currentIdx;
            const isNext = idx === currentIdx + 1;

            return (
              <div key={stage} className="flex items-center">
                {idx > 0 && (
                  <div className="relative h-px w-3 sm:w-6 mx-0.5">
                    <div className={`absolute inset-0 ${
                      isCompleted || isCurrent ? "bg-primary" : "bg-border"
                    }`} />
                    {isNext && (
                      <div className="absolute inset-0 overflow-hidden">
                        <div className="absolute inset-y-0 left-0 bg-primary animate-progress-pulse" />
                      </div>
                    )}
                  </div>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                        isCompleted
                          ? "bg-primary/10 text-primary"
                          : isCurrent
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground/50"
                      }`}
                    >
                      {isCompleted ? (
                        <Check className="h-2.5 w-2.5" />
                      ) : isCurrent ? (
                        <Icon className="h-2.5 w-2.5" />
                      ) : (
                        <Circle className="h-2.5 w-2.5" />
                      )}
                      <span className="hidden sm:inline">{meta.shortLabel}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="p-3 bg-slate-900 border-slate-700">
                    <p className="font-semibold text-white mb-1">{meta.label}</p>
                    {checks[stage].length > 0 ? (
                      <ul className="space-y-1">
                        {checks[stage].map((check, i) => (
                          <li key={i} className="flex items-center gap-2 text-sm">
                            {check.passed ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                            )}
                            <span className="text-white">{check.label}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-white/80">{meta.description}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </TooltipProvider>
      </div>

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

              {/* Download/Publish when bundled */}
              {hasDab && (onDownloadDAB || onPublishTemplate) && (
                <>
                  <DropdownMenuSeparator />
                  {onDownloadDAB && (
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

/**
 * Build pipeline stepper — guides users through the project lifecycle.
 *
 * Shows a horizontal progress indicator with stage-aware actions:
 * DRAFTING → SUMMARIZED → ARCHITECTED → BUILDING → PACKAGED → BUNDLED
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import {
  Check,
  Circle,
  Loader2,
  FileText,
  Network,
  Hammer,
  Package,
  Rocket,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Download,
  Upload,
} from "lucide-react";
import {
  getProjectStageStatus,
  advanceProjectStage,
  type ProjectStage,
  type ProjectStageStatus,
  type StageCheck,
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
    description: "README verified with demo narrative",
  },
  ARCHITECTED: {
    label: "Architecture",
    shortLabel: "Arch",
    icon: Network,
    description: "Architecture diagram created",
  },
  BUILDING: {
    label: "Build",
    shortLabel: "Build",
    icon: Hammer,
    description: "Generating full demo package",
  },
  PACKAGED: {
    label: "Package",
    shortLabel: "Pkg",
    icon: Package,
    description: "Demo instruction files generated",
  },
  BUNDLED: {
    label: "Bundle",
    shortLabel: "DAB",
    icon: Rocket,
    description: "Packaged as Databricks Asset Bundle",
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BuildStepperProps {
  projectId: string;
  currentStage: ProjectStage;
  isStreaming: boolean;
  onStageChange: (newStage: ProjectStage) => void;
  onSendMessage: (message: string) => void;
  onDownloadDAB?: () => void;
  onPublishTemplate?: () => void;
  /** Trigger a refresh of stage status (e.g. after files change) */
  refreshTrigger?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BuildStepper({
  projectId,
  currentStage,
  isStreaming,
  onStageChange,
  onSendMessage,
  onDownloadDAB,
  onPublishTemplate,
  refreshTrigger,
}: BuildStepperProps) {
  const [stageStatus, setStageStatus] = useState<ProjectStageStatus | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentIdx = PROJECT_STAGES.indexOf(currentStage);

  // Fetch stage status on mount and when stage/files change
  useEffect(() => {
    let cancelled = false;
    getProjectStageStatus(projectId)
      .then((status) => {
        if (!cancelled) setStageStatus(status);
      })
      .catch(() => {
        // Silently fail — stage status is supplementary
      });
    return () => { cancelled = true; };
  }, [projectId, currentStage, refreshTrigger]);

  // Re-fetch after streaming completes (agent may have created files)
  useEffect(() => {
    if (!isStreaming && stageStatus) {
      getProjectStageStatus(projectId)
        .then(setStageStatus)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, projectId]);

  const handleAdvance = useCallback(async () => {
    setIsAdvancing(true);
    setError(null);
    try {
      const newStatus = await advanceProjectStage(projectId);
      setStageStatus(newStatus);
      onStageChange(newStatus.current_stage);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to advance");
      return false;
    } finally {
      setIsAdvancing(false);
    }
  }, [projectId, onStageChange]);

  const handleBuildDemoPackage = useCallback(async () => {
    // First advance stage to BUILDING, then send the build prompt
    const ok = await handleAdvance();
    if (!ok) return;
    onSendMessage(
        "Build the full demo package. Follow these steps:\n\n" +
        "1. **Load the `databricks-demo-generator` skill** for the complete workflow and file structure.\n" +
        "2. **Read the existing README.md and architecture.md** to understand the demo design.\n" +
        "3. **Create `META-PROMPT.md`** at the project root with comprehensive build instructions that another AI agent can follow.\n" +
        "4. **Create instruction files** in `instructions/` for each demo component:\n" +
        "   - Data generation specs (schemas, volumes, relationships, realistic patterns)\n" +
        "   - Pipeline definitions (streaming tables, materialized views, CDC patterns)\n" +
        "   - Dashboard specs (datasets, visualizations, filters, layout)\n" +
        "   - Genie Space definitions (tables, example questions, instructions)\n" +
        "   - Knowledge Assistant configs (endpoints, tool definitions, instructions)\n" +
        "   - Any additional component specs from the architecture\n" +
        "5. **Create `instructions/resources.json`** to track resource IDs (initially empty placeholders).\n" +
        "6. **Validate completeness** — ensure every component in architecture.md has a corresponding instruction file.\n\n" +
        "Generate detailed, actionable instruction files that the AI Dev Kit can execute to build real Databricks resources."
    );
  }, [handleAdvance, onSendMessage]);

  const handlePackageAsDAB = useCallback(() => {
    onSendMessage(
      "Package this project as a Databricks Asset Bundle (DAB). Follow these steps:\n\n" +
      "1. **Load the `databricks-bundles` skill** for DAB syntax, resource types, and best practices.\n" +
      "2. **Read the dab.md reference** at `.claude/skills/databricks-demo-generator/references/dab.md` for the demo-specific DAB workflow.\n" +
      "3. **Analyze all project files** to identify components (SQL files, Python scripts, notebooks, dashboards, pipelines, Genie spaces, KAs, etc.).\n" +
      "4. **Restructure into DAB layout** with proper `resources/*.yml` files and `src/` directory structure as described in the skill.\n" +
      "5. **Create `databricks.yml`** at the project root with:\n" +
      "   - `bundle.name` derived from the project\n" +
      "   - `include: [resources/*.yml]`\n" +
      "   - Variables for `catalog`, `schema`, and `warehouse_id` (using lookup)\n" +
      "   - `dev` and `prod` targets\n" +
      "6. **Create resource YAML files** in `resources/` (jobs.yml, pipelines.yml, dashboards.yml, etc.) mapping each project component to the correct DAB resource type.\n" +
      "7. **Create deployment scripts** in `src/deploy/` for components not natively supported by DAB (Genie Spaces, Knowledge Assistants, Multi-Agent Supervisors) using the patterns from dab.md.\n" +
      "8. **Validate the bundle** by reading back the `databricks.yml` and all `resources/*.yml` files to confirm they have valid YAML syntax and correct path references (`../src/` from resources/).\n" +
      "9. **Create `dab_instructions.md`** with deployment commands, variable descriptions, and a list of resources created.\n\n" +
      "Do NOT skip the validation step — confirm the DAB is structurally correct before finishing."
    );
  }, [onSendMessage]);

  // Build the CTA for the current stage
  const renderAction = () => {
    if (isStreaming) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Agent working...
        </div>
      );
    }

    const canAdvance = stageStatus?.can_advance ?? false;

    switch (currentStage) {
      case "DRAFTING":
        return (
          <Button
            size="sm"
            onClick={handleAdvance}
            disabled={!canAdvance || isAdvancing}
            className="gap-2"
          >
            {isAdvancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
            Confirm Summary
          </Button>
        );

      case "SUMMARIZED":
        return (
          <Button
            size="sm"
            onClick={handleAdvance}
            disabled={!canAdvance || isAdvancing}
            className="gap-2"
          >
            {isAdvancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
            Confirm Architecture
          </Button>
        );

      case "ARCHITECTED":
        return (
          <Button
            size="sm"
            onClick={handleBuildDemoPackage}
            disabled={isAdvancing}
            className="gap-2 bg-primary"
          >
            {isAdvancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
            Build Demo Package
          </Button>
        );

      case "BUILDING":
        return (
          <Button
            size="sm"
            onClick={handleAdvance}
            disabled={!canAdvance || isAdvancing}
            className="gap-2"
          >
            {isAdvancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
            Confirm Package
          </Button>
        );

      case "PACKAGED":
        return (
          <Button
            size="sm"
            onClick={async () => {
              const ok = await handleAdvance();
              if (ok) handlePackageAsDAB();
            }}
            disabled={isAdvancing}
            className="gap-2"
          >
            {isAdvancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
            Package as DAB
          </Button>
        );

      case "BUNDLED":
        return (
          <div className="flex items-center gap-2">
            {onDownloadDAB && (
              <Button size="sm" variant="outline" onClick={onDownloadDAB} className="gap-2">
                <Download className="h-4 w-4" />
                Download
              </Button>
            )}
            {onPublishTemplate && (
              <Button size="sm" onClick={onPublishTemplate} className="gap-2">
                <Upload className="h-4 w-4" />
                Publish
              </Button>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="border-b border-border bg-muted/20">
      <div className="px-5 py-3">
        {/* Stepper dots */}
        <div className="flex items-center gap-1 mb-2">
          <TooltipProvider delayDuration={200}>
            {PROJECT_STAGES.map((stage, idx) => {
              const meta = STAGE_META[stage];
              const Icon = meta.icon;

              // Backend stages are achievements (SUMMARIZED = summary done).
              // The stepper should show achieved stages as completed and
              // highlight the NEXT action — not the achievement itself.
              //
              // "Action" stages (DRAFTING, BUILDING) are in-progress work,
              // so they show as the current focus. "Milestone" stages
              // (SUMMARIZED, ARCHITECTED, PACKAGED, BUNDLED) mean the work
              // is done, so the dot is checked and the next dot is active.
              const isActionStage =
                currentStage === "DRAFTING" || currentStage === "BUILDING";
              const isTerminal = currentStage === "BUNDLED";

              const isCompleted = isActionStage
                ? idx < currentIdx
                : idx <= currentIdx;

              const isCurrent = isTerminal
                ? false
                : isActionStage
                  ? idx === currentIdx
                  : idx === currentIdx + 1 && idx < PROJECT_STAGES.length;

              return (
                <div key={stage} className="flex items-center">
                  {idx > 0 && (
                    <div
                      className={`h-px w-4 sm:w-8 mx-0.5 transition-colors ${
                        isCompleted ? "bg-primary" : "bg-border"
                      }`}
                    />
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                          isCompleted
                            ? "bg-primary/10 text-primary"
                            : isCurrent
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground/50"
                        }`}
                      >
                        {isCompleted ? (
                          <Check className="h-3 w-3" />
                        ) : isCurrent ? (
                          <Icon className="h-3 w-3" />
                        ) : (
                          <Circle className="h-3 w-3" />
                        )}
                        <span className="hidden sm:inline">{meta.shortLabel}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="font-medium">{meta.label}</p>
                      <p className="text-xs text-muted-foreground">{meta.description}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </TooltipProvider>
        </div>

        {/* Action row: checks + CTA */}
        <div className="flex items-center justify-between gap-4">
          {/* Gate checks */}
          <div className="flex items-center gap-3 text-xs overflow-x-auto">
            {stageStatus?.checks.map((check, i) => (
              <CheckPill key={i} check={check} />
            ))}
          </div>

          {/* CTA */}
          <div className="shrink-0">
            {renderAction()}
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive mt-1">{error}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check pill — small indicator for each gate check
// ---------------------------------------------------------------------------

function CheckPill({ check }: { check: StageCheck }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`flex items-center gap-1 whitespace-nowrap ${
              check.passed ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
            }`}
          >
            {check.passed ? (
              <CheckCircle className="h-3 w-3 shrink-0" />
            ) : (
              <AlertCircle className="h-3 w-3 shrink-0" />
            )}
            <span>{check.label}</span>
          </div>
        </TooltipTrigger>
        {check.detail && (
          <TooltipContent side="bottom">
            <p className="text-xs">{check.detail}</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}

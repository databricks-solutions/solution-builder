export type ProjectStatus = "draft" | "in_progress" | "ready";

export function projectStatusFromStage(stage: string): ProjectStatus {
  if (stage === "BUNDLED") return "ready";
  if (stage === "DRAFTING") return "draft";
  return "in_progress";
}

export const STATUS_META: Record<
  ProjectStatus,
  { label: string; dot: string; pill: string }
> = {
  draft: {
    label: "Draft",
    dot: "bg-muted-foreground/40",
    pill: "bg-muted text-muted-foreground",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-blue-500",
    pill: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  ready: {
    label: "Ready",
    dot: "bg-green-500",
    pill: "bg-green-500/10 text-green-700 dark:text-green-400",
  },
};

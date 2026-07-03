/**
 * Tier vocabulary + colors.
 *
 * Originally the type system for the ReactFlow architecture diagram (now
 * replaced by the capability-layer `platform-architecture.ts`). What survives
 * is the shared TIER palette: the capability pills in `product-selector`,
 * `capabilities-panel`, and `project-overview` color themselves by tier, so
 * the vocabulary lives on here as the single source of those colors.
 */

export type TierType =
  | "source"
  | "ingest"
  | "bronze"
  | "silver"
  | "gold"
  | "compute"
  | "analytics"
  | "ai"
  | "consumer"
  | "governance"
  | "sdp"
  | "orchestration"
  | "interface";

export const TIER_CONFIG: Record<TierType, {
  color: string;
  bg: string;
  border: string;
  accent: string;
  stripe: string;
}> = {
  source: {
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-500/[0.08]",
    border: "border-slate-500/25",
    accent: "bg-slate-500",
    stripe: "#64748b",
  },
  ingest: {
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/[0.08]",
    border: "border-blue-500/25",
    accent: "bg-blue-500",
    stripe: "#3b82f6",
  },
  bronze: {
    color: "text-orange-700 dark:text-orange-400",
    bg: "bg-orange-800/[0.08]",
    border: "border-orange-700/30",
    accent: "bg-orange-700",
    stripe: "#cd7f32",
  },
  silver: {
    color: "text-slate-500 dark:text-slate-400",
    bg: "bg-slate-400/[0.08]",
    border: "border-slate-400/30",
    accent: "bg-slate-400",
    stripe: "#a8a9ad",
  },
  gold: {
    color: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-600/[0.08]",
    border: "border-amber-600/30",
    accent: "bg-amber-600",
    stripe: "#c9a227",
  },
  compute: {
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/[0.08]",
    border: "border-violet-500/25",
    accent: "bg-violet-500",
    stripe: "#8b5cf6",
  },
  analytics: {
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-500/[0.08]",
    border: "border-pink-500/25",
    accent: "bg-pink-500",
    stripe: "#ec4899",
  },
  ai: {
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-500/[0.08]",
    border: "border-indigo-500/25",
    accent: "bg-indigo-500",
    stripe: "#6366f1",
  },
  consumer: {
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/[0.08]",
    border: "border-emerald-500/25",
    accent: "bg-emerald-500",
    stripe: "#10b981",
  },
  governance: {
    color: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-600/[0.08]",
    border: "border-slate-600/25",
    accent: "bg-slate-600",
    stripe: "#475569",
  },
  sdp: {
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-500/[0.08]",
    border: "border-teal-500/25",
    accent: "bg-teal-500",
    stripe: "#14b8a6",
  },
  orchestration: {
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-500/[0.08]",
    border: "border-sky-500/25",
    accent: "bg-sky-500",
    stripe: "#0ea5e9",
  },
  interface: {
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/[0.08]",
    border: "border-rose-500/25",
    accent: "bg-rose-500",
    stripe: "#f43f5e",
  },
};

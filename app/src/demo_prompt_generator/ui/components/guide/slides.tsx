import type { ComponentType } from "react";
import {
  TimelineVisual,
  BlocksToSpecVisual,
  ShareVisual,
  IdeationVisual,
  ArchitectureVisual,
  SpecVisual,
  ResourcesVisual,
  LiveVisual,
  type GuideVisualProps,
} from "./visuals";

export type GuideSection = "Overview" | "Step-by-step guide";

export interface GuideSlide {
  id: string;
  section: GuideSection;
  title: string;
  body: string;
  // Animated visual rendered at the top of the slide. Takes precedence over `gif`.
  Visual?: ComponentType<GuideVisualProps>;
  // Optional GIF fallback. Drop files in `public/GIFs/` (case matters on Linux).
  gif?: string;
  alt?: string;
}

// Three-act structure: sales pitch (1-3) → walkthrough (4-8).
export const GUIDE_SLIDES: GuideSlide[] = [
  // -------------------------------------------------------------------------
  // Act I — sales pitch
  // -------------------------------------------------------------------------
  {
    id: "time-pitch",
    section: "Overview",
    title: "Solutions in minutes, not days",
    Visual: TimelineVisual,
    body: `A great Databricks solution takes **days** to hand-build. The [AI Dev Kit](https://github.com/databricks-solutions/ai-dev-kit) cuts that to roughly **4 hours** by shipping our best practices baked in.

This framework — built on top of the AI Dev Kit — composes pre-curated context blocks instead of inventing each solution from scratch. The result: **15–30 minutes** to a working solution, **far fewer tokens**, and use cases you can save and share with the team.`,
  },
  {
    id: "structured-context",
    section: "Overview",
    title: "Structured context, not freestyle prompting",
    Visual: BlocksToSpecVisual,
    body: `Industries, capabilities, and patterns are pre-captured as small Markdown **blocks**. The agent composes them into a tailored spec instead of prompting from a blank page.

**Fewer tokens. Less drift. Faster runs.** And the AI Dev Kit picks up the spec already knowing the right way to build it.`,
  },
  {
    id: "compounding",
    section: "Overview",
    title: "Save once, fork for every customer",
    Visual: ShareVisual,
    body: `Hit something good? **Publish the project as a template.** Teammates browse the gallery, fork in one click, and reskin for the next customer — no copy-paste, no chat archaeology.

A *customer segmentation* solution built for **Acme Retail** can become **BayerCo's patient cohorts** in minutes — same blueprint, swapped industry. Every shared template means **less prompting and fewer tokens** for the whole team.`,
  },

  // -------------------------------------------------------------------------
  // Act II — walkthrough
  // -------------------------------------------------------------------------
  {
    id: "ideation",
    section: "Step-by-step guide",
    title: "Step 1 — Describe the use case",
    Visual: IdeationVisual,
    gif: "/GIFs/ideation.gif",
    alt: "Brainstorming a customer use case",
    body: `Pick the **industry**, **capabilities**, and any specific data shapes or workflows.

The agent grounds the solution in real Databricks patterns from the block library — no blank page, no improvisation.`,
  },
  {
    id: "architecture",
    section: "Step-by-step guide",
    title: "Step 2 — Iterate on the architecture",
    Visual: ArchitectureVisual,
    gif: "/GIFs/architecture.gif",
    alt: "Generated architecture diagram",
    body: `The agent produces a **high-level architecture**: ingest sources, transformations, governance, serving layer, and downstream assets.

Push back via chat until it matches your customer's environment.`,
  },
  {
    id: "specification",
    section: "Step-by-step guide",
    title: "Step 3 — Fan out the specifications",
    Visual: SpecVisual,
    gif: "/GIFs/specification.gif",
    alt: "Solution specification files",
    body: `Once the story is approved, the agent fans out **one spec per Databricks layer** under \`specifications/\`:

- **\`01-lakeflow.md\`** — synthetic data, schemas, and the bronze → silver → gold SDP pipeline
- **\`02-uc-governance.md\`** — Unity Catalog ABAC policies and data-quality monitors
- **\`03-ai-bi.md\`** — AI/BI dashboard layout and the Genie Space
- **\`04-agent-bricks.md\`** — Knowledge Assistant, Multi-Agent Supervisor, and serving

Together they're the precise functional spec the build stage executes.`,
  },
  {
    id: "resources",
    section: "Step-by-step guide",
    title: "Step 4 — Hand off to the AI Dev Kit",
    Visual: ResourcesVisual,
    gif: "/GIFs/resources.gif",
    alt: "AI Dev Kit executing the spec package",
    body: `The agent leaves you with a complete handoff package: \`README.md\`, \`META-PROMPT.md\`, \`resources.json\`, and one \`specifications/*.md\` per layer.

Open it from your terminal with the [AI Dev Kit](https://github.com/databricks-solutions/ai-dev-kit). It executes the specs end-to-end on your workspace — synthetic data → SDP pipeline → UC governance → AI/BI + Genie → Agent Bricks.`,
  },
  {
    id: "databricks-resources",
    section: "Step-by-step guide",
    title: "Step 5 — See it live on Databricks",
    Visual: LiveVisual,
    gif: "/GIFs/databricks-resources.gif",
    alt: "Live Databricks resources created from the solution",
    body: `When the Dev Kit finishes running, real **tables, pipelines, dashboards, and apps** appear on your workspace — with deep links to each from the project view, ready to walk a customer through.`,
  },
];

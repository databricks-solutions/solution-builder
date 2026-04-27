export interface GuideSlide {
  id: string;
  title: string;
  body: string;
  gif?: string;
  alt?: string;
}

// Drop GIFs in: src/demo_prompt_generator/ui/public/GIFs/
// They are served at /GIFs/<filename> at runtime.
// NOTE: case matters on Linux (deployed). Keep the folder capitalized as `GIFs`.
// TODO: replace placeholder copy with final content.
export const GUIDE_SLIDES: GuideSlide[] = [
  {
    id: "welcome",
    title: "Welcome",
    gif: "/GIFs/welcome.gif",
    alt: "Overview of the Demo Prompt Generator",
    body: `Generate **personalized demo packages** for any customer scenario.

Instead of static demo repos, this app captures best practices as composable blocks of context and assembles them into a tailored prompt package — ready to run with the Databricks AI Dev Kit.

Use the arrows or arrow keys to step through the major stages.`,
  },
  {
    id: "ideation",
    title: "Use-case Ideation",
    gif: "/GIFs/ideation.gif",
    alt: "Brainstorming a customer use case",
    body: `Start by describing the customer scenario you want to demo.

Pick the **industry**, **capabilities**, and any specific data shapes or workflows. The agent uses these inputs — plus the block library — to ground the demo in real Databricks patterns.`,
  },
  {
    id: "architecture",
    title: "Generate Architecture",
    gif: "/GIFs/architecture.gif",
    alt: "Generated architecture diagram",
    body: `The agent produces a **high-level architecture** for the demo: ingest sources, transformations, serving layer, and downstream assets.

Review the diagram, push back via chat, and iterate until it matches the customer's environment.`,
  },
  {
    id: "specification",
    title: "Generate Specification",
    gif: "/GIFs/specification.gif",
    alt: "Demo specification document",
    body: `Once the architecture is locked, the agent expands it into a concrete **specification** — table schemas, pipeline steps, dashboards, and the prompts that will build them.

This is the source of truth for the next stage.`,
  },
  {
    id: "resources",
    title: "Generate Resources",
    gif: "/GIFs/resources.gif",
    alt: "Generated prompt package files",
    body: `The spec is rendered into a **prompt package**: a set of files you can hand off directly to the [Databricks AI Dev Kit](https://github.com/databricks/ai-dev-kit) to build the actual assets on your workspace.

Inspect, tweak, or publish the package as a template for your team.`,
  },
  {
    id: "databricks-resources",
    title: "See Databricks Resources",
    gif: "/GIFs/databricks-resources.gif",
    alt: "Live Databricks resources created from the demo",
    body: `When the Dev Kit finishes running, real **tables, pipelines, dashboards, and apps** appear on your workspace.

Live links to each resource show up in the project view so you can jump straight into the demo and walk a customer through it.`,
  },
];

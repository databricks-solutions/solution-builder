export const AUTO_BUILD_KICKOFF = `Auto-build mode. Follow DEMO_SKILL stages 0→3 end-to-end without pausing at the gates. Stage 4 (DAB) only if the user later asks for it.

Choose sensible defaults instead of asking. Batch independent reads and independent writes in the same turn. Don't narrate — let the tool calls speak. Surface a message only on a hard error you can't recover from, or as the final summary with workspace links.

Write specifications directly — don't think too long about them. Spec files are working drafts that get refined during build, not finished essays. Skip the deliberation, write the file, move on. The build stage will surface anything that doesn't work.`;

/** Appended to the initial prompt(s) we send the agent on project creation and
 *  architecture-first build. The Solution Builder app resolves the brand itself
 *  (via its brand API) and writes brand/brand.json — so the agent must NOT waste
 *  turns web-searching for it. It just reads the file if/when it's there. */
export const BRAND_NOTE = `Note: don't search the web for the company's brand — we resolve it for you and populate \`brand/brand.json\` (palette, logo, site). If it's there, read it to personalize the demo; if not, don't fetch it.`;

/** Diagram styles offered on the Architecture tab. `id` is the key the skill's
 *  reference/style-*.md files use; `blurb` is the one-line card text; `meaning` is
 *  what the agent is told the style means; `read` names the section and the example
 *  the agent reads before writing. `match` is only offered when an image is attached. */
export const DIAGRAM_STYLES = [
  { id: "marketing", label: "Marketing", blurb: "Deck-ready story: few words, big tiles", meaning: "a deck-ready Databricks story with catalog tiles and composites, few words", read: "reference/style-marketing.md and its example reference/architecture-complete.jsonc" },
  { id: "technical", label: "Technical", blurb: "Named jobs, tables, keys and write modes", meaning: "detailed engineering cards with named jobs and tables, key/value rows and tag pills, current vs proposed", read: "reference/style-technical.md and its example reference/style-technical.jsonc" },
  { id: "lifecycle", label: "Lifecycle", blurb: "Process stages with numbered steps", meaning: "process stages as columns, each a titled box with a pictogram and stacked items", read: "reference/style-lifecycle.md and its example reference/style-lifecycle.jsonc" },
  { id: "networking", label: "Networking", blurb: "Account, region, VPC, PrivateLink", meaning: "cloud topology: account, region, VPC and subnets, PrivateLink, control vs data plane", read: "reference/style-networking.md and its example reference/style-networking.jsonc" },
  { id: "match", label: "Match my image", blurb: "Keep the look of the diagram you uploaded", meaning: "reproduce the uploaded diagram's own style", read: "reference/redraw.md (the uploaded image is the example)" },
] as const;

export type DiagramStyle = (typeof DIAGRAM_STYLES)[number]["id"];

/** Opening message for an architecture-first project. `request` is what the user
 *  typed (or a description synthesized from their uploads). `style`, when given,
 *  adds one hint line naming the diagram style the user picked. Shared with the
 *  redraw eval harness (scripts/eval-arch-agent/) so it tests the exact text. */
export function buildArchitectureFirstPrompt(request: string, style?: DiagramStyle): string {
  const base =
    `The user wants to START by creating an architecture diagram (architecture-first flow) — review it before building.\n\n` +
    `What they wrote (may be a tidy brief OR pasted notes / a transcript — extract the intent + use-case from it):\n${request}` +
    `\n\nFirst read the architecture skill, \`.claude/skills/databricks-architecture/SKILL.md\` (NOT the solution-builder SKILL.md). Then design a coherent architecture that functionally solves the use-case, following its section 2 (design rules) and the guide for the kind you choose. If the user uploaded a diagram (an image, screenshot or exported drawing), redraw THAT diagram faithfully — same components, connections, labels and grouping — following \`reference/redraw.md\`, not a canonical template. Base the diagram on the request ABOVE — \`resources.json\` is empty at this stage, it is NOT the spec, do not read it and reproduce a canonical diagram from it. Write ONLY \`architecture.md\` at the project root. Do not write specs or build resources yet. Fill the tab \`story\` only with reader-facing context and out-of-scope items. Then produce the diagram and stop so the user can review and edit it on the Architecture tab.`;
  if (!style) return base;
  const s = DIAGRAM_STYLES.find((d) => d.id === style);
  if (!s) return base;
  return (
    base +
    `\n\nDiagram style: ${s.label} — ${s.meaning}. Read it together with SKILL.md, in one batch of parallel Read calls: ${s.read} (paths under .claude/skills/databricks-architecture/). Follow them.`
  );
}

/** Tells the agent where the home-page uploads are. The backend writes each original
 *  plus a `.extracted.md` text sibling; images have no text layer, so they get no
 *  sibling and the agent must open the image itself. */
export function buildUploadsNote(files: { filename: string; content_type: string; truncated: boolean }[]): string {
  if (files.length === 0) return "";
  const isImage = (f: (typeof files)[number]) =>
    f.content_type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.filename);
  const fileList = files
    .map((f) =>
      `- ${f.filename}` +
      (isImage(f) ? " (image — open the file itself)" : ` → \`${f.filename}.extracted.md\``) +
      (f.truncated ? " (truncated)" : ""),
    )
    .join("\n");
  return (
    `\n\nThe user uploaded ${files.length} file(s) as ` +
    `context — they live at \`context/uploads/\` in the project. ` +
    `Read them before designing so the result fits what's actually in them ` +
    `(documents are already text-extracted into \`.extracted.md\` siblings; ` +
    `images have none, read the image):\n${fileList}`
  );
}

/** Sent to the agent (once per project) when the frontend detects that
 *  architecture.md is in the OLD, pre-flat-file format. Asks the agent to
 *  migrate it to the current schema, grounded in the project's README story. */
export const ARCHITECTURE_MIGRATION_PROMPT = `This project uses an old version of the architecture. Read architecture.md, and the databricks-architecture skill, and update the architecture to the new format, making sure it reflect the story in the readme.`;

import type { ArchitectureIssue } from "./platform-architecture";

/** Turn validateArchitecture() issues into a chat message for the agent. Groups
 *  by tab, lists each issue with its element + field + message, and tells the
 *  agent to fix architecture.md. Returns null when there are no issues (so the
 *  caller can skip sending). The message is deliberately concrete — the agent
 *  gets the exact ids/fields to fix, not a vague "something's wrong". */
export function buildArchitectureFixPrompt(issues: ArchitectureIssue[]): string | null {
  if (!issues.length) return null;
  const byTab = new Map<string, ArchitectureIssue[]>();
  for (const i of issues) {
    const arr = byTab.get(i.tab) ?? [];
    arr.push(i);
    byTab.set(i.tab, arr);
  }
  const sections = [...byTab.entries()].map(([tab, list]) => {
    const lines = list.map((i) => {
      const where = i.nodeId ? `node \`${i.nodeId}\`` : i.edgeId ? `edge \`${i.edgeId}\`` : "";
      const field = i.field ? ` (\`${i.field}\`)` : "";
      return `  - ${where}${field}: ${i.message}`;
    });
    return `Tab "${tab}":\n${lines.join("\n")}`;
  });
  return `The architecture diagram (architecture.md) has ${issues.length} validation ${issues.length === 1 ? "issue" : "issues"} that make it render incorrectly. These are broken references — ids, edges, or handles pointing at things that don't exist on the tab (a common cause: a node was renamed but an edge still uses the old id).

${sections.join("\n\n")}

Read architecture.md and the databricks-architecture skill, then fix each issue in place — correct the referenced id to the intended existing node, remove the reference if the target is genuinely gone, or add the missing node if it should be there. Preserve the diagram's intent and layout; only fix the broken references. Re-check that every edge endpoint resolves to a real node afterward.`;
}

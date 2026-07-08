export const AUTO_BUILD_KICKOFF = `Auto-build mode. Follow DEMO_SKILL stages 0→3 end-to-end without pausing at the gates. Stage 4 (DAB) only if the user later asks for it.

Choose sensible defaults instead of asking. Batch independent reads and independent writes in the same turn. Don't narrate — let the tool calls speak. Surface a message only on a hard error you can't recover from, or as the final summary with workspace links.

Write specifications directly — don't think too long about them. Spec files are working drafts that get refined during build, not finished essays. Skip the deliberation, write the file, move on. The build stage will surface anything that doesn't work.`;

/** Sent to the agent (once per project) when the frontend detects that
 *  architecture.md is in the OLD, pre-flat-file format. Asks the agent to
 *  migrate it to the current schema, grounded in the project's README story. */
export const ARCHITECTURE_MIGRATION_PROMPT = `This project uses an old version of the architecture. Read architecture.md, and the databricks-architecture skill, and update the architecture to the new format, making sure it reflect the story in the readme.`;

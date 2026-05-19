/**
 * `loggedTool` — drop-in replacement for `tool()` from `@openai/agents`
 * that ALSO logs the error to the server console when a tool throws.
 *
 * Why this exists:
 *   The SDK's default behavior on a thrown tool error is to return
 *   `"An error occurred while running the tool. Please try again. Error: <…>"`
 *   to the model so it can recover gracefully. The error never reaches
 *   our server logs — so a query that always fails (bad schema, missing
 *   table, etc.) shows up only as a vague chat message and the operator
 *   has nothing to debug from.
 *
 *   This wrapper injects an `errorFunction` that:
 *     1. Logs the error (full stack + cause + Drizzle query metadata) via
 *        console.error → picked up by the unified logger in lib/logger.ts.
 *     2. Falls back to the SDK's default behavior so the model still sees
 *        the same message and can recover.
 *
 *   If a caller passes their own `errorFunction`, we wrap it: log first,
 *   then delegate to the caller's function so they can customize the
 *   string returned to the model.
 */
import { tool } from '@openai/agents';

type ToolArgs = Parameters<typeof tool>[0];

export function loggedTool<T extends ToolArgs>(args: T): ReturnType<typeof tool> {
  const userErrorFunction = args.errorFunction;
  return tool({
    ...args,
    errorFunction: (context, err) => {
      // Log full error context: message, stack, cause (pg error_code +
      // constraint), and Drizzle's `query`/`params` if present. The
      // unified logger handles formatting + truncation.
      console.error(`[tool:${args.name}] threw`, err);
      if (typeof userErrorFunction === 'function') {
        return userErrorFunction(context, err);
      }
      // Mirror the SDK default so the model gets the same recovery hint.
      const details = err instanceof Error ? err.toString() : String(err);
      return `An error occurred while running the tool. Please try again. Error: ${details}`;
    },
  });
}

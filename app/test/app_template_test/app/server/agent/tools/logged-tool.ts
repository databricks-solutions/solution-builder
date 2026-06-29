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
import type {
  ToolOptions,
  ToolInputParameters,
  UnknownContext,
} from '@openai/agents';

/**
 * Trim a tool-error string before handing it to the model. Drizzle/pg
 * wraps the full SQL + every bound parameter into `err.message`, which
 * can be 100k+ chars on a bulk insert — sending that to the model
 * burns the context window and leaks internal table/column names. The
 * model only needs a short, actionable hint; the full error already
 * went to console.error for the operator.
 */
function sanitizeForModel(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // First line tends to be the human-readable summary; everything after
  // is usually the SQL/params dump or a `params:` Drizzle suffix.
  const firstLine = raw.split('\n', 1)[0] ?? '';
  const trimmed = firstLine.split(/params:|query:/i)[0]?.trim() ?? firstLine;
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

export function loggedTool<
  TParameters extends ToolInputParameters = undefined,
  Context = UnknownContext,
  Result = string,
>(args: ToolOptions<TParameters, Context>) {
  const userErrorFunction = args.errorFunction;
  return tool<TParameters, Context, Result>({
    ...args,
    errorFunction: (context, err) => {
      // Log full error context: message, stack, cause (pg error_code +
      // constraint), and Drizzle's `query`/`params` if present. The
      // unified logger handles formatting + truncation.
      console.error(`[tool:${args.name}] threw`, err);
      if (typeof userErrorFunction === 'function') {
        return userErrorFunction(context, err);
      }
      // Sanitized recovery hint — short, single-line, no stack/SQL leak.
      return `An error occurred while running the tool. Please try again. Error: ${sanitizeForModel(err)}`;
    },
  });
}

/**
 * Pick the next scripted step to suggest, based on the conversation so far.
 *
 * Rules:
 *   - A step is "sent" if its prompt appears as a user message.
 *   - The first step (no triggers) is always available.
 *   - A step unlocks once the last assistant message contains ANY substring
 *     in its `triggerAfter` list (synonyms, not all-required — models phrase
 *     things different ways and we shouldn't gate the demo on exact words).
 *   - Only the next step in the chain is returned (not the whole tail) —
 *     callers render it as a single "Suggested next" chip.
 */
import type { ScriptStep } from '@/lib/api';

export type ScriptMsg = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export function pickNextStep(
  script: ScriptStep[],
  messages: ScriptMsg[],
): ScriptStep | null {
  if (script.length === 0) return null;
  const sent = new Set(
    messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.trim().toLowerCase()),
  );
  const lastAssistant =
    [...messages].reverse().find((m) => m.role === 'assistant')?.content?.toLowerCase() ?? '';

  for (const step of script) {
    if (sent.has(step.prompt.trim().toLowerCase())) continue;
    const triggers = step.triggerAfter ?? [];
    if (triggers.length === 0) return step;
    if (triggers.some((t) => lastAssistant.includes(t.toLowerCase())))
      return step;
    return null;
  }
  return null;
}

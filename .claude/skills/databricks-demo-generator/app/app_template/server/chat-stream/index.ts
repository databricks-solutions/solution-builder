import type { Request, Response } from 'express';
import type { AppDb } from '../db/index.js';
import {
  appendMessage,
  renameConversationIfDefault,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { streamAgentTurn } from './agent-stream.js';
import type { ThinkingEntry } from '../db/schema.js';
import { sseError } from './sse.js';

type ChatConfig = {
  /** MAS endpoint name. Passed through to `streamAgentTurn` and from
   * there into the AgentContext used by refundops.ts. Replace with
   * `genieSpaceId` if your demo uses Genie. */
  masEndpointName: string;
  agentModel?: string;
};

/**
 * /api/chat/stream entry point.
 *
 * Drives the OpenAI Agents SDK loop in agent-stream.ts. The agent's
 * `ask_data` tool is what reaches the configured Databricks data backend
 * (MAS endpoint OR Genie space — see refundops.ts dispatcher).
 *
 * Robustness:
 *   1. Persist the user message FIRST so a crash mid-stream still leaves
 *      the user's text on a page reload.
 *   2. Sanitize history: drop empty content rows + non-user/assistant
 *      roles. The Responses API rejects empty `output_text` items with
 *      a misleading 502.
 *   3. After the stream ends (success OR error) persist an assistant
 *      row with finalText / errorText so reload shows what happened.
 */
export async function handleChatStream(args: {
  req: Request;
  res: Response;
  db: AppDb;
  config: ChatConfig;
}): Promise<void> {
  const { req, res, db, config } = args;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const userEmail = getCurrentUserEmail(req);
  const conversationId = (req.body?.conversationId as string) ?? null;
  const messages = (req.body?.messages ?? []) as Array<{
    role: string;
    content: string;
  }>;

  // Persist user message + auto-title.
  if (conversationId && messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last?.role === 'user' && typeof last.content === 'string') {
      try {
        await appendMessage(db, conversationId, 'user', last.content);
        const title =
          last.content.slice(0, 48) + (last.content.length > 48 ? '…' : '');
        await renameConversationIfDefault(db, conversationId, title);
      } catch (e) {
        console.error('[db] persist user message failed', e);
      }
    }
  }

  const host = (process.env.DATABRICKS_HOST ?? '').replace(/\/$/, '');
  if (!host) {
    sseError(res, 'DATABRICKS_HOST not set');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // Sanitize history before sending to the model. Two invariants the
  // Responses API is strict about, either of which surfaces as an
  // unhelpful "502 INTERNAL_ERROR: invalid response from upstream":
  //   1. No empty-content messages. A failed prior turn may have persisted
  //      an assistant row with content='' (see the error-only branch below);
  //      replaying it produces `[{type: 'output_text', text: ''}]`, which
  //      the API rejects. We keep that row in the DB for UI display but
  //      skip it here so it can't contaminate future context.
  //   2. Only user/assistant roles reach the SDK.
  const cleanMessages = messages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0,
  );

  // If sanitization leaves us with nothing to send (e.g. the only message
  // was an empty user turn), bail cleanly rather than letting the upstream
  // 502 bubble up. This also protects agent-stream from running with zero
  // history.
  const lastClean = cleanMessages[cleanMessages.length - 1];
  if (!lastClean || lastClean.role !== 'user') {
    sseError(
      res,
      'Empty message — please type something before sending.',
    );
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const out = await streamAgentTurn({
    db,
    req,
    res,
    userEmail,
    masEndpointName: config.masEndpointName,
    databricksHost: host,
    // Foundation Model endpoint name. Use the EXACT name as listed under
    // Serving → Foundation Models in your workspace. Default is
    // `databricks-claude-sonnet-4-6`; `databricks-gpt-5-4` is a fine
    // alternative. Never abbreviate (`databricks-claude-sonnet-4` does NOT
    // exist and produces a 400 from the chat-completions call below).
    model: config.agentModel ?? 'databricks-claude-sonnet-4-6',
    messages: cleanMessages,
  });
  const finalText: string | null = out.finalText;
  const traceId: string | null = out.traceId;
  const thinking: ThinkingEntry[] = out.thinking;
  const errorText: string | null = out.error;

  res.write('data: [DONE]\n\n');
  res.end();

  // Persist assistant message — either the final text OR an error row so a
  // page reload shows what happened instead of dropping the turn silently.
  if (conversationId && ((finalText && finalText.trim().length > 0) || errorText)) {
    try {
      await appendMessage(
        db,
        conversationId,
        'assistant',
        finalText ?? '',
        traceId ?? undefined,
        thinking,
        errorText ?? undefined,
      );
    } catch (e) {
      console.error('[db] persist assistant message failed', e);
    }
  }
}

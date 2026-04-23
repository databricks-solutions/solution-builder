import type { Request, Response } from 'express';
import type { AppDb } from '../db/index.js';
import {
  appendMessage,
  renameConversationIfDefault,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { streamAgentTurn } from './agent-stream.js';
import { streamMasTurn } from './mas-stream.js';
import type { ThinkingEntry } from '../db/schema.js';
import { sseError } from './sse.js';

type ChatConfig = {
  agentEndpointName: string;
  agentModel?: string;
};

/**
 * Dispatches a /api/chat/stream request to the right backend:
 *   - mode='agent' (default) → OpenAI Agents SDK loop with tools
 *   - mode='mas'              → raw passthrough to the MAS serving endpoint
 *
 * In both paths we:
 *   1) persist the user's message at the top (so it survives partial failures)
 *   2) stream SSE events to the response
 *   3) persist the final assistant message when the stream ends
 *
 * The SSE event shape is identical across both paths so the browser only has
 * to parse one taxonomy. See agent-stream.ts and mas-stream.ts.
 */
export async function handleChatStream(args: {
  req: Request;
  res: Response;
  db: AppDb;
  config: ChatConfig;
  formatCache: Map<string, 'agent' | 'chat_completion'>;
}): Promise<void> {
  const { req, res, db, config, formatCache } = args;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const userEmail = getCurrentUserEmail(req);
  const conversationId = (req.body?.conversationId as string) ?? null;
  const mode =
    (req.body?.mode as 'agent' | 'mas' | undefined) ??
    (req.query.mode as 'agent' | 'mas' | undefined) ??
    'agent';
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

  let finalText: string | null = null;
  let traceId: string | null = null;
  let thinking: ThinkingEntry[] = [];
  let errorText: string | null = null;

  if (mode === 'agent') {
    const out = await streamAgentTurn({
      db,
      req,
      res,
      userEmail,
      masEndpointName: config.agentEndpointName,
      databricksHost: host,
      model: config.agentModel ?? 'databricks-gpt-5-4',
      messages: cleanMessages,
    });
    finalText = out.finalText;
    traceId = out.traceId;
    thinking = out.thinking;
    errorText = out.error;
  } else {
    const out = await streamMasTurn({
      req,
      res,
      host,
      endpoint: config.agentEndpointName,
      messages: cleanMessages,
      formatCache,
    });
    finalText = out.finalText;
    traceId = out.traceId;
    thinking = out.thinking;
    errorText = out.error;
  }

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

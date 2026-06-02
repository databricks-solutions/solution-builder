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

  // Abort the agent run when the client disconnects (Stop button → fetch
  // abort → socket close; or page refresh / tab close → socket close).
  // Without this the agent runs to completion against a dead socket,
  // burns LLM tokens, and writes an orphan "assistant" row that the user
  // never asked for. With this, the SDK throws AbortError, the catch
  // returns canceled=true, and we persist a "Canceled by the user" row.
  //
  // CRITICAL: bind to `res` 'close', not `req` 'close'. Node fires `req`
  // 'close' as soon as the request body is consumed (which happens
  // immediately on a small JSON body) — that's NOT a client disconnect,
  // it's normal request lifecycle. Aborting on it kills every turn
  // moments after the body is parsed, the SDK silently returns an empty
  // stream, and the UI shows the "empty turn" fallback for every message.
  // `res` 'close' only fires when the actual response socket closes,
  // which IS a real disconnect.
  const turnAbort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      console.debug('[chat-stream] client disconnected → aborting agent run');
      turnAbort.abort();
    }
  });

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
        // Drizzle wraps the pg error; the real cause has the SQLSTATE code
        // and detail/hint that diagnose the actual schema or FK issue.
        const cause = (e as { cause?: unknown }).cause as
          | {
              code?: string;
              detail?: string;
              hint?: string;
              schema?: string;
              table?: string;
              column?: string;
              message?: string;
            }
          | undefined;
        console.error('[db] persist user message failed', {
          drizzle_message: (e as Error).message,
          pg_code: cause?.code,
          pg_detail: cause?.detail,
          pg_hint: cause?.hint,
          pg_schema: cause?.schema,
          pg_table: cause?.table,
          pg_column: cause?.column,
          pg_message: cause?.message,
        });
        // Tell the client. Otherwise the page shows the message and then
        // reload drops it silently — the worst kind of "did it work?" bug.
        sseError(
          res,
          `Your last message couldn't be saved (${cause?.code ?? 'db error'}). The agent will reply but a page reload won't show it.`,
        );
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

  // Wrap streamAgentTurn in a try/catch so a thrown error (anything that
  // escapes the SDK's own catch — MLflow span init, fetch shim crash,
  // unhandled promise rejection inside a tool) still produces a structured
  // result. Without this wrapper the request hangs, the client sees no
  // assistant bubble, no error, and reload shows only the user message —
  // exactly the silent failure mode reported (4 user messages, 0 replies).
  let out: {
    finalText: string | null;
    traceId: string | null;
    thinking: ThinkingEntry[];
    error: string | null;
    canceled: boolean;
    modelError: import('../agent/refundops.js').ModelErrorDetail | null;
  };
  try {
    out = await streamAgentTurn({
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
      signal: turnAbort.signal,
    });
  } catch (e) {
    const err = e as Error;
    console.error('[chat-stream] streamAgentTurn threw uncaught', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    const friendly = `Agent crashed: ${err.message || err.name || 'unknown error'}`;
    sseError(res, friendly);
    out = {
      finalText: null,
      traceId: null,
      thinking: [],
      error: friendly,
      canceled: false,
      modelError: null,
    };
  }
  let finalText: string | null = out.finalText;
  const traceId: string | null = out.traceId;
  const thinking: ThinkingEntry[] = out.thinking;
  let errorText: string | null = out.error;
  const canceled: boolean = out.canceled;

  // Last-resort guard: if the turn ended with no text, no error, and was
  // not canceled, that's a silent failure (e.g. the agent finished without
  // emitting an `output_text` message). Surface it to the user AND log it.
  // Without this the assistant bubble renders empty + invisible and reload
  // shows only the user message.
  if (!finalText?.trim() && !errorText && !canceled) {
    // Prefer the captured upstream error if the fetch shim saw a non-2xx.
    // This is the case where the SDK eats a 400/503/etc and returns
    // an empty stream silently.
    const me = out.modelError;
    const fallback = me
      ? `Upstream model error ${me.code ?? `HTTP ${me.status}`}: ${me.message ?? me.bodyText.slice(0, 300)}`
      : 'The agent finished without producing a response. This usually means an upstream tool returned no usable output. Check the server logs for the turn that just ran.';
    // Loud banner — this is the silent-failure case. Dump everything we
    // know about the turn so we can diagnose WHY the agent went silent.
    console.error(
      '═══════════════════════════════════════════════════════════════',
    );
    console.error('[chat-stream] EMPTY TURN — agent produced no response');
    console.error('  conversation_id:', conversationId);
    console.error('  user_message:', JSON.stringify(lastClean.content).slice(0, 200));
    console.error('  thinking_entries:', thinking.length);
    console.error(
      '  thinking_kinds:',
      thinking.map((t) => t.kind).join(', ') || '(none)',
    );
    if (me) {
      console.error('  upstream_status:', me.status);
      console.error('  upstream_url:', me.url);
      console.error('  upstream_code:', me.code);
      console.error('  upstream_message:', me.message);
      console.error('  upstream_body:', me.bodyText.slice(0, 2000));
    } else if (thinking.length > 0) {
      console.error('  thinking_dump:', JSON.stringify(thinking, null, 2).slice(0, 4000));
    } else {
      console.error('  ⚠ NO tool calls, NO reasoning, NO captured HTTP error.');
      console.error('  Likely causes: (1) model returned 200 with empty body, (2) system prompt forbids tool use, (3) the conversation history triggered a refusal.');
    }
    console.error(
      '═══════════════════════════════════════════════════════════════',
    );
    errorText = fallback;
    sseError(res, fallback);
  }

  // Persist assistant message FIRST, then send [DONE].
  //
  // Why this order matters: the client's useChatTurn.finally fires
  // `onTurnEnd` as soon as the stream closes. ChatDock's onTurnEnd does
  // `fetch('/api/conversations/:id')` and REPLACES the messages array
  // with whatever the DB returns. If we sent [DONE] before persisting,
  // the refetch could arrive at the server BEFORE this appendMessage
  // commits — the DB returns the conversation WITHOUT the just-streamed
  // assistant, the optimistic UI bubble gets wiped, and the user sees
  // "Thinking…" replaced by an empty state where their answer should be.
  //
  // The user already waited ~30s for the LLM; the extra few ms for a DB
  // write before [DONE] is invisible and eliminates the refetch race.
  //
  // Persist when: we got real text, OR an error, OR the run was canceled
  // (so reload shows a "Canceled by the user" row instead of dropping
  // the turn silently).
  const shouldPersist =
    conversationId &&
    ((finalText && finalText.trim().length > 0) || errorText || canceled);
  if (shouldPersist) {
    try {
      await appendMessage(
        db,
        conversationId,
        'assistant',
        finalText ?? '',
        traceId ?? undefined,
        thinking,
        errorText ?? undefined,
        canceled,
      );
    } catch (e) {
      const cause = (e as { cause?: unknown }).cause as
        | { code?: string; detail?: string; hint?: string; message?: string }
        | undefined;
      console.error('[db] persist assistant message failed', {
        drizzle_message: (e as Error).message,
        pg_code: cause?.code,
        pg_detail: cause?.detail,
        pg_hint: cause?.hint,
        pg_message: cause?.message,
      });
      // Tell the client. The assistant text streamed fine but reload won't
      // show it — better to surface than to silently drop.
      sseError(
        res,
        `Reply wasn't saved (${cause?.code ?? 'db error'}). It's visible now but won't survive reload.`,
      );
    }
  }

  // Skip the [DONE] write if the client already disconnected (refresh /
  // tab close / Stop). Writing to a destroyed socket throws synchronously
  // on some Node versions and is just noise — the client doesn't care.
  if (!res.writableEnded && !res.destroyed) {
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

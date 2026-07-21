import type { Application } from 'express';
import express from 'express';
import {
  createConversation,
  deleteConversation,
  getConversationWithMessages,
  getMessageById,
  getOrCreateDockConversation,
  insertFeedback,
  listConversations,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import { handleChatStream } from '../chat-stream/index.js';
import { postMlflowAssessment } from '../lib/mlflow.js';
import type { AppDb } from '../db/index.js';

/**
 * Everything chat-related: conversations CRUD, streaming turns, and
 * thumbs-up/down feedback (which posts to MLflow as an assessment).
 */

type Deps = {
  db: AppDb;
  appConfig: {
    /** MAS endpoint name. Template demo registers `ask_mas` against
     * this; if your demo uses Genie, replace with `genieSpaceId` here
     * and in refundops.ts. See server/agent/tools/{mas,genie}.ts. */
    masEndpointName: string;
    agentModel?: string;
  };
};

export function registerChatRoutes(app: Application, deps: Deps): void {
  const { db, appConfig } = deps;

  // --- Conversations CRUD -------------------------------------------------
  app.get('/api/conversations', async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const rows = await listConversations(db, userEmail);
    res.json(rows);
  });

  // GET /api/dock-conversation — resolve or create the floating-dock
  // conversation for the current user. Idempotent; survives reload.
  app.get('/api/dock-conversation', async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const convo = await getOrCreateDockConversation(db, userEmail);
    res.json(convo);
  });

  app.post('/api/conversations', express.json(), async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const title = (req.body?.title as string) ?? 'New conversation';
    const convo = await createConversation(db, userEmail, title);
    res.json(convo);
  });

  app.get('/api/conversations/:id', async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const result = await getConversationWithMessages(db, userEmail, req.params.id);
    if (!result) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(result);
  });

  app.delete('/api/conversations/:id', async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const ok = await deleteConversation(db, userEmail, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Streaming chat turn ------------------------------------------------
  app.post('/api/chat/stream', express.json(), async (req, res) => {
    await handleChatStream({
      req,
      res,
      db,
      config: appConfig,
    });
  });

  // --- Thumbs-up / thumbs-down → MLflow assessment + local audit ---------
  app.post('/api/messages/:id/feedback', express.json(), async (req, res) => {
    const userEmail = getCurrentUserEmail(req);
    const value = (req.body?.value as 'up' | 'down') ?? null;
    const rationale = (req.body?.rationale as string | undefined) ?? undefined;
    if (value !== 'up' && value !== 'down') {
      res.status(400).json({ error: 'value must be "up" or "down"' });
      return;
    }
    const msg = await getMessageById(db, req.params.id);
    if (!msg) {
      res.status(404).json({ error: 'message not found' });
      return;
    }
    let mlflowAssessmentId: string | null = null;
    const host = (process.env.DATABRICKS_HOST ?? '').replace(/\/$/, '');
    if (msg.traceId && host) {
      mlflowAssessmentId = await postMlflowAssessment({
        req,
        host,
        traceId: msg.traceId,
        userEmail,
        value,
        rationale,
      });
    }
    const row = await insertFeedback(db, {
      messageId: req.params.id,
      userEmail,
      value,
      rationale,
      traceId: msg.traceId,
      mlflowAssessmentId,
    });
    res.json({ ok: true, id: row.id, mlflowAssessmentId });
  });
}

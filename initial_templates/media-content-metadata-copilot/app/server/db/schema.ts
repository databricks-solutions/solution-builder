import {
  text,
  timestamp,
  date,
  uuid,
  integer,
  doublePrecision,
  jsonb,
  pgSchema,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Lakebase schema, under `app.*`.
 *
 * Two groups:
 *   1. Chat state   (conversations, messages, feedback) — the dock agent's
 *                   reload-safe history (thinking + error columns included).
 *   2. Library      (titles, title_scenes) — the title library mirrored from
 *                   Delta by db/sync.ts at boot / on "Reset demo", plus the
 *                   write surface: each title row carries its LIVE metadata, the
 *                   AI proposal, the latest re-tag run, the editor decision and an
 *                   append-only audit_trail (every AI run + human decision).
 *
 * Why Lakebase: transactional Postgres semantics sitting next to the
 * lakehouse, with Unity Catalog governance. Lets the agent do real
 * transactional writes while the analytics layer still queries Delta.
 */
export const appSchema = pgSchema('app');

// ============================================================================
// Chat state
// ============================================================================

export const conversations = appSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userEmail: text('user_email').notNull(),
    title: text('title').notNull(),
    // 'default' for regular chats, 'demo_dock' for the floating dock's
    // persistent conversation (one per user).
    kind: text('kind', { enum: ['default', 'demo_dock'] })
      .notNull()
      .default('default'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversations_user_idx').on(t.userEmail, t.updatedAt),
    index('conversations_kind_idx').on(t.userEmail, t.kind),
  ],
);

export const messages = appSchema.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    position: integer('position').notNull(),
    traceId: text('trace_id'),
    // Captured reasoning steps (tool calls, outputs, intermediate messages)
    // for assistant messages. Shape matches client's ThinkingEvent union.
    thinking: jsonb('thinking').$type<ThinkingEntry[]>().notNull().default([]),
    // If the agent run failed, the error message is persisted here so a
    // page reload still shows what went wrong (instead of an empty bubble).
    error: text('error'),
    // True when the turn was stopped by the user (Stop button or page
    // navigation away from an in-flight stream). The assistant's partial
    // streamed content is still kept in `content` for context; the UI
    // renders a "Canceled by the user" banner below it.
    canceled: boolean('canceled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Unique on (conversation_id, position) so the `SELECT MAX + 1` race in
    // appendMessage surfaces as a constraint error (caller retries) instead
    // of silently inserting two messages at the same position — which
    // would break the on-reload ordering. Doubles as the lookup index.
    uniqueIndex('messages_convo_pos_uq').on(t.conversationId, t.position),
  ],
);

export const feedback = appSchema.table(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    value: text('value', { enum: ['up', 'down'] }).notNull(),
    rationale: text('rationale'),
    traceId: text('trace_id'),
    mlflowAssessmentId: text('mlflow_assessment_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('feedback_message_idx').on(t.messageId)],
);

// ============================================================================
// Delta mirror — the title library (current metadata + AI proposal + engagement)
// Delta (media_advertising.content_metadata_copilot.gold_title_scorecard) is the
// source of truth; this is the writable OLTP copy the workbench + agent read and
// write. Synced once at boot by db/sync.ts; "Reset demo" re-syncs.
// ============================================================================

export const titles = appSchema.table(
  'titles',
  {
    id: text('id').primaryKey(), // title_id, e.g. TTL-HB-0117
    title: text('title').notNull(),
    contentType: text('content_type').notNull(),
    releaseYear: integer('release_year'),
    runtimeMin: integer('runtime_min'),
    source: text('source').notNull(),
    studio: text('studio'),
    maturityRating: text('maturity_rating'),
    acquiredDate: date('acquired_date'),
    licenseCostUsd: doublePrecision('license_cost_usd'),
    primaryGenre: text('primary_genre'),
    /** LIVE metadata — what drives rows, search and recommendations. */
    meta: jsonb('meta').$type<TitleMetadata>().notNull(),
    /** AI proposal computed in Delta by the setup job (ai_query + taxonomy mapping). */
    ai: jsonb('ai').$type<AiProposal | null>(),
    /** Last-4-week engagement + peer benchmark. */
    impressions4w: integer('impressions_4w').notNull().default(0),
    playStarts4w: integer('play_starts_4w').notNull().default(0),
    completionRate4w: doublePrecision('completion_rate_4w'),
    peerImpressions4w: integer('peer_impressions_4w'),
    peerCompletionRate4w: doublePrecision('peer_completion_rate_4w'),
    hiddenGem: boolean('hidden_gem').notNull().default(false),
    safetyRisk: boolean('safety_risk').notNull().default(false),
    retagPriority: doublePrecision('retag_priority'),
    /** Workflow: needs_review → proposal_ready → approved | rejected. */
    status: text('status', { enum: ['needs_review', 'proposal_ready', 'approved', 'rejected'] })
      .notNull()
      .default('needs_review'),
    /** Latest AI re-tag run (diff, checks, standards guidance, similar titles, rationale). */
    proposal: jsonb('proposal').$type<RetagProposal | null>(),
    proposedAt: timestamp('proposed_at', { withTimezone: true }),
    /** Metadata as it was before the editor approved a change (for the audit trail + reset). */
    originalMeta: jsonb('original_meta').$type<TitleMetadata | null>(),
    decision: text('decision'), // APPROVED | REJECTED
    decisionNotes: text('decision_notes'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Append-only audit trail: every AI run + human decision. */
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('titles_source_idx').on(t.source),
    index('titles_status_idx').on(t.status),
    index('titles_priority_idx').on(t.retagPriority),
  ],
);

export const titleScenes = appSchema.table(
  'title_scenes',
  {
    id: text('id').primaryKey(), // scene_id
    titleId: text('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    sceneNo: integer('scene_no').notNull(),
    startTc: text('start_tc'),
    endTc: text('end_tc'),
    episode: text('episode'),
    description: text('description').notNull(),
  },
  (t) => [index('title_scenes_title_idx').on(t.titleId)],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type TitleMetadata = {
  genres: string[];
  moods: string[];
  themes: string[];
  content_warnings: string[];
  warnings_reviewed: boolean;
  talent: string[];
  keywords: string[];
  synopsis: string;
  collections: string[];
  brand_safety_tier: string;
  completeness_score: number;
  tagged_by: string;
  last_tagged_date: string | null;
};

export type WarningEvidence = { warning: string; scene_no: number; evidence: string };

export type AiProposal = {
  genres: string[];
  moods: string[];
  themes: string[];
  content_warnings: string[];
  warning_evidence: WarningEvidence[];
  keywords: string[];
  synopsis: string;
  setting: string;
  talent: string[];
  brand_safety_tier: string;
  completeness_score: number;
  confidence: number | null;
  promo_clip_scene_no: number | null;
  promo_clip_reason: string | null;
  model: string;
};

export type FieldChange = { field: string; label: string; before: string[] | string; after: string[] | string; added: string[]; removed: string[] };

export type RetagProposal = {
  proposed: TitleMetadata;
  changes: FieldChange[];
  checks: Array<{ id: string; label: string; result: 'PASS' | 'FIX' | 'FLAG'; finding: string; rule: string }>;
  rows_gained: string[];
  rows_lost: string[];
  rating_before: string | null;
  rating_after: string | null;
  projected_impressions_4w: number;
  pilot_multiplier: number;
  similar: Array<{ title_id: string; title: string; source: string; primary_genre: string | null; impressions_4w: number; completeness: number; score: number }>;
  standards: { question: string; answer: string; source: string } | null;
  summary: string;
  why_underperforming: string;
  ad_ops_note: string | null;
  model: string;
  generated_at: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'ai_retag' | 'approved' | 'rejected' | 'edited' | 'note';
  notes?: string;
  tool?: string;
  before?: Partial<TitleMetadata>;
  after?: Partial<TitleMetadata>;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };

import {
  text,
  timestamp,
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
 *   2. IROPS desk   (flights, options, passengers, hotels, guardrails) — the
 *                   Winter Storm Harlan disruption mirrored from Delta by
 *                   db/sync.ts, plus the write surface: each flight carries the
 *                   latest re-accommodation plan, its approval state and an
 *                   append-only audit trail; seats + hotel rooms decrement on commit.
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
// Delta mirror — Winter Storm Harlan (retail_consumer_goods.travel_disruption_copilot).
// Delta is the source of truth; this is the writable OLTP copy the IROPS desk
// + agent read and write. Synced once at boot by db/sync.ts; "Reset demo"
// re-syncs. Every committed plan is ALSO written back to Delta
// (rebooking_plans + rebooking_decisions) for the dashboard / Genie.
// ============================================================================

export const flights = appSchema.table(
  'flights',
  {
    id: text('id').primaryKey(), // e.g. AE1418-0213
    flightNumber: text('flight_number').notNull(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    destinationCity: text('destination_city'),
    schedDep: text('sched_dep').notNull(), // local ISO, no tz
    schedArr: text('sched_arr').notNull(),
    aircraft: text('aircraft'),
    seats: integer('seats'),
    cancelReason: text('cancel_reason'),
    euUk261: text('eu_uk_261'),
    /** unplanned → plan_drafted → awaiting_approval → committed */
    status: text('status', { enum: ['unplanned', 'plan_drafted', 'awaiting_approval', 'committed'] })
      .notNull()
      .default('unplanned'),
    plan: jsonb('plan').$type<ReaccomPlan | null>(),
    planUpdatedAt: timestamp('plan_updated_at', { withTimezone: true }),
    approvalNote: text('approval_note'),
    approvedBy: text('approved_by'),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    auditTrail: jsonb('audit_trail').$type<AuditEntry[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('flights_status_idx').on(t.status)],
);

export const options = appSchema.table(
  'options',
  {
    id: text('id').primaryKey(),
    flightId: text('flight_id').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    optionType: text('option_type').notNull(),
    carrier: text('carrier').notNull(),
    label: text('label').notNull(),
    depart: text('depart').notNull(),
    arrive: text('arrive').notNull(),
    arrivalAirport: text('arrival_airport').notNull(),
    seatsProtected: integer('seats_protected').notNull(),
    seatsRemaining: integer('seats_remaining').notNull(),
    costPerSeat: doublePrecision('cost_per_seat').notNull().default(0),
    isPartner: boolean('is_partner').notNull().default(false),
    sameDay: boolean('same_day').notNull().default(false),
    nearbyAirport: boolean('nearby_airport').notNull().default(false),
    acceptsUmnr: boolean('accepts_umnr').notNull().default(true),
    delayHours: doublePrecision('delay_hours').notNull().default(0),
  },
  (t) => [index('options_flight_idx').on(t.flightId)],
);

export const passengers = appSchema.table(
  'passengers',
  {
    id: text('id').primaryKey(), // pax_id
    pnr: text('pnr').notNull(),
    flightId: text('flight_id').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    age: integer('age'),
    tier: text('tier').notNull(),
    cabin: text('cabin'),
    fareBrand: text('fare_brand'),
    originType: text('origin_type'),
    awayFromHome: boolean('away_from_home').notNull().default(false),
    homeCity: text('home_city'),
    finalDestination: text('final_destination'),
    onwardFlight: text('onward_flight'),
    onwardDep: text('onward_dep'),
    onwardLongHaul: boolean('onward_long_haul').notNull().default(false),
    ssr: text('ssr').notNull().default(''),
    partySize: integer('party_size').notNull().default(1),
    language: text('language'),
    channel: text('channel'),
    euUk261: text('eu_uk_261'),
    // AutoProtect's hold (the baseline)
    apOptionId: text('ap_option_id'),
    apLabel: text('ap_label'),
    apArrive: text('ap_arrive'),
    apSameDay: boolean('ap_same_day').notNull().default(false),
    apNights: integer('ap_nights').notNull().default(0),
    apMisconnect: boolean('ap_misconnect').notNull().default(false),
    apSplit: boolean('ap_split').notNull().default(false),
    // ML (detractor_risk_model@champion batch scores)
    pSameDay: doublePrecision('p_same_day'),
    pNextDay: doublePrecision('p_next_day'),
    pAutoprotect: doublePrecision('p_autoprotect'),
    // AI Functions over the passenger's latest message
    message: text('message'),
    messageEnglish: text('message_english'),
    messageIntent: text('message_intent'),
    messageUrgency: text('message_urgency'),
    messageSentiment: text('message_sentiment'),
    messageSummary: text('message_summary'),
    escalated: boolean('escalated').notNull().default(false),
    // The desk's committed rebooking
    deskOptionId: text('desk_option_id'),
    deskLabel: text('desk_label'),
    deskHotelId: text('desk_hotel_id'),
    deskCommittedAt: timestamp('desk_committed_at', { withTimezone: true }),
  },
  (t) => [index('passengers_flight_idx').on(t.flightId), index('passengers_pnr_idx').on(t.pnr)],
);

export const hotels = appSchema.table('hotels', {
  id: text('id').primaryKey(),
  airport: text('airport').notNull(),
  name: text('name').notNull(),
  roomsTotal: integer('rooms_total').notNull(),
  roomsRemaining: integer('rooms_remaining').notNull(),
  accessibleRooms: integer('accessible_rooms').notNull().default(0),
  rate: doublePrecision('rate').notNull(),
  shuttleMinutes: integer('shuttle_minutes'),
});

export const guardrails = appSchema.table('guardrails', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  value: doublePrecision('value').notNull(),
  unit: text('unit'),
  description: text('description'),
});

// ============================================================================
// JSONB shapes
// ============================================================================

export type Priority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';

export type Assignment = {
  pax_id: string;
  pnr: string;
  name: string;
  priority: Priority;
  priority_reason: string;
  option_id: string;
  label: string;
  depart: string;
  arrive: string;
  arrival_airport: string;
  same_day: boolean;
  nights: number;
  delay_hours: number;
  is_partner: boolean;
  partner_cost: number;
  hotel_id: string | null;
  hotel_name: string | null;
  meal_usd: number;
  misconnect: boolean;
  cost_usd: number;
  p_detractor: number | null;
  note: string | null;
  ap: { label: string | null; same_day: boolean; nights: number; misconnect: boolean; split: boolean };
};

export type PlanMetrics = {
  pax: number;
  same_day: number;
  overnight: number;
  day_plus_2: number;
  priority_pax: number;
  priority_same_day: number;
  special_assistance_overnight: number;
  umnr_overnight: number;
  onward_pax: number;
  misconnects: number;
  split_parties: number;
  partner_seats: number;
  partner_spend: number;
  hotel_rooms: number;
  hotel_cost: number;
  meal_cost: number;
  misconnect_cost: number;
  goodwill_cost: number;
  total_cost: number;
  cost_per_pax: number;
  predicted_detractor_rate: number | null;
};

export type GuardrailCheck = { rule_id: string; name: string; status: 'ok' | 'approval' | 'exempt' | 'exception'; detail: string };

export type Notification = { pnr: string; names: string; channel: string; language: string; text: string; personalized: boolean };

export type ReaccomPlan = {
  plan_id: string;
  flight_id: string;
  flight_number: string;
  generated_at: string;
  drafted_by: string;
  assignments: Assignment[];
  metrics: PlanMetrics;
  autoprotect: PlanMetrics;
  guardrails: GuardrailCheck[];
  requires_approval: boolean;
  approval_reasons: string[];
  released_seats: Array<{ option_id: string; label: string; seats: number; why: string }>;
  policy_guidance: { question: string; answer: string; sources: string[] } | null;
  summary: string;
  notifications: Notification[];
  model: string;
};

export type AuditEntry = {
  at: string;
  by: string;
  action: 'plan_drafted' | 'submitted' | 'approved' | 'sent_back' | 'committed' | 'note';
  notes?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };

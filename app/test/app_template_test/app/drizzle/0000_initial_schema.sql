-- Initial Lakebase schema for the app template — matches server/db/schema.ts.
--
-- Three groups of tables:
--   1. Chat state    (conversations, messages, feedback) — reuse as-is.
--   2. Delta mirror  (customers, orders, returns, customer_premium) —
--                    domain-shaped for the LuxeBeauty example; reshape
--                    when forking to a different demo.
--   3. Indexes       — colocated at the bottom of each table block.
--
-- When schema.ts changes, regenerate this file:
--   1) `rm -rf drizzle/* drizzle/meta/`
--   2) `npm run db:generate`
-- Keep this as a single migration — the template re-ships fresh per fork,
-- so evolution-through-additive-migrations adds no value.

CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint

-- ─── Chat state ────────────────────────────────────────────────────────────

CREATE TABLE "app"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_email" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "app"."conversations" USING btree ("user_email","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_kind_idx" ON "app"."conversations" USING btree ("user_email","kind");
--> statement-breakpoint

CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"position" integer NOT NULL,
	"trace_id" text,
	"thinking" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"canceled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Unique on (conversation_id, position) so the SELECT MAX+1 race in
-- appendMessage surfaces as a 23505 and the caller retries — instead of
-- silently inserting two messages at the same position.
CREATE UNIQUE INDEX "messages_convo_pos_uq" ON "app"."messages" USING btree ("conversation_id","position");
--> statement-breakpoint

CREATE TABLE "app"."feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"user_email" text NOT NULL,
	"value" text NOT NULL,
	"rationale" text,
	"trace_id" text,
	"mlflow_assessment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."feedback" ADD CONSTRAINT "feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "app"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_message_idx" ON "app"."feedback" USING btree ("message_id");
--> statement-breakpoint

-- ─── Delta mirror ──────────────────────────────────────────────────────────

CREATE TABLE "app"."customers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"region" text,
	"country" text,
	"city" text,
	-- City-anchored coords (anchor + ~5km jitter from the synth script).
	-- Drives the Operations bubble map: per-city circles sized by COUNT(*).
	"customer_lat" double precision,
	"customer_lng" double precision,
	"loyalty_tier" text,
	-- CS hand-tag, pass-through from bronze. NULL = "never reviewed".
	-- The premium classifier in spec 03-ml-premium.md trains only on the
	-- labeled rows and predicts on the NULL ones.
	"premium_status" text,
	"registration_date" date
);
--> statement-breakpoint

-- Read-only mirror of the ML predictions table
-- (gold_customer_premium_predictions, written by the notebook in spec
-- 03-ml-premium.md). The app never calls the model directly — agent
-- tools (`find_lot_premium_breakdown`, the per-row JOIN inside
-- `process_return_batch`) read from here so hot-path lookups are sub-ms.
CREATE TABLE "app"."customer_premium" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"premium_prob" double precision NOT NULL,
	"final_tier" text NOT NULL,
	-- Pass-through CS tag; also lives on customers.premium_status —
	-- duplicated here for single-table reads from the agent's tools.
	"premium_status_labeled" text,
	"predicted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "customer_premium_tier_idx" ON "app"."customer_premium" USING btree ("final_tier");
--> statement-breakpoint

CREATE TABLE "app"."orders" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text,
	"order_date" date,
	"region" text,
	"total_usd" double precision,
	"status" text
);
--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "app"."orders" USING btree ("customer_id","order_date");
--> statement-breakpoint

CREATE TABLE "app"."returns" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"customer_id" text,
	"return_date" date,
	"order_date" date,
	"refund_amount_usd" double precision NOT NULL,
	"return_reason" text,
	"return_reason_text" text,
	-- Anger score from ai_classify(return_reason_text) in SDP. 1.0=angry,
	-- 0.5=neutral, 0.0=benign. Operations queue is sortable by this.
	"anger_score" double precision,
	"product_id" text,
	"product_name" text,
	"category" text,
	"lot_id" text,
	"facility" text,
	"region" text,
	"status" text DEFAULT 'pending' NOT NULL,
	-- Percent-off coupon the agent's bulk tool applied — picked by tier
	-- (20 for premium, 5 for standard). NULL until the bulk tool runs.
	-- Operations table shows it as a badge so the queue tells the tiering
	-- story even after the chat session is closed.
	"coupon_pct_applied" integer,
	-- Append-only correspondence timeline: { at, direction, from?, to?, subject, body }.
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	-- Append-only audit trail: { at, by, action, notes?, tool? }.
	"ai_audit_trail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."returns" ADD CONSTRAINT "returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "returns_status_idx" ON "app"."returns" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "returns_lot_idx" ON "app"."returns" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "returns_customer_idx" ON "app"."returns" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "returns_product_idx" ON "app"."returns" USING btree ("product_id");

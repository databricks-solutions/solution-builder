CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_email" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."customers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"region" text,
	"loyalty_tier" text,
	"registration_date" date
);
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
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"position" integer NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
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
CREATE TABLE "app"."returns" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"customer_id" text,
	"return_date" date,
	"order_date" date,
	"refund_amount_usd" double precision NOT NULL,
	"return_reason" text,
	"return_reason_text" text,
	"product_id" text,
	"product_name" text,
	"category" text,
	"lot_id" text,
	"facility" text,
	"region" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_audit_trail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."feedback" ADD CONSTRAINT "feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "app"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."returns" ADD CONSTRAINT "returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "app"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "app"."conversations" USING btree ("user_email","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_kind_idx" ON "app"."conversations" USING btree ("user_email","kind");--> statement-breakpoint
CREATE INDEX "feedback_message_idx" ON "app"."feedback" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_convo_idx" ON "app"."messages" USING btree ("conversation_id","position");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "app"."orders" USING btree ("customer_id","order_date");--> statement-breakpoint
CREATE INDEX "returns_status_idx" ON "app"."returns" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "returns_lot_idx" ON "app"."returns" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "returns_customer_idx" ON "app"."returns" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "returns_product_idx" ON "app"."returns" USING btree ("product_id");
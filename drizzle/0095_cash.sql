CREATE TYPE "public"."cash_basis" AS ENUM('paid', 'booked');--> statement-breakpoint
CREATE TYPE "public"."cash_direction" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."cash_entry_status" AS ENUM('open', 'booked', 'reversed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cash_source_role" AS ENUM('receivable', 'refund', 'retention');--> statement-breakpoint
CREATE TYPE "public"."cash_tag_direction" AS ENUM('income', 'expense', 'both');--> statement-breakpoint
CREATE TYPE "public"."cash_tag_meaning" AS ENUM('opening', 'deposit', 'donation', 'lending');--> statement-breakpoint
CREATE TYPE "public"."cash_year_action" AS ENUM('close', 'reopen');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'cash:report';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'cash:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'cash:manage';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'cash:cancel';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'cash:lending';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'cash:reopen';--> statement-breakpoint
CREATE TABLE "cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" "cash_direction" NOT NULL,
	"booking_date" date NOT NULL,
	"paid_date" date,
	"status" "cash_entry_status" NOT NULL,
	"reverses_entry_id" uuid,
	"original_booking_date" date,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text,
	"receipt_ref" text,
	"event_id" uuid,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"donation_id" uuid,
	"lending_loan_id" uuid,
	"source_role" "cash_source_role",
	CONSTRAINT "cash_entries_paid_date_check" CHECK ("cash_entries"."status" NOT IN ('booked','reversed') OR "cash_entries"."paid_date" IS NOT NULL),
	CONSTRAINT "cash_entries_one_source_check" CHECK (NOT ("cash_entries"."donation_id" IS NOT NULL AND "cash_entries"."lending_loan_id" IS NOT NULL)),
	CONSTRAINT "cash_entries_source_role_check" CHECK (("cash_entries"."source_role" IS NOT NULL) = ("cash_entries"."lending_loan_id" IS NOT NULL)),
	CONSTRAINT "cash_entries_reverses_booked_check" CHECK ("cash_entries"."reverses_entry_id" IS NULL OR "cash_entries"."status" = 'booked')
);
--> statement-breakpoint
CREATE TABLE "cash_entry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"description" text,
	CONSTRAINT "cash_entry_items_amount_check" CHECK ("cash_entry_items"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "cash_fiscal_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"label" text NOT NULL,
	"basis" "cash_basis" DEFAULT 'paid' NOT NULL,
	"end_balance" numeric(12, 2),
	"open_count" integer,
	"open_total" numeric(12, 2),
	"closed_at" timestamp with time zone,
	CONSTRAINT "cash_fiscal_years_range_check" CHECK ("cash_fiscal_years"."end_date" >= "cash_fiscal_years"."start_date")
);
--> statement-breakpoint
CREATE TABLE "cash_item_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"direction" "cash_tag_direction" NOT NULL,
	"meaning" "cash_tag_meaning",
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "cash_year_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year_id" uuid NOT NULL,
	"action" "cash_year_action" NOT NULL,
	"by" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"carried_count" integer,
	"end_balance" numeric(12, 2),
	"open_count" integer,
	"open_total" numeric(12, 2)
);
--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_reverses_entry_id_cash_entries_id_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."cash_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_lending_loan_id_lending_loans_id_fk" FOREIGN KEY ("lending_loan_id") REFERENCES "public"."lending_loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entry_items" ADD CONSTRAINT "cash_entry_items_entry_id_cash_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."cash_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_item_tags" ADD CONSTRAINT "cash_item_tags_item_id_cash_entry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."cash_entry_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_item_tags" ADD CONSTRAINT "cash_item_tags_tag_id_cash_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."cash_tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_tags" ADD CONSTRAINT "cash_tags_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_year_log" ADD CONSTRAINT "cash_year_log_year_id_cash_fiscal_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."cash_fiscal_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_year_log" ADD CONSTRAINT "cash_year_log_by_user_id_fk" FOREIGN KEY ("by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_entries_reverses_idx" ON "cash_entries" USING btree ("reverses_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_entries_donation_idx" ON "cash_entries" USING btree ("donation_id") WHERE "cash_entries"."status" NOT IN ('cancelled','reversed');--> statement-breakpoint
CREATE UNIQUE INDEX "cash_entries_receivable_idx" ON "cash_entries" USING btree ("lending_loan_id") WHERE "cash_entries"."status" NOT IN ('cancelled','reversed') AND "cash_entries"."source_role" = 'receivable';--> statement-breakpoint
CREATE INDEX "cash_entries_booking_date_idx" ON "cash_entries" USING btree ("booking_date");--> statement-breakpoint
CREATE INDEX "cash_entries_paid_date_idx" ON "cash_entries" USING btree ("paid_date");--> statement-breakpoint
CREATE INDEX "cash_entries_event_idx" ON "cash_entries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "cash_entry_items_entry_idx" ON "cash_entry_items" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_item_tags_item_tag_idx" ON "cash_item_tags" USING btree ("item_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_tags_name_idx" ON "cash_tags" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "cash_tags_meaning_idx" ON "cash_tags" USING btree ("meaning");
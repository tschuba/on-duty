ALTER TABLE "members" ADD COLUMN "first_entry_date" date;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_first_entry_date_check" CHECK ("first_entry_date" IS NULL OR "first_entry_date" <= "entry_date");--> statement-breakpoint
ALTER TABLE "anniversary_years" ADD COLUMN "kind" text NOT NULL DEFAULT 'service';--> statement-breakpoint
ALTER TABLE "anniversary_years" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "anniversary_years" DROP CONSTRAINT "anniversary_years_pkey";--> statement-breakpoint
ALTER TABLE "anniversary_years" ADD CONSTRAINT "anniversary_years_kind_year_pk" PRIMARY KEY ("kind","year");--> statement-breakpoint
ALTER TABLE "anniversary_years" ADD CONSTRAINT "anniversary_years_kind_check" CHECK ("kind" IN ('service','membership'));

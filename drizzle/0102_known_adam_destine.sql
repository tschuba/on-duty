ALTER TABLE "cash_fiscal_years" ADD COLUMN "open_income_count" integer;--> statement-breakpoint
ALTER TABLE "cash_fiscal_years" ADD COLUMN "open_income_total" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "cash_fiscal_years" ADD COLUMN "open_expense_count" integer;--> statement-breakpoint
ALTER TABLE "cash_fiscal_years" ADD COLUMN "open_expense_total" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "cash_year_log" ADD COLUMN "open_income_count" integer;--> statement-breakpoint
ALTER TABLE "cash_year_log" ADD COLUMN "open_income_total" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "cash_year_log" ADD COLUMN "open_expense_count" integer;--> statement-breakpoint
ALTER TABLE "cash_year_log" ADD COLUMN "open_expense_total" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "cash_fiscal_years" DROP COLUMN "open_count";--> statement-breakpoint
ALTER TABLE "cash_fiscal_years" DROP COLUMN "open_total";--> statement-breakpoint
ALTER TABLE "cash_year_log" DROP COLUMN "open_count";--> statement-breakpoint
ALTER TABLE "cash_year_log" DROP COLUMN "open_total";
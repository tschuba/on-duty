CREATE TYPE "public"."permission" AS ENUM('members:read', 'members:write', 'system:admin');--> statement-breakpoint
CREATE TABLE "app_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" "permission" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_app_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_role_permissions" ADD CONSTRAINT "app_role_permissions_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_app_roles" ADD CONSTRAINT "user_app_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_app_roles" ADD CONSTRAINT "user_app_roles_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_role_permissions_role_permission_idx" ON "app_role_permissions" USING btree ("role_id","permission");--> statement-breakpoint
CREATE UNIQUE INDEX "user_app_roles_user_role_idx" ON "user_app_roles" USING btree ("user_id","role_id");--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "app_role";
CREATE TABLE "app_role_member_scopes" (
	"role_id" uuid PRIMARY KEY NOT NULL,
	"statuses" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_role_member_scopes" ADD CONSTRAINT "app_role_member_scopes_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;
-- Replace text slug PK on member_roles with UUID
-- Truncates member_role_assignments first (dev env, no permanent user data yet)

ALTER TABLE "member_role_assignments" DROP CONSTRAINT "member_role_assignments_member_role_id_member_roles_id_fk";--> statement-breakpoint
TRUNCATE "member_role_assignments";--> statement-breakpoint
TRUNCATE "member_roles";--> statement-breakpoint
ALTER TABLE "member_roles" DROP CONSTRAINT "member_roles_pkey";--> statement-breakpoint
ALTER TABLE "member_roles" ALTER COLUMN "id" TYPE uuid USING gen_random_uuid();--> statement-breakpoint
ALTER TABLE "member_roles" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "member_role_assignments" ALTER COLUMN "member_role_id" TYPE uuid USING member_role_id::uuid;--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD CONSTRAINT "member_role_assignments_member_role_id_member_roles_id_fk" FOREIGN KEY ("member_role_id") REFERENCES "public"."member_roles"("id") ON DELETE no action ON UPDATE no action;

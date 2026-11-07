CREATE TABLE "event_invitees" (
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	CONSTRAINT "event_invitees_event_id_member_id_pk" PRIMARY KEY("event_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "event_invitees" ADD CONSTRAINT "event_invitees_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invitees" ADD CONSTRAINT "event_invitees_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_invitees_member_idx" ON "event_invitees" USING btree ("member_id");
CREATE TABLE IF NOT EXISTS "label_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"action" text NOT NULL,
	"did" text NOT NULL,
	"comment" text,
	"unixtimescheduled" bigint DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listItems" (
	"id" bigserial NOT NULL,
	"did" text NOT NULL,
	"listURLId" bigint NOT NULL,
	"listItemURL" text,
	"unixtimeDeleted" bigint,
	CONSTRAINT "listItems_did_listURLId_pk" PRIMARY KEY("did","listURLId"),
	CONSTRAINT "listItems_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lists" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"listURL" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_status" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"last_sequence" bigint DEFAULT -1 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listItems" ADD CONSTRAINT "listItems_listURLId_lists_id_fk" FOREIGN KEY ("listURLId") REFERENCES "public"."lists"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_idx" ON "label_actions" USING btree ("unixtimescheduled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "did_idx" ON "listItems" USING btree ("did");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "id_idx" ON "listItems" USING btree ("id");
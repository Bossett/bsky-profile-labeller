CREATE TABLE IF NOT EXISTS "label_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"action" text NOT NULL,
	"did" text NOT NULL,
	"comment" text,
	"unixtimescheduled" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"last_sequence" integer DEFAULT -1 NOT NULL
);

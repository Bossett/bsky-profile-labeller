CREATE TABLE IF NOT EXISTS "label_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"action" text,
	"did" text NOT NULL,
	"comment" text,
	"unixtimescheduled" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "new_handles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"unixtimeofchange" integer,
	"unixtimeoffirstpost" integer,
	CONSTRAINT "new_handles_name_unique" UNIQUE("name")
);

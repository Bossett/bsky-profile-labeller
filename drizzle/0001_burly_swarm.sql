CREATE TABLE IF NOT EXISTS "listItems" (
	"id" serial PRIMARY KEY NOT NULL,
	"did" text NOT NULL,
	"listURLId" integer NOT NULL,
	"listItemURL" text,
	"unixtimeCreated" integer,
	"unixtimeDeleted" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"listURL" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listItems" ADD CONSTRAINT "listItems_listURLId_lists_id_fk" FOREIGN KEY ("listURLId") REFERENCES "lists"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

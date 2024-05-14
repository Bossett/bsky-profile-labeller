/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'listItems'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

ALTER TABLE "listItems" DROP CONSTRAINT "listItems_pkey";--> statement-breakpoint
ALTER TABLE "listItems" ADD CONSTRAINT "listItems_did_listURLId_pk" PRIMARY KEY("did","listURLId");--> statement-breakpoint
ALTER TABLE "listItems" DROP COLUMN IF EXISTS "unixtimeCreated";--> statement-breakpoint
ALTER TABLE "listItems" ADD CONSTRAINT "listItems_id_unique" UNIQUE("id");
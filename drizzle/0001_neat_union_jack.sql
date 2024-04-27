ALTER TABLE "new_handles" RENAME COLUMN "name" TO "did";--> statement-breakpoint
ALTER TABLE "new_handles" DROP CONSTRAINT "new_handles_name_unique";--> statement-breakpoint
ALTER TABLE "new_handles" ADD CONSTRAINT "new_handles_did_unique" UNIQUE("did");
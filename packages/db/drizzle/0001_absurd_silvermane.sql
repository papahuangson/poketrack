CREATE TABLE "scan_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" integer NOT NULL,
	"slot" integer NOT NULL,
	"empty" boolean DEFAULT false NOT NULL,
	"read_name" text,
	"read_number" text,
	"read_printed_total" integer,
	"read_set_code" text,
	"read_cues" jsonb,
	"confidence" real DEFAULT 0 NOT NULL,
	"box" jsonb,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen_card_id" text,
	"variant" text,
	"condition" text DEFAULT 'NM' NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"claim_manual" boolean DEFAULT false NOT NULL,
	"collection_item_id" integer,
	"claimed_from_item_id" integer,
	CONSTRAINT "scan_results_slot_range" CHECK ("scan_results"."slot" between 1 and 9)
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"image_url" text NOT NULL,
	"image_width" integer NOT NULL,
	"image_height" integer NOT NULL,
	"binder" text NOT NULL,
	"page" integer NOT NULL,
	"status" text DEFAULT 'reading' NOT NULL,
	"error" text,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_chosen_card_id_cards_id_fk" FOREIGN KEY ("chosen_card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_collection_item_id_collection_items_id_fk" FOREIGN KEY ("collection_item_id") REFERENCES "public"."collection_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_claimed_from_item_id_collection_items_id_fk" FOREIGN KEY ("claimed_from_item_id") REFERENCES "public"."collection_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_results_scan_slot" ON "scan_results" USING btree ("scan_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "scans_one_committed_page" ON "scans" USING btree (lower(trim("binder")),"page") WHERE "scans"."status" = 'committed';
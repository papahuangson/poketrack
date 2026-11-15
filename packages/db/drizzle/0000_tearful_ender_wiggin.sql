CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"game" text DEFAULT 'pokemon' NOT NULL,
	"name" text NOT NULL,
	"name_search" text NOT NULL,
	"set_id" text NOT NULL,
	"number" text NOT NULL,
	"printed_total" integer NOT NULL,
	"rarity" text,
	"image_small" text,
	"image_large" text,
	"legalities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reprint_key" text DEFAULT '' NOT NULL,
	"variants" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"variant" text NOT NULL,
	"condition" text DEFAULT 'NM' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"paid_usd" numeric(10, 2),
	"acquired_on" date,
	"source" text DEFAULT 'manual' NOT NULL,
	"binder" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"run_date" date NOT NULL,
	"runner" text NOT NULL,
	"git_sha" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"card_id" text NOT NULL,
	"variant" text NOT NULL,
	"date" date NOT NULL,
	"market_usd" numeric(10, 2),
	"low_usd" numeric(10, 2),
	"cardmarket_trend_eur" numeric(10, 2),
	CONSTRAINT "price_snapshots_card_id_variant_date_pk" PRIMARY KEY("card_id","variant","date")
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"series" text NOT NULL,
	"printed_total" integer NOT NULL,
	"release_date" date NOT NULL,
	"ptcgo_code" text,
	"symbol_url" text,
	"provider_updated_at" text
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"card_id" text NOT NULL,
	"variant" text NOT NULL,
	"note" text,
	CONSTRAINT "watchlist_card_id_variant_pk" PRIMARY KEY("card_id","variant")
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_name_search_trgm" ON "cards" USING gin ("name_search" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "cards_set_id" ON "cards" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "cards_reprint_key" ON "cards" USING btree ("reprint_key");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_lot" ON "collection_items" USING btree ("card_id","variant","condition",coalesce("binder", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_job_date" ON "job_runs" USING btree ("job","run_date");
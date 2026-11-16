import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  real,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import type { Candidate, Condition, Decision, Runner, RunStatus, ScanStatus, SlotBox, SlotCues } from "./constants"

const usd = (name: string) => numeric(name, { precision: 10, scale: 2, mode: "number" })

const sets = pgTable("sets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  series: text("series").notNull(),
  printedTotal: integer("printed_total").notNull(),
  releaseDate: date("release_date", { mode: "string" }).notNull(),
  ptcgoCode: text("ptcgo_code"),
  symbolUrl: text("symbol_url"),
  providerUpdatedAt: text("provider_updated_at"),
})

const cards = pgTable(
  "cards",
  {
    id: text("id").primaryKey(),
    game: text("game").notNull().default("pokemon"),
    name: text("name").notNull(),
    nameSearch: text("name_search").notNull(),
    setId: text("set_id")
      .notNull()
      .references(() => sets.id),
    number: text("number").notNull(),
    printedTotal: integer("printed_total").notNull(),
    rarity: text("rarity"),
    imageSmall: text("image_small"),
    imageLarge: text("image_large"),
    legalities: jsonb("legalities").$type<Record<string, string>>().notNull().default({}),
    reprintKey: text("reprint_key").notNull().default(""),
    variants: text("variants").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    index("cards_name_search_trgm").using("gin", sql`${t.nameSearch} gin_trgm_ops`),
    index("cards_set_id").on(t.setId),
    index("cards_reprint_key").on(t.reprintKey),
  ],
)

const collectionItems = pgTable(
  "collection_items",
  {
    id: serial("id").primaryKey(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    variant: text("variant").notNull(),
    condition: text("condition").$type<Condition>().notNull().default("NM"),
    quantity: integer("quantity").notNull().default(1),
    paidUsd: usd("paid_usd"),
    acquiredOn: date("acquired_on", { mode: "string" }),
    source: text("source").$type<"manual" | "scan">().notNull().default("manual"),
    binder: text("binder"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("collection_items_lot").on(t.cardId, t.variant, t.condition, sql`coalesce(${t.binder}, '')`),
  ],
)

const watchlist = pgTable(
  "watchlist",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    variant: text("variant").notNull(),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.variant] })],
)

const priceSnapshots = pgTable(
  "price_snapshots",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    variant: text("variant").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    marketUsd: usd("market_usd"),
    lowUsd: usd("low_usd"),
    cardmarketTrendEur: usd("cardmarket_trend_eur"),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.variant, t.date] })],
)

const jobRuns = pgTable(
  "job_runs",
  {
    id: serial("id").primaryKey(),
    job: text("job").notNull(),
    runDate: date("run_date", { mode: "string" }).notNull(),
    runner: text("runner").$type<Runner>().notNull(),
    gitSha: text("git_sha").notNull(),
    status: text("status").$type<RunStatus>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [uniqueIndex("job_runs_job_date").on(t.job, t.runDate)],
)

const scans = pgTable(
  "scans",
  {
    id: serial("id").primaryKey(),
    imageUrl: text("image_url").notNull(),
    imageWidth: integer("image_width").notNull(),
    imageHeight: integer("image_height").notNull(),
    binder: text("binder").notNull(),
    page: integer("page").notNull(),
    status: text("status").$type<ScanStatus>().notNull().default("reading"),
    error: text("error"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("scans_one_committed_page")
      .on(sql`lower(trim(${t.binder}))`, t.page)
      .where(sql`${t.status} = 'committed'`),
  ],
)

const scanResults = pgTable(
  "scan_results",
  {
    id: serial("id").primaryKey(),
    scanId: integer("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    empty: boolean("empty").notNull().default(false),
    readName: text("read_name"),
    readNumber: text("read_number"),
    readPrintedTotal: integer("read_printed_total"),
    readSetCode: text("read_set_code"),
    readCues: jsonb("read_cues").$type<SlotCues>(),
    confidence: real("confidence").notNull().default(0),
    box: jsonb("box").$type<SlotBox>(),
    candidates: jsonb("candidates").$type<Candidate[]>().notNull().default([]),
    chosenCardId: text("chosen_card_id").references(() => cards.id),
    variant: text("variant"),
    condition: text("condition").$type<Condition>().notNull().default("NM"),
    decision: text("decision").$type<Decision>().notNull().default("pending"),
    claimManual: boolean("claim_manual").notNull().default(false),
    collectionItemId: integer("collection_item_id").references(() => collectionItems.id, { onDelete: "set null" }),
    claimedFromItemId: integer("claimed_from_item_id").references(() => collectionItems.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("scan_results_scan_slot").on(t.scanId, t.slot),
    check("scan_results_slot_range", sql`${t.slot} between 1 and 9`),
  ],
)

const loginFailures = pgTable("login_failures", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
})

export { cards, collectionItems, jobRuns, loginFailures, priceSnapshots, scanResults, scans, sets, watchlist }

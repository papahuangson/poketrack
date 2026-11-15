import { sql } from "drizzle-orm"
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import type { Condition, Runner, RunStatus } from "./constants"

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

export { cards, collectionItems, jobRuns, priceSnapshots, sets, watchlist }

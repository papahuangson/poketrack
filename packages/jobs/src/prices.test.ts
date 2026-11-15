import { cards, collectionItems, priceSnapshots, watchlist, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { eq } from "drizzle-orm"
import { beforeEach, expect, test } from "vitest"
import { refreshPrices, snapshotCard } from "./prices"
import { fakeProvider, makeCard, makeSet, type FakeProvider } from "./testing/fake-provider"
import { seedCatalog } from "./testing/seed"
import type { PricedCard } from "./types"

let db: Db
let provider: FakeProvider
const date = "2026-11-15"

const priced = (id: string, marketCents: number | null, variant = "normal"): PricedCard => ({
  card: makeCard(id),
  prices: [{ cardId: id, variant, marketCents, lowCents: 100, cardmarketTrendEurCents: null }],
})

beforeEach(async () => {
  db = await createTestDb()
  await seedCatalog(db, [makeSet("a")], [makeCard("a-1"), makeCard("a-2"), makeCard("a-3")])
  provider = fakeProvider({ priced: [priced("a-1", 410), priced("a-2", 9840), priced("a-3", 55)] })
})

test("owned and watched cards are requested and snapshotted", async () => {
  await db.insert(collectionItems).values({ cardId: "a-1", variant: "normal" })
  await db.insert(watchlist).values({ cardId: "a-2", variant: "normal" })
  const result = await refreshPrices(db, provider, date)
  expect(result).toEqual({ cardsRequested: 2, snapshotsWritten: 2 })
  expect([...(provider.calls.getPrices[0] ?? [])].sort()).toEqual(["a-1", "a-2"])
  const rows = await db.select().from(priceSnapshots)
  expect(rows.find((r) => r.cardId === "a-1")).toMatchObject({ date, variant: "normal", marketUsd: 4.1, lowUsd: 1 })
  expect(rows.find((r) => r.cardId === "a-3")).toBeUndefined()
})

test("with nothing owned or watched the provider is not called", async () => {
  expect(await refreshPrices(db, provider, date)).toEqual({ cardsRequested: 0, snapshotsWritten: 0 })
  expect(provider.calls.getPrices).toEqual([])
})

test("a card owned in two conditions is requested once", async () => {
  await db.insert(collectionItems).values([
    { cardId: "a-1", variant: "normal", condition: "NM" },
    { cardId: "a-1", variant: "normal", condition: "LP" },
  ])
  expect((await refreshPrices(db, provider, date)).cardsRequested).toBe(1)
})

test("120 owned cards go to the provider in one call", async () => {
  const many = Array.from({ length: 120 }, (_, i) => makeCard(`a-${i + 100}`))
  await seedCatalog(db, [], many)
  await db.insert(collectionItems).values(many.map((c) => ({ cardId: c.id, variant: "normal" })))
  const result = await refreshPrices(db, provider, date)
  expect(result.cardsRequested).toBe(120)
  expect(provider.calls.getPrices).toHaveLength(1)
  expect(provider.calls.getPrices[0]).toHaveLength(120)
})

test("a variant with no market price gets no snapshot", async () => {
  await db.insert(collectionItems).values({ cardId: "a-1", variant: "normal" })
  provider.priced = [priced("a-1", null)]
  expect((await refreshPrices(db, provider, date)).snapshotsWritten).toBe(0)
  expect(await db.select().from(priceSnapshots)).toHaveLength(0)
})

test("every variant the provider returns is snapshotted", async () => {
  await db.insert(collectionItems).values({ cardId: "a-1", variant: "normal" })
  provider.priced = [
    {
      card: makeCard("a-1"),
      prices: [
        { cardId: "a-1", variant: "normal", marketCents: 21, lowCents: 5, cardmarketTrendEurCents: 12 },
        { cardId: "a-1", variant: "reverseHolofoil", marketCents: 56, lowCents: 20, cardmarketTrendEurCents: 48 },
      ],
    },
  ]
  await refreshPrices(db, provider, date)
  const rows = await db.select().from(priceSnapshots)
  expect(rows.map((r) => r.variant).sort()).toEqual(["normal", "reverseHolofoil"])
  expect(rows.find((r) => r.variant === "reverseHolofoil")?.cardmarketTrendEur).toBe(0.48)
})

test("running twice on the same date overwrites instead of duplicating", async () => {
  await db.insert(collectionItems).values({ cardId: "a-1", variant: "normal" })
  await refreshPrices(db, provider, date)
  provider.priced = [priced("a-1", 500)]
  await refreshPrices(db, provider, date)
  const rows = await db.select().from(priceSnapshots)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.marketUsd).toBe(5)
})

test("a refreshed card's legalities replace the stored ones", async () => {
  await db.insert(collectionItems).values({ cardId: "a-1", variant: "normal" })
  provider.priced = [{ card: makeCard("a-1", { legalities: { unlimited: "Legal", standard: "Banned" } }), prices: [] }]
  await refreshPrices(db, provider, date)
  const [card] = await db.select().from(cards).where(eq(cards.id, "a-1"))
  expect(card?.legalities).toEqual({ unlimited: "Legal", standard: "Banned" })
})

test("snapshotCard writes today's prices for one card", async () => {
  expect(await snapshotCard(db, provider, "a-2", date)).toBe(1)
  const rows = await db.select().from(priceSnapshots)
  expect(rows).toMatchObject([{ cardId: "a-2", marketUsd: 98.4 }])
})

test("snapshotCard for a card with no prices writes nothing", async () => {
  provider.priced = [{ card: makeCard("a-1"), prices: [] }]
  expect(await snapshotCard(db, provider, "a-1", date)).toBe(0)
})

test("snapshotCard for a card the provider does not return writes nothing", async () => {
  provider.priced = []
  expect(await snapshotCard(db, provider, "a-1", date)).toBe(0)
})

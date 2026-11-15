import { beforeEach, expect, test } from "vitest"
import { cards, collectionItems, jobRuns, priceSnapshots, sets, type Db } from "./index"
import { createTestDb } from "./testing"

let db: Db

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(sets).values({ id: "sv3pt5", name: "151", series: "Scarlet & Violet", printedTotal: 165, releaseDate: "2023-09-22" })
  await db.insert(cards).values({ id: "sv3pt5-199", name: "Charizard ex", nameSearch: "charizard ex", setId: "sv3pt5", number: "199", printedTotal: 165 })
})

test("a job can only have one run per date", async () => {
  const run = { job: "nightly", runDate: "2026-11-14", runner: "nas", gitSha: "abc", status: "running" } as const
  await db.insert(jobRuns).values(run)
  await expect(db.insert(jobRuns).values({ ...run, runner: "vercel" })).rejects.toThrow()
})

test("a card variant can only have one price snapshot per date", async () => {
  const snap = { cardId: "sv3pt5-199", variant: "holofoil", date: "2026-11-14", marketUsd: 98.4 }
  await db.insert(priceSnapshots).values(snap)
  await expect(db.insert(priceSnapshots).values(snap)).rejects.toThrow()
})

test("two rows for the same card, variant and condition with no binder are rejected", async () => {
  const item = { cardId: "sv3pt5-199", variant: "holofoil" }
  await db.insert(collectionItems).values(item)
  await expect(db.insert(collectionItems).values(item)).rejects.toThrow()
})

test("collection items default to NM, quantity 1, manual", async () => {
  const [row] = await db.insert(collectionItems).values({ cardId: "sv3pt5-199", variant: "holofoil" }).returning()
  expect(row).toMatchObject({ condition: "NM", quantity: 1, source: "manual" })
})

test("numeric prices read back as numbers", async () => {
  await db.insert(priceSnapshots).values({ cardId: "sv3pt5-199", variant: "holofoil", date: "2026-11-14", marketUsd: 98.4 })
  const [row] = await db.select().from(priceSnapshots)
  expect(row?.marketUsd).toBe(98.4)
})

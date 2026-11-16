import { beforeEach, expect, test } from "vitest"
import { eq } from "drizzle-orm"
import { cards, collectionItems, jobRuns, priceSnapshots, scanResults, scans, sets, type Db } from "./index"
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

const scan = { imageUrl: "https://x.public.blob.vercel-storage.com/a.jpg", imageWidth: 2000, imageHeight: 1500, binder: "Main", page: 3 }

test("two committed scans for the same binder+page violate scans_one_committed_page", async () => {
  await db.insert(scans).values({ ...scan, status: "committed" })
  await expect(db.insert(scans).values({ ...scan, status: "committed" })).rejects.toThrow()
  await expect(db.insert(scans).values({ ...scan, status: "ready" })).resolves.toBeDefined()
})

test("binder uniqueness ignores case and spaces", async () => {
  await db.insert(scans).values({ ...scan, status: "committed" })
  await expect(db.insert(scans).values({ ...scan, binder: " main ", status: "committed" })).rejects.toThrow()
})

test("scans default to reading", async () => {
  const [row] = await db.insert(scans).values(scan).returning()
  expect(row?.status).toBe("reading")
})

test("scan_results slot is unique per scan", async () => {
  const [s] = await db.insert(scans).values(scan).returning()
  await db.insert(scanResults).values({ scanId: s!.id, slot: 1 })
  await expect(db.insert(scanResults).values({ scanId: s!.id, slot: 1 })).rejects.toThrow()
})

test("scan_results slot must be 1 to 9", async () => {
  const [s] = await db.insert(scans).values(scan).returning()
  await expect(db.insert(scanResults).values({ scanId: s!.id, slot: 10 })).rejects.toThrow()
})

test("deleting a collection item nulls scan_results.collection_item_id and claimed_from_item_id", async () => {
  const [s] = await db.insert(scans).values(scan).returning()
  const [item] = await db.insert(collectionItems).values({ cardId: "sv3pt5-199", variant: "holofoil" }).returning()
  const [r] = await db
    .insert(scanResults)
    .values({ scanId: s!.id, slot: 1, collectionItemId: item!.id, claimedFromItemId: item!.id })
    .returning()
  await db.delete(collectionItems).where(eq(collectionItems.id, item!.id))
  const [after] = await db.select().from(scanResults).where(eq(scanResults.id, r!.id))
  expect(after).toMatchObject({ collectionItemId: null, claimedFromItemId: null, decision: "pending", claimManual: false, empty: false })
})

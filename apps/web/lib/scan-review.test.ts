import { collectionItems, scanResults, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { eq } from "drizzle-orm"
import { beforeEach, expect, test } from "vitest"
import { seedCards, seedScan } from "./scan-fixtures"
import { loadReview } from "./scan-review"

let db: Db
const reviewOf = async (id: number) => (await loadReview(db, id))!

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
})

test("loads the scan, its pockets in slot order, and candidate card details", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ card: "sv3pt5-199", candidates: ["sv3pt5-199", "base1-58"] }, { empty: true }] })
  const review = await reviewOf(scanId)
  expect(review.scan).toMatchObject({ id: scanId, binder: "Main", page: 3, status: "ready", width: 2000, height: 1500 })
  expect(review.slots.map((s) => s.slot)).toEqual([1, 2])
  expect(review.slots[0]?.chosen).toMatchObject({ id: "sv3pt5-199", name: "Charizard ex", setName: "151", number: "199", printedTotal: 165 })
  expect(review.slots[0]?.candidates.map((c) => [c.cardId, c.name])).toEqual([["sv3pt5-199", "Charizard ex"], ["base1-58", "Pikachu"]])
  expect(review.slots[1]).toMatchObject({ empty: true, chosen: null })
})

test("manualLot.available subtracts the other pockets in this scan that claim it", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", quantity: 1 })
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58", claimManual: true }, { card: "base1-58", claimManual: false }] })
  const { slots } = await reviewOf(scanId)
  expect(slots[0]?.manualLot).toMatchObject({ available: 1 })
  expect(slots[1]?.manualLot).toMatchObject({ available: 0 })
})

test("when two pockets claim one available copy, the second is turned off and stored", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", quantity: 1 })
  const { scanId, resultIds } = await seedScan(db, { pockets: [{ card: "base1-58", claimManual: true }, { card: "base1-58", claimManual: true }] })
  const { slots } = await reviewOf(scanId)
  expect(slots.map((s) => s.claimManual)).toEqual([true, false])
  const [stored] = await db.select().from(scanResults).where(eq(scanResults.id, resultIds[1]!))
  expect(stored?.claimManual).toBe(false)
})

test("manualLot ignores lots that have a binder and other variants", async () => {
  await db.insert(collectionItems).values([
    { cardId: "sv3pt5-199", variant: "holofoil", quantity: 1 },
    { cardId: "sv3pt5-199", variant: "normal", quantity: 1, binder: "Trades" },
  ])
  const { scanId } = await seedScan(db, { pockets: [{ card: "sv3pt5-199", variant: "normal" }] })
  expect((await reviewOf(scanId)).slots[0]?.manualLot).toBeNull()
})

test("otherPages lists committed pages holding the same card", async () => {
  await seedScan(db, { page: 2, status: "committed", pockets: [{ card: "base1-58" }] })
  await seedScan(db, { binder: "Trades", page: 1, status: "committed", pockets: [{ card: "base1-58", decision: "rejected" }] })
  await seedScan(db, { page: 3, status: "committed", pockets: [{ card: "base1-58" }] })
  const { scanId } = await seedScan(db, { page: 3, pockets: [{ card: "base1-58" }] })
  expect((await reviewOf(scanId)).slots[0]?.otherPages).toEqual([{ binder: "Main", page: 2 }])
})

test("diff against the page's previous committed scan counts cards", async () => {
  const prev = await seedScan(db, { status: "committed", pockets: [{ card: "sv3pt5-199" }, { card: "base1-58" }] })
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "sv3pt5-151" }, { empty: true }] })
  const { diff } = await reviewOf(scanId)
  expect(diff?.replaces).toMatchObject({ scanId: prev.scanId, committedAt: "2026-11-15T18:00:00.000Z" })
  expect(diff?.added.map((c) => c.name)).toEqual(["Mew ex"])
  expect(diff?.removed.map((c) => c.name)).toEqual(["Charizard ex"])
  expect(diff?.unchanged).toBe(1)
})

test("diff is null with no previous scan of the page", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  expect((await reviewOf(scanId)).diff).toBeNull()
})

test("canCommit is false while a non-empty pocket is pending, and for committed or superseded scans", async () => {
  const pending = await seedScan(db, { pockets: [{ card: "base1-58", decision: "pending" }, { empty: true }] })
  expect((await reviewOf(pending.scanId)).canCommit).toBe(false)
  const ready = await seedScan(db, { page: 4, pockets: [{ card: "base1-58" }, { empty: true }, { card: "sv3pt5-151", decision: "rejected" }] })
  expect((await reviewOf(ready.scanId)).canCommit).toBe(true)
  const committed = await seedScan(db, { page: 5, status: "committed", pockets: [{ card: "base1-58" }] })
  expect((await reviewOf(committed.scanId)).canCommit).toBe(false)
  const superseded = await seedScan(db, { page: 6, status: "superseded", pockets: [{ card: "base1-58" }] })
  expect((await reviewOf(superseded.scanId)).canCommit).toBe(false)
})

test("firstEditionNote is set from the read cues", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58", firstEdition: true }, { card: "base1-58" }] })
  expect((await reviewOf(scanId)).slots.map((s) => s.firstEditionNote)).toEqual([true, false])
})

test("an unknown scan id returns null", async () => {
  expect(await loadReview(db, 999)).toBeNull()
})

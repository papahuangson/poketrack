import { collectionItems, scanResults, scans, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { and, eq, isNull } from "drizzle-orm"
import { beforeEach, expect, test } from "vitest"
import { seedCards, seedScan } from "./scan-fixtures"
import { commitScan } from "./scan-commit"

let db: Db

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
})

const lots = async () =>
  (await db.select().from(collectionItems).orderBy(collectionItems.id)).map((l) => ({
    cardId: l.cardId,
    binder: l.binder,
    quantity: l.quantity,
    source: l.source,
  }))
const statusOf = async (id: number) => (await db.select().from(scans).where(eq(scans.id, id)))[0]?.status

test("first commit adds one copy per confirmed pocket with source scan and the scan's binder", async () => {
  const { scanId, resultIds } = await seedScan(db, { pockets: [{ card: "sv3pt5-199", variant: "holofoil" }, { card: "base1-58" }] })
  expect(await commitScan(db, scanId)).toEqual({ added: 2, replaced: false })
  expect(await lots()).toEqual([
    { cardId: "sv3pt5-199", binder: "Main", quantity: 1, source: "scan" },
    { cardId: "base1-58", binder: "Main", quantity: 1, source: "scan" },
  ])
  const results = await db.select().from(scanResults).where(eq(scanResults.scanId, scanId)).orderBy(scanResults.slot)
  expect(results.every((r) => r.collectionItemId !== null)).toBe(true)
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId))
  expect(scan?.status).toBe("committed")
  expect(scan?.committedAt).toBeInstanceOf(Date)
  expect(resultIds).toHaveLength(2)
})

test("condition comes from the pocket", async () => {
  const { scanId, resultIds } = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  await db.update(scanResults).set({ condition: "LP" }).where(eq(scanResults.id, resultIds[0]!))
  await commitScan(db, scanId)
  expect((await db.select().from(collectionItems))[0]?.condition).toBe("LP")
})

test("two pockets of the same card merge into quantity 2", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "base1-58" }] })
  await commitScan(db, scanId)
  expect(await lots()).toEqual([{ cardId: "base1-58", binder: "Main", quantity: 2, source: "scan" }])
})

test("claim moves the manual copy and carries its paid price", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", quantity: 1, paidUsd: 3 })
  const { scanId, resultIds } = await seedScan(db, { pockets: [{ card: "base1-58", claimManual: true }] })
  await commitScan(db, scanId)
  const all = await db.select().from(collectionItems)
  expect(all).toHaveLength(1)
  expect(all[0]).toMatchObject({ binder: "Main", quantity: 1, paidUsd: 3 })
  const [r] = await db.select().from(scanResults).where(eq(scanResults.id, resultIds[0]!))
  expect(r?.claimedFromItemId).toBeNull()
})

test("claim with manual quantity 2 leaves 1 behind and records where it came from", async () => {
  const [manual] = await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", quantity: 2 }).returning()
  const { scanId, resultIds } = await seedScan(db, { pockets: [{ card: "base1-58", claimManual: true }] })
  await commitScan(db, scanId)
  expect(await lots()).toEqual([
    { cardId: "base1-58", binder: null, quantity: 1, source: "manual" },
    { cardId: "base1-58", binder: "Main", quantity: 1, source: "scan" },
  ])
  const [r] = await db.select().from(scanResults).where(eq(scanResults.id, resultIds[0]!))
  expect(r?.claimedFromItemId).toBe(manual!.id)
})

test("paid price doesn't overwrite one the target lot already has", async () => {
  await db.insert(collectionItems).values([
    { cardId: "base1-58", variant: "normal", quantity: 1, paidUsd: 3 },
    { cardId: "base1-58", variant: "normal", quantity: 1, paidUsd: 9, binder: "Main", source: "scan" },
  ])
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58", claimManual: true }] })
  await commitScan(db, scanId)
  const [main] = await db.select().from(collectionItems).where(eq(collectionItems.binder, "Main"))
  expect(main).toMatchObject({ quantity: 2, paidUsd: 9 })
})

test("rescan with identical cards leaves every quantity unchanged and supersedes the old scan", async () => {
  const first = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "sv3pt5-151" }] })
  await commitScan(db, first.scanId)
  const second = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "sv3pt5-151" }] })
  expect(await commitScan(db, second.scanId)).toEqual({ added: 2, replaced: true })
  expect(await lots()).toEqual([
    { cardId: "base1-58", binder: "Main", quantity: 1, source: "scan" },
    { cardId: "sv3pt5-151", binder: "Main", quantity: 1, source: "scan" },
  ])
  expect(await statusOf(first.scanId)).toBe("superseded")
  expect(await statusOf(second.scanId)).toBe("committed")
})

test("rescan matches the page case-insensitively", async () => {
  const first = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  await commitScan(db, first.scanId)
  const second = await seedScan(db, { binder: " main ", pockets: [{ card: "base1-58" }] })
  await commitScan(db, second.scanId)
  expect(await statusOf(first.scanId)).toBe("superseded")
  expect((await lots()).reduce((n, l) => n + l.quantity, 0)).toBe(1)
})

test("rescan that drops a card removes one copy and deletes the lot at 0", async () => {
  const first = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "sv3pt5-151" }] })
  await commitScan(db, first.scanId)
  const second = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  await commitScan(db, second.scanId)
  expect(await lots()).toEqual([{ cardId: "base1-58", binder: "Main", quantity: 1, source: "scan" }])
})

test("card moved from page 2 to page 3 nets out", async () => {
  await commitScan(db, (await seedScan(db, { page: 2, pockets: [{ card: "base1-58" }] })).scanId)
  await commitScan(db, (await seedScan(db, { page: 3, pockets: [{ card: "base1-58" }] })).scanId)
  await commitScan(db, (await seedScan(db, { page: 2, pockets: [{ card: null, decision: "rejected" }] })).scanId)
  expect(await lots()).toEqual([{ cardId: "base1-58", binder: "Main", quantity: 1, source: "scan" }])
})

test("a claimed copy is not restored when its page is rescanned without it", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", quantity: 1 })
  await commitScan(db, (await seedScan(db, { pockets: [{ card: "base1-58", claimManual: true }] })).scanId)
  await commitScan(db, (await seedScan(db, { pockets: [{ card: "sv3pt5-151" }] })).scanId)
  expect(await db.select().from(collectionItems).where(and(eq(collectionItems.cardId, "base1-58"), isNull(collectionItems.binder)))).toHaveLength(0)
  expect(await lots()).toEqual([{ cardId: "sv3pt5-151", binder: "Main", quantity: 1, source: "scan" }])
})

test("a hand-lowered or hand-deleted lot clamps at 0 on rescan", async () => {
  await commitScan(db, (await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "sv3pt5-151" }] })).scanId)
  await db.update(collectionItems).set({ quantity: 0 }).where(eq(collectionItems.cardId, "base1-58"))
  await db.delete(collectionItems).where(eq(collectionItems.cardId, "sv3pt5-151"))
  await expect(commitScan(db, (await seedScan(db, { pockets: [{ card: "sv3pt5-199" }] })).scanId)).resolves.toBeDefined()
  const all = await lots()
  expect(all.every((l) => l.quantity > 0)).toBe(true)
  expect(all).toEqual([{ cardId: "sv3pt5-199", binder: "Main", quantity: 1, source: "scan" }])
})

test("rejected and empty pockets add nothing", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58", decision: "rejected" }, { empty: true }] })
  expect(await commitScan(db, scanId)).toEqual({ added: 0, replaced: false })
  expect(await lots()).toEqual([])
})

test("a second commit of the same scan throws", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  await commitScan(db, scanId)
  await expect(commitScan(db, scanId)).rejects.toThrow("This scan was already added.")
  expect(await lots()).toEqual([{ cardId: "base1-58", binder: "Main", quantity: 1, source: "scan" }])
})

test("commit with a pending pocket throws and changes nothing", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "sv3pt5-151", decision: "pending" }] })
  await expect(commitScan(db, scanId)).rejects.toThrow(/every pocket/)
  expect(await lots()).toEqual([])
  expect(await statusOf(scanId)).toBe("ready")
})

test("two ready scans of one page committed at once leave one committed scan and one page's worth of cards", async () => {
  const a = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  const b = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  await Promise.allSettled([commitScan(db, a.scanId), commitScan(db, b.scanId)])
  const committed = await db.select().from(scans).where(eq(scans.status, "committed"))
  expect(committed).toHaveLength(1)
  expect(await lots()).toEqual([{ cardId: "base1-58", binder: "Main", quantity: 1, source: "scan" }])
})

test("merging into a hand-entered lot in the same binder keeps its source", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", binder: "Main" })
  await commitScan(db, (await seedScan(db, { pockets: [{ card: "base1-58" }] })).scanId)
  expect(await lots()).toEqual([{ cardId: "base1-58", binder: "Main", quantity: 2, source: "manual" }])
})

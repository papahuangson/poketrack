import { scanResults, scans, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { eq } from "drizzle-orm"
import { beforeEach, expect, test } from "vitest"
import { seedCards, seedScan } from "./scan-fixtures"
import { addedNote, listScanHistory, scanAccuracy } from "./scan-history"

let db: Db

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
})

test("groups by binder and page, current scan first, older scans newest first", async () => {
  const old = await seedScan(db, { status: "superseded", pockets: [{ card: "base1-58" }] })
  const older = await seedScan(db, { binder: " main", status: "superseded", pockets: [{ card: "base1-58" }] })
  const cur = await seedScan(db, { status: "committed", pockets: [{ card: "base1-58" }, { card: "sv3pt5-151" }] })
  const loose = await seedScan(db, { page: 4, status: "ready", pockets: [{ card: "base1-58" }] })
  await db.update(scans).set({ createdAt: new Date("2026-11-10T00:00:00Z") }).where(eq(scans.id, old.scanId))
  await db.update(scans).set({ createdAt: new Date("2026-11-12T00:00:00Z") }).where(eq(scans.id, older.scanId))

  const history = await listScanHistory(db)
  expect(history.map((h) => [h.binder, h.page])).toEqual([
    ["Main", 3],
    ["Main", 4],
  ])
  expect(history[0]?.current).toMatchObject({ id: cur.scanId, status: "committed", cards: 2 })
  expect(history[0]?.older.map((s) => s.id)).toEqual([older.scanId, old.scanId])
  expect(history[1]?.current).toBeNull()
  expect(history[1]?.older.map((s) => s.id)).toEqual([loose.scanId])
})

test("accuracy counts first guesses over committed scans only", async () => {
  const { scanId, resultIds } = await seedScan(db, {
    status: "committed",
    pockets: [
      ...Array.from({ length: 6 }, () => ({ card: "base1-58", candidates: ["base1-58"] })),
      { card: "sv3pt5-151", candidates: ["base1-58", "sv3pt5-151"] },
      { card: "base1-58", decision: "rejected" as const },
      { empty: true },
    ],
  })
  await seedScan(db, { page: 9, pockets: [{ card: "base1-58" }] })
  expect(scanId).toBeGreaterThan(0)
  expect(resultIds).toHaveLength(9)
  expect(await scanAccuracy(db)).toEqual({ firstGuessRight: 6, nonEmpty: 8 })
})

test("accuracy with nothing committed is zero over zero", async () => {
  expect(await scanAccuracy(db)).toEqual({ firstGuessRight: 0, nonEmpty: 0 })
})

test("addedNote describes a committed scan", async () => {
  const { scanId } = await seedScan(db, { status: "committed", pockets: [{ card: "base1-58" }, { card: "base1-58" }, { empty: true }] })
  expect(await addedNote(db, scanId)).toBe("Added 2 cards from Main · page 3")
  const one = await seedScan(db, { page: 5, status: "committed", pockets: [{ card: "base1-58" }] })
  expect(await addedNote(db, one.scanId)).toBe("Added 1 card from Main · page 5")
  const ready = await seedScan(db, { page: 6, pockets: [{ card: "base1-58" }] })
  expect(await addedNote(db, ready.scanId)).toBeNull()
  await db.delete(scanResults)
  expect(await addedNote(db, 99999)).toBeNull()
})

test("history shows a long-stuck read as failed", async () => {
  await db.insert(scans).values({ imageUrl: "u", imageWidth: 1, imageHeight: 1, binder: "Main", page: 8, status: "reading", createdAt: new Date(Date.now() - 120_000) })
  const [page] = await listScanHistory(db)
  expect(page?.older[0]?.status).toBe("failed")
})

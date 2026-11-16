import { collectionItems, scanResults, scans, sets, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { upsertCards } from "@poketrack/jobs"
import { beforeEach, expect, test } from "vitest"
import { committedScanFor, lastPage, latestBinder, listBinders } from "./binders"

let db: Db
const scan = { imageUrl: "u", imageWidth: 1, imageHeight: 1 }

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(sets).values({ id: "base1", name: "Base", series: "S", printedTotal: 102, releaseDate: "1999-01-09" })
  await upsertCards(db, [
    { id: "base1-58", name: "Pikachu", setId: "base1", number: "58", printedTotal: 102, rarity: null, imageSmall: null, imageLarge: null, legalities: {}, rulesText: "", variants: ["normal"] },
  ])
})

test("listBinders merges spellings case-insensitively, scans first", async () => {
  await db.insert(scans).values([{ ...scan, binder: "Main", page: 1 }, { ...scan, binder: "Trades", page: 1 }])
  await db.insert(collectionItems).values([
    { cardId: "base1-58", variant: "normal", binder: " main" },
    { cardId: "base1-58", variant: "normal", binder: "Shoebox", condition: "LP" },
  ])
  expect(await listBinders(db)).toEqual(["Main", "Trades", "Shoebox"])
})

test("lastPage returns the highest page for the binder, case-insensitive", async () => {
  await db.insert(scans).values([{ ...scan, binder: "Main", page: 2 }, { ...scan, binder: "main ", page: 5 }, { ...scan, binder: "Trades", page: 9 }])
  expect(await lastPage(db, "MAIN")).toBe(5)
  expect(await lastPage(db, "Nope")).toBeNull()
})

test("committedScanFor returns the committed scan with its confirmed-pocket count", async () => {
  const [old] = await db.insert(scans).values({ ...scan, binder: "Main", page: 3, status: "superseded" }).returning()
  const [cur] = await db.insert(scans).values({ ...scan, binder: "Main", page: 3, status: "committed", committedAt: new Date("2026-11-15T18:00:00Z") }).returning()
  await db.insert(scanResults).values([
    { scanId: cur!.id, slot: 1, decision: "confirmed", chosenCardId: "base1-58" },
    { scanId: cur!.id, slot: 2, decision: "confirmed", chosenCardId: "base1-58" },
    { scanId: cur!.id, slot: 3, decision: "rejected" },
    { scanId: old!.id, slot: 1, decision: "confirmed", chosenCardId: "base1-58" },
  ])
  expect(await committedScanFor(db, " main", 3)).toEqual({ id: cur!.id, committedAt: "2026-11-15T18:00:00.000Z", cards: 2 })
  expect(await committedScanFor(db, "Main", 4)).toBeNull()
})

test("latestBinder is the binder of the newest scan", async () => {
  expect(await latestBinder(db)).toBeNull()
  await db.insert(scans).values([{ ...scan, binder: "Main", page: 1 }, { ...scan, binder: " Trades ", page: 1 }])
  expect(await latestBinder(db)).toBe("Trades")
})

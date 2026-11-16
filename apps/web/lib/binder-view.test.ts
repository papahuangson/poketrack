import { collectionItems, priceSnapshots, scanResults, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { eq } from "drizzle-orm"
import { beforeEach, expect, test } from "vitest"
import { loadBinderPage, loadUnplaced, pocketCounts, resolveBinder } from "./binder-view"
import { addItem } from "./collection"
import { commitPage, seedCards } from "./scan-fixtures"

let db: Db

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
})

const snapshot = (cardId: string, variant: string, date: string, marketUsd: number) => ({ cardId, variant, date, marketUsd })
const states = async (binder: string, page: number) => (await loadBinderPage(db, binder, page))?.pockets.map((p) => p.state)
const E = "empty"

test("a committed page shows nine pockets in slot order", async () => {
  const { scanId, resultIds } = await commitPage(db, { pockets: [{ card: "sv3pt5-199" }, { empty: true }, { card: "base1-58" }] })
  const page = await loadBinderPage(db, "Main", 3)
  expect(page).toMatchObject({ binder: "Main", page: 3, pageCount: 3, scanId })
  expect(page!.pockets.map((p) => p.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  expect(page!.pockets.map((p) => p.state)).toEqual(["card", E, "card", E, E, E, E, E, E])
  expect(page!.pockets[0]).toMatchObject({
    resultId: resultIds[0],
    cardId: "sv3pt5-199",
    name: "Charizard ex",
    setName: "151",
    number: "199",
    printedTotal: 165,
    imageSmall: "https://img.test/sv3pt5-199.webp",
    variant: "normal",
    condition: "NM",
  })
  expect(page!.pockets[0]!.lotId).toEqual(expect.any(Number))
  expect(page!.pockets[2]!.name).toBe("Pikachu")
  expect(page!.pockets[1]).toMatchObject({ resultId: null, lotId: null, cardId: null, name: null })
})

test("rejected and removed pockets show empty", async () => {
  const { resultIds } = await commitPage(db, {
    pockets: [{ card: "sv3pt5-199", decision: "rejected" }, { card: "base1-58" }, { card: "sv3pt5-151" }],
  })
  await db.update(scanResults).set({ removedAt: new Date() }).where(eq(scanResults.id, resultIds[1]!))
  expect((await states("Main", 3))!.slice(0, 3)).toEqual([E, E, "card"])
})

test("a lot with fewer copies than pockets marks the later pockets missing", async () => {
  await commitPage(db, { page: 3, pockets: [{ card: "base1-58" }, { card: "base1-58" }] })
  await commitPage(db, { page: 1, pockets: [{ card: "base1-58" }] })
  await db.update(collectionItems).set({ quantity: 2 })
  expect((await states("Main", 1))![0]).toBe("card")
  const page3 = await loadBinderPage(db, "Main", 3)
  expect(page3!.pockets.slice(0, 2).map((p) => p.state)).toEqual(["card", "missing"])
  expect(page3!.pockets[1]).toMatchObject({ name: "Pikachu", lotId: null })
  expect(page3!.pockets[1]!.resultId).toEqual(expect.any(Number))
})

test("a deleted lot leaves its pocket missing", async () => {
  await commitPage(db, { pockets: [{ card: "base1-58" }] })
  await db.delete(collectionItems)
  expect((await loadBinderPage(db, "Main", 3))!.pockets[0]).toMatchObject({ state: "missing", lotId: null, name: "Pikachu" })
})

test("pageCount is the highest committed page and gaps are unscanned", async () => {
  await commitPage(db, { page: 1, pockets: [{ card: "base1-58" }] })
  await commitPage(db, { page: 3, pockets: [{ card: "base1-58" }] })
  expect(await loadBinderPage(db, "Main", 2)).toMatchObject({ scanId: null, pockets: [], pageCount: 3, valueCents: 0, unpricedCount: 0 })
  expect(await loadBinderPage(db, "Main", 4)).toBeNull()
  expect(await loadBinderPage(db, "Main", 0)).toBeNull()
  expect(await loadBinderPage(db, "Nope", 1)).toBeNull()
})

test("page value counts only present, priced cards", async () => {
  await commitPage(db, {
    pockets: [{ card: "sv3pt5-199", variant: "holofoil" }, { card: "base1-58" }, { card: "base1-58" }, { card: "sv3pt5-151" }],
  })
  await db.update(collectionItems).set({ quantity: 1 }).where(eq(collectionItems.cardId, "base1-58"))
  await db.insert(priceSnapshots).values([
    snapshot("sv3pt5-199", "holofoil", "2026-11-13", 90),
    snapshot("sv3pt5-199", "holofoil", "2026-11-14", 98.4),
    snapshot("base1-58", "normal", "2026-11-14", 4.1),
  ])
  const page = await loadBinderPage(db, "Main", 3)
  expect(page!.pockets.slice(0, 4).map((p) => p.marketCents)).toEqual([9840, 410, 410, null])
  expect(page).toMatchObject({ valueCents: 9840 + 410, unpricedCount: 1 })
})

test("matches binder names case-insensitively", async () => {
  await commitPage(db, { pockets: [{ card: "base1-58" }] })
  expect(await resolveBinder(db, " main ")).toBe("Main")
  expect(await resolveBinder(db, "Nope")).toBeNull()
  expect((await loadBinderPage(db, "MAIN ", 3))?.binder).toBe("Main")
})

test("unplaced lists surplus copies and pocketless lots", async () => {
  const { resultIds } = await commitPage(db, { pockets: [{ card: "base1-58" }] })
  const pika = await addItem(db, { cardId: "base1-58", variant: "normal", condition: "NM", quantity: 2, binder: "Main" })
  const zard = await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "LP", quantity: 3, binder: "Main" })
  await addItem(db, { cardId: "sv3pt5-151", variant: "holofoil", condition: "NM", quantity: 1, binder: "Trade" })
  await addItem(db, { cardId: "sv3pt5-151", variant: "holofoil", condition: "NM", quantity: 1 })
  const unplaced = await loadUnplaced(db, "main")
  expect(unplaced.map((u) => [u.lotId, u.name, u.surplus])).toEqual([
    [zard.id, "Charizard ex", 3],
    [pika.id, "Pikachu", 2],
  ])
  expect(unplaced[0]).toMatchObject({ cardId: "sv3pt5-199", setName: "151", number: "199", printedTotal: 165, variant: "holofoil", condition: "LP", marketCents: null })
  expect(await pocketCounts(db, [pika.id, zard.id])).toEqual(new Map([[pika.id, 1]]))
  expect(await pocketCounts(db, [])).toEqual(new Map())
  await db.update(scanResults).set({ removedAt: new Date() }).where(eq(scanResults.id, resultIds[0]!))
  expect((await loadUnplaced(db, "Main")).find((u) => u.lotId === pika.id)?.surplus).toBe(3)
})

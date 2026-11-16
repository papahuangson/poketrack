import { collectionItems, scanResults, scans, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { eq } from "drizzle-orm"
import { beforeEach, expect, test } from "vitest"
import { loadBinderPage } from "./binder-view"
import { ValidationError } from "./errors"
import { addItem } from "./collection"
import { editSurplus, movePocketCopy, removePocketCopy, removeSurplus, setLotDetails } from "./pocket-edit"
import { commitScan } from "./scan-commit"
import { commitPage, seedCards, seedScan } from "./scan-fixtures"

let db: Db

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
})

const STALE = "That pocket changed. Reload the page."
const lots = async () =>
  (await db.select().from(collectionItems).orderBy(collectionItems.id)).map((l) => ({ id: l.id, condition: l.condition, variant: l.variant, quantity: l.quantity }))
const summary = async () => (await lots()).map(({ condition, quantity }) => ({ condition, quantity }))
const pocket = async (id: number) => (await db.select().from(scanResults).where(eq(scanResults.id, id)))[0]!
const twoPikachu = () => commitPage(db, { pockets: [{ card: "base1-58" }, { card: "base1-58" }] })
const failure = async (run: Promise<unknown>) => {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ValidationError)
  return error as ValidationError
}

test("changing condition on a ×2 lot splits off only this pocket's copy", async () => {
  const { resultIds } = await twoPikachu()
  const before = await pocket(resultIds[1]!)
  const { lotId } = await movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "LP" })
  expect(await summary()).toEqual([
    { condition: "NM", quantity: 1 },
    { condition: "LP", quantity: 1 },
  ])
  expect(await pocket(resultIds[0]!)).toMatchObject({ collectionItemId: lotId, condition: "LP", variant: "normal" })
  expect((await lots())[1]!.id).toBe(lotId)
  expect(await pocket(resultIds[1]!)).toEqual(before)
})

test("moving to the same variant and condition changes nothing", async () => {
  const { resultIds } = await twoPikachu()
  const before = await pocket(resultIds[0]!)
  expect(await movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "NM" })).toEqual({ lotId: before.collectionItemId })
  expect(await summary()).toEqual([{ condition: "NM", quantity: 2 }])
})

test("moving into an existing lot merges", async () => {
  const { resultIds } = await twoPikachu()
  const first = await movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "LP" })
  const second = await movePocketCopy(db, resultIds[1]!, { variant: "normal", condition: "LP" })
  expect(second.lotId).toBe(first.lotId)
  expect(await summary()).toEqual([{ condition: "LP", quantity: 2 }])
})

test("moving back merges back and deletes the emptied lot", async () => {
  const { resultIds } = await twoPikachu()
  const nm = (await pocket(resultIds[1]!)).collectionItemId
  await movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "LP" })
  expect(await movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "NM" })).toEqual({ lotId: nm })
  expect(await lots()).toEqual([{ id: nm, condition: "NM", variant: "normal", quantity: 2 }])
})

test("a new lot inherits paid price and acquired date", async () => {
  const { resultIds } = await twoPikachu()
  await db.update(collectionItems).set({ paidUsd: 3.5, acquiredOn: "2026-10-01" })
  const { lotId } = await movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "MP" })
  const [created] = await db.select().from(collectionItems).where(eq(collectionItems.id, lotId))
  expect(created).toMatchObject({ paidUsd: 3.5, acquiredOn: "2026-10-01", binder: "Main", condition: "MP", quantity: 1 })
})

test("an existing target lot keeps its own paid price", async () => {
  const { resultIds } = await twoPikachu()
  const first = await movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "LP" })
  await db.update(collectionItems).set({ paidUsd: 9 }).where(eq(collectionItems.id, first.lotId))
  await movePocketCopy(db, resultIds[1]!, { variant: "normal", condition: "LP" })
  expect((await db.select().from(collectionItems))[0]).toMatchObject({ paidUsd: 9, quantity: 2 })
})

test("a variant the card doesn't have is rejected", async () => {
  const { resultIds } = await twoPikachu()
  expect((await failure(movePocketCopy(db, resultIds[0]!, { variant: "holofoil", condition: "NM" }))).field).toBe("variant")
  expect((await failure(movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "MINT" as never }))).field).toBe("condition")
  expect(await summary()).toEqual([{ condition: "NM", quantity: 2 }])
})

test("a variant change moves the copy too", async () => {
  const { resultIds } = await commitPage(db, { pockets: [{ card: "sv3pt5-199" }] })
  const { lotId } = await movePocketCopy(db, resultIds[0]!, { variant: "holofoil", condition: "NM" })
  expect(await lots()).toEqual([{ id: lotId, condition: "NM", variant: "holofoil", quantity: 1 }])
  expect(await pocket(resultIds[0]!)).toMatchObject({ variant: "holofoil", collectionItemId: lotId })
})

test("remove takes one copy and empties the pocket", async () => {
  const { resultIds } = await twoPikachu()
  await removePocketCopy(db, resultIds[0]!)
  expect(await summary()).toEqual([{ condition: "NM", quantity: 1 }])
  const removed = await pocket(resultIds[0]!)
  expect(removed.collectionItemId).toBeNull()
  expect(removed.removedAt).toBeInstanceOf(Date)
  expect(removed).toMatchObject({ decision: "confirmed", chosenCardId: "base1-58" })
  expect((await loadBinderPage(db, "Main", 3))!.pockets.slice(0, 2).map((p) => p.state)).toEqual(["empty", "card"])
})

test("removing the last copy deletes the lot", async () => {
  const { resultIds } = await commitPage(db, { pockets: [{ card: "base1-58" }] })
  await removePocketCopy(db, resultIds[0]!)
  expect(await lots()).toEqual([])
})

test("remove on a missing pocket only marks it removed", async () => {
  const { resultIds } = await twoPikachu()
  await db.update(collectionItems).set({ quantity: 1 })
  await removePocketCopy(db, resultIds[1]!)
  expect(await summary()).toEqual([{ condition: "NM", quantity: 1 }])
  expect((await pocket(resultIds[1]!)).removedAt).toBeInstanceOf(Date)
  expect((await loadBinderPage(db, "Main", 3))!.pockets.slice(0, 2).map((p) => p.state)).toEqual(["card", "empty"])
})

test("a missing pocket can't be edited", async () => {
  const { resultIds } = await twoPikachu()
  await db.update(collectionItems).set({ quantity: 1 })
  expect((await failure(movePocketCopy(db, resultIds[1]!, { variant: "normal", condition: "LP" }))).message).toBe(STALE)
  expect(await summary()).toEqual([{ condition: "NM", quantity: 1 }])
})

test("stale pocket is refused", async () => {
  const { resultIds } = await twoPikachu()
  await removePocketCopy(db, resultIds[0]!)
  const again = await failure(removePocketCopy(db, resultIds[0]!))
  expect(again).toMatchObject({ field: "pocket", message: STALE })
  expect(await summary()).toEqual([{ condition: "NM", quantity: 1 }])
  expect((await failure(movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "LP" }))).message).toBe(STALE)

  const next = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "base1-58" }] })
  await commitScan(db, next.scanId)
  expect((await failure(removePocketCopy(db, resultIds[1]!))).message).toBe(STALE)
  expect((await failure(movePocketCopy(db, resultIds[1]!, { variant: "normal", condition: "LP" }))).message).toBe(STALE)
  expect((await failure(removePocketCopy(db, 9999))).message).toBe(STALE)
  expect(await summary()).toEqual([{ condition: "NM", quantity: 2 }])
})

test("empty, rejected and uncommitted pockets are refused", async () => {
  const committed = await commitPage(db, { pockets: [{ empty: true }, { card: "base1-58", decision: "rejected" }] })
  const ready = await seedScan(db, { page: 4, pockets: [{ card: "base1-58" }] })
  for (const id of [...committed.resultIds, ...ready.resultIds]) expect((await failure(removePocketCopy(db, id))).message).toBe(STALE)
})

test("rescan after a condition edit leaves counts correct", async () => {
  const { resultIds, scanId } = await twoPikachu()
  await movePocketCopy(db, resultIds[0]!, { variant: "normal", condition: "LP" })
  const next = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "base1-58" }] })
  await commitScan(db, next.scanId)
  expect(await summary()).toEqual([{ condition: "NM", quantity: 2 }])
  expect((await db.select().from(scans).where(eq(scans.id, scanId)))[0]?.status).toBe("superseded")
})

test("rescan after a remove leaves counts correct", async () => {
  const { resultIds } = await twoPikachu()
  await removePocketCopy(db, resultIds[0]!)
  const next = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "base1-58" }] })
  await commitScan(db, next.scanId)
  expect(await summary()).toEqual([{ condition: "NM", quantity: 2 }])
})

test("setLotDetails validates and saves", async () => {
  await twoPikachu()
  const [lot] = await db.select().from(collectionItems)
  expect((await failure(setLotDetails(db, lot!.id, { paidCents: -1, acquiredOn: null }))).field).toBe("paidCents")
  expect((await failure(setLotDetails(db, lot!.id, { paidCents: null, acquiredOn: "2999-01-01" }))).field).toBe("acquiredOn")
  expect((await failure(setLotDetails(db, 9999, { paidCents: null, acquiredOn: null }))).field).toBe("lot")
  await setLotDetails(db, lot!.id, { paidCents: 425, acquiredOn: "2026-10-01" })
  expect((await db.select().from(collectionItems))[0]).toMatchObject({ paidUsd: 4.25, acquiredOn: "2026-10-01", quantity: 2 })
  await setLotDetails(db, lot!.id, { paidCents: null, acquiredOn: null })
  expect((await db.select().from(collectionItems))[0]).toMatchObject({ paidUsd: null, acquiredOn: null })
})

const lot3 = async () => {
  const { resultIds } = await commitPage(db, { pockets: [{ card: "base1-58" }] })
  const { id } = await addItem(db, { cardId: "base1-58", variant: "normal", condition: "NM", quantity: 2, binder: "Main" })
  return { id, resultId: resultIds[0]! }
}
const own = { variant: "normal", condition: "NM" as const, binder: "Main" }
const full = async () =>
  (await db.select().from(collectionItems).orderBy(collectionItems.id)).map((l) => ({ condition: l.condition, quantity: l.quantity, binder: l.binder }))

test("quantity edits change only the surplus", async () => {
  const { id } = await lot3()
  await editSurplus(db, id, { ...own, quantity: 5 })
  expect(await summary()).toEqual([{ condition: "NM", quantity: 6 }])
  await editSurplus(db, id, { ...own, quantity: 0 })
  expect(await summary()).toEqual([{ condition: "NM", quantity: 1 }])
})

test("changing condition moves only the surplus", async () => {
  const { id, resultId } = await lot3()
  await db.update(collectionItems).set({ paidUsd: 2, acquiredOn: "2026-10-01" })
  const before = await pocket(resultId)
  await editSurplus(db, id, { ...own, condition: "LP", quantity: 2 })
  expect(await summary()).toEqual([
    { condition: "NM", quantity: 1 },
    { condition: "LP", quantity: 2 },
  ])
  expect(await pocket(resultId)).toEqual(before)
  expect(before.collectionItemId).toBe(id)
  expect((await db.select().from(collectionItems).orderBy(collectionItems.id))[1]).toMatchObject({ paidUsd: 2, acquiredOn: "2026-10-01", binder: "Main" })
})

test("changing binder moves the surplus into another binder's lot", async () => {
  const { id } = await lot3()
  await addItem(db, { cardId: "base1-58", variant: "normal", condition: "NM", quantity: 1, binder: "Trade" })
  await editSurplus(db, id, { ...own, binder: " Trade ", quantity: 2 })
  expect(await full()).toEqual([
    { condition: "NM", quantity: 1, binder: "Main" },
    { condition: "NM", quantity: 3, binder: "Trade" },
  ])
  await editSurplus(db, (await db.select().from(collectionItems).orderBy(collectionItems.id))[1]!.id, { ...own, binder: "", quantity: 3 })
  expect((await full())[1]).toEqual({ condition: "NM", quantity: 3, binder: null })
})

test("a pocketless lot behaves like a normal edit", async () => {
  const a = await addItem(db, { cardId: "base1-58", variant: "normal", condition: "NM", quantity: 2, binder: "Main" })
  await addItem(db, { cardId: "base1-58", variant: "normal", condition: "LP", quantity: 1, binder: "Main" })
  await editSurplus(db, a.id, { ...own, condition: "LP", quantity: 2 })
  expect(await summary()).toEqual([{ condition: "LP", quantity: 3 }])
  const [lp] = await db.select().from(collectionItems)
  await editSurplus(db, lp!.id, { ...own, condition: "LP", quantity: 0 })
  expect(await summary()).toEqual([])
})

test("removeSurplus never touches pocketed copies", async () => {
  const { id, resultId } = await lot3()
  await removeSurplus(db, id)
  expect(await summary()).toEqual([{ condition: "NM", quantity: 1 }])
  expect((await pocket(resultId)).collectionItemId).toBe(id)
  await removeSurplus(db, id)
  expect(await summary()).toEqual([{ condition: "NM", quantity: 1 }])
})

test("surplus edits validate their input and a missing lot", async () => {
  const { id } = await lot3()
  expect((await failure(editSurplus(db, id, { ...own, quantity: -1 }))).field).toBe("quantity")
  expect((await failure(editSurplus(db, id, { ...own, quantity: 1.5 }))).field).toBe("quantity")
  expect((await failure(editSurplus(db, id, { ...own, quantity: 1000 }))).field).toBe("quantity")
  expect((await failure(editSurplus(db, id, { ...own, variant: "holofoil", quantity: 2 }))).field).toBe("variant")
  expect(await failure(editSurplus(db, 9999, { ...own, quantity: 1 }))).toMatchObject({ field: "lot", message: "That card is no longer in your collection." })
  expect(await failure(removeSurplus(db, 9999))).toMatchObject({ field: "lot" })
  expect(await summary()).toEqual([{ condition: "NM", quantity: 3 }])
})

test("a lot with fewer copies than pockets has no surplus to take", async () => {
  const { resultIds } = await twoPikachu()
  await db.update(collectionItems).set({ quantity: 1 })
  const id = (await pocket(resultIds[0]!)).collectionItemId!
  await removeSurplus(db, id)
  expect(await summary()).toEqual([{ condition: "NM", quantity: 1 }])
  await editSurplus(db, id, { ...own, quantity: 2 })
  expect(await summary()).toEqual([{ condition: "NM", quantity: 3 }])
})

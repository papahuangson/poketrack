import { collectionItems, scanResults, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { eq } from "drizzle-orm"
import { beforeEach, expect, test, vi } from "vitest"
import { addItem } from "@/lib/collection"
import { commitPage, seedCards } from "@/lib/scan-fixtures"

const revalidatePath = vi.fn()
let db: Db

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }))
vi.mock("@/lib/db", () => ({ getDb: () => db }))

const { editSurplusAction, movePocketAction, removePocketAction, removeSurplusAction, searchOwnedAction, setLotDetailsAction } = await import("./actions")

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
  revalidatePath.mockReset()
})

const quantities = async () => (await db.select().from(collectionItems).orderBy(collectionItems.id)).map((l) => [l.condition, l.quantity])

test("a pocket move saves and refreshes the binder and the collection", async () => {
  const { resultIds } = await commitPage(db, { pockets: [{ card: "base1-58" }, { card: "base1-58" }] })
  const moved = await movePocketAction(resultIds[0]!, { variant: "normal", condition: "LP" })
  expect(moved).toEqual({ ok: true, lotId: expect.any(Number) })
  expect((await db.select().from(scanResults).where(eq(scanResults.id, resultIds[0]!)))[0]?.collectionItemId).toBe(moved.ok ? moved.lotId : null)
  expect(await quantities()).toEqual([
    ["NM", 1],
    ["LP", 1],
  ])
  expect(revalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual(["/", "/binders"])
})

test("a stale pocket comes back as a message and changes nothing", async () => {
  const { resultIds } = await commitPage(db, { pockets: [{ card: "base1-58" }, { card: "base1-58" }] })
  expect(await removePocketAction(resultIds[0]!)).toEqual({ ok: true })
  revalidatePath.mockReset()
  expect(await removePocketAction(resultIds[0]!)).toEqual({ ok: false, field: "pocket", message: "That pocket changed. Reload the page." })
  expect(await movePocketAction(resultIds[0]!, { variant: "normal", condition: "LP" })).toMatchObject({ ok: false, field: "pocket" })
  expect(await quantities()).toEqual([["NM", 1]])
  expect(revalidatePath).not.toHaveBeenCalled()
})

test("ids that aren't whole numbers are refused, not run", async () => {
  await commitPage(db, { pockets: [{ card: "base1-58" }] })
  expect(await removePocketAction("1; drop table scans" as never)).toMatchObject({ ok: false, field: "pocket" })
  expect(await removeSurplusAction(1.5)).toMatchObject({ ok: false, field: "lot" })
  expect(await setLotDetailsAction(Number.NaN, { paidCents: null, acquiredOn: null })).toMatchObject({ ok: false, field: "lot" })
  expect(await quantities()).toEqual([["NM", 1]])
})

test("lot details and surplus edits go through", async () => {
  await commitPage(db, { pockets: [{ card: "base1-58" }] })
  const { id } = await addItem(db, { cardId: "base1-58", variant: "normal", condition: "NM", quantity: 2, binder: "Main" })
  expect(await setLotDetailsAction(id, { paidCents: 250, acquiredOn: null })).toEqual({ ok: true })
  expect(await setLotDetailsAction(id, { paidCents: -1, acquiredOn: null })).toMatchObject({ ok: false, field: "paidCents" })
  expect((await db.select().from(collectionItems).where(eq(collectionItems.id, id)))[0]?.paidUsd).toBe(2.5)
  expect(await editSurplusAction(id, { variant: "normal", condition: "NM", binder: "Main", quantity: 4 })).toEqual({ ok: true })
  expect(await quantities()).toEqual([["NM", 5]])
  expect(await removeSurplusAction(id)).toEqual({ ok: true })
  expect(await quantities()).toEqual([["NM", 1]])
  expect(await removeSurplusAction(9999)).toMatchObject({ ok: false, field: "lot" })
  expect((await db.select().from(scanResults))[0]?.collectionItemId).toBe(id)
})

test("search returns owned hits and nothing for junk", async () => {
  await commitPage(db, { pockets: [{ card: "base1-58" }] })
  expect((await searchOwnedAction("pika")).map((h) => h.where.kind)).toEqual(["pocket"])
  expect(await searchOwnedAction("%")).toEqual([])
  expect(await searchOwnedAction(42 as never)).toEqual([])
})

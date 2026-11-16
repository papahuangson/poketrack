import { collectionItems, scanResults, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { eq } from "drizzle-orm"
import { beforeEach, expect, test, vi } from "vitest"
import { seedCards, seedScan } from "@/lib/scan-fixtures"

let db: Db
const revalidatePath = vi.fn()
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock("@/lib/db", () => ({ getDb: () => db }))

const { updateSlotAction } = await import("./actions")

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
  revalidatePath.mockClear()
})

const stored = async (id: number) => (await db.select().from(scanResults).where(eq(scanResults.id, id)))[0]!

test("choosing a card resets the variant to one the new card offers", async () => {
  const { scanId, resultIds } = await seedScan(db, { pockets: [{ card: "base1-58", decision: "pending" }] })
  expect(await updateSlotAction(resultIds[0]!, { chosenCardId: "sv3pt5-151" })).toEqual({ ok: true })
  expect(await stored(resultIds[0]!)).toMatchObject({ chosenCardId: "sv3pt5-151", variant: "holofoil" })
  expect(revalidatePath).toHaveBeenCalledWith(`/scans/${scanId}`)
})

test("choosing a card turns the claim on when a binder-less lot of it exists", async () => {
  await db.insert(collectionItems).values({ cardId: "sv3pt5-151", variant: "holofoil" })
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58", decision: "pending" }] })
  await updateSlotAction(resultIds[0]!, { chosenCardId: "sv3pt5-151" })
  expect((await stored(resultIds[0]!)).claimManual).toBe(true)
})

test("clearing the card clears variant and returns the pocket to pending", async () => {
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  await updateSlotAction(resultIds[0]!, { chosenCardId: null })
  expect(await stored(resultIds[0]!)).toMatchObject({ chosenCardId: null, variant: null, decision: "pending", claimManual: false })
})

test("a variant the chosen card doesn't offer is rejected", async () => {
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  expect(await updateSlotAction(resultIds[0]!, { variant: "holofoil" })).toMatchObject({ ok: false, field: "variant" })
})

test("condition and decision update", async () => {
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58", decision: "pending" }] })
  await updateSlotAction(resultIds[0]!, { condition: "LP", decision: "confirmed", claimManual: true })
  expect(await stored(resultIds[0]!)).toMatchObject({ condition: "LP", decision: "confirmed", claimManual: true })
  expect(await updateSlotAction(resultIds[0]!, { condition: "Mint" as never })).toMatchObject({ ok: false, field: "condition" })
})

test("patches on a committed scan fail", async () => {
  const { resultIds } = await seedScan(db, { status: "committed", pockets: [{ card: "base1-58" }] })
  expect(await updateSlotAction(resultIds[0]!, { decision: "rejected" })).toEqual({
    ok: false,
    field: "scan",
    message: "This scan was already added.",
  })
})

test("confirming with no chosen card fails", async () => {
  const { resultIds } = await seedScan(db, { pockets: [{ card: null }] })
  expect(await updateSlotAction(resultIds[0]!, { decision: "confirmed" })).toMatchObject({ ok: false, field: "chosenCardId" })
})

test("an unknown card is rejected", async () => {
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  expect(await updateSlotAction(resultIds[0]!, { chosenCardId: "nope-1" })).toMatchObject({ ok: false, field: "chosenCardId" })
})

test("choosing a card the page's previous scan already held leaves the claim off", async () => {
  await db.insert(collectionItems).values({ cardId: "sv3pt5-151", variant: "holofoil" })
  await seedScan(db, { status: "committed", pockets: [{ card: "sv3pt5-151" }] })
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58", decision: "pending" }] })
  await updateSlotAction(resultIds[0]!, { chosenCardId: "sv3pt5-151" })
  expect((await stored(resultIds[0]!)).claimManual).toBe(false)
})

test("turning the claim on takes the typed-in copy's condition", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", condition: "MP" })
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  await updateSlotAction(resultIds[0]!, { claimManual: true })
  expect(await stored(resultIds[0]!)).toMatchObject({ claimManual: true, condition: "MP" })
})

test("choosing a card that claims a copy takes that copy's condition", async () => {
  await db.insert(collectionItems).values({ cardId: "sv3pt5-151", variant: "holofoil", condition: "HP" })
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58", decision: "pending" }] })
  await updateSlotAction(resultIds[0]!, { chosenCardId: "sv3pt5-151" })
  expect(await stored(resultIds[0]!)).toMatchObject({ claimManual: true, condition: "HP" })
})

test("a rejected pocket can go back to pending", async () => {
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58", decision: "rejected" }] })
  expect(await updateSlotAction(resultIds[0]!, { decision: "pending" })).toEqual({ ok: true })
  expect((await stored(resultIds[0]!)).decision).toBe("pending")
})

test("changing the card of a confirmed pocket keeps it confirmed", async () => {
  const { resultIds } = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  await updateSlotAction(resultIds[0]!, { chosenCardId: "sv3pt5-151" })
  expect(await stored(resultIds[0]!)).toMatchObject({ chosenCardId: "sv3pt5-151", decision: "confirmed" })
})

import { collectionItems, priceSnapshots, sets, chicagoDate, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { beforeEach, expect, test, vi } from "vitest"

const snapshotCard = vi.fn()
const revalidatePath = vi.fn()
const providerOptions = vi.fn()
let db: Db

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }))
vi.mock("@/lib/db", () => ({ getDb: () => db }))
vi.mock("@poketrack/jobs", async (original) => ({
  ...(await original<typeof import("@poketrack/jobs")>()),
  snapshotCard: (...args: unknown[]) => snapshotCard(...args),
  createPokemonTcgIo: (opts: unknown) => {
    providerOptions(opts)
    return { provider: true }
  },
}))

const { upsertCards } = await import("@poketrack/jobs")
const { addCardAction, defaultVariantAction, removeItemAction, updateItemAction } = await import("./actions")

const add = { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 } as const
const edit = { variant: "holofoil", condition: "NM", quantity: 1, paidCents: null, acquiredOn: null, binder: null } as const

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(sets).values({ id: "sv3pt5", name: "151", series: "S", printedTotal: 165, releaseDate: "2023-09-22" })
  await upsertCards(db, [
    {
      id: "sv3pt5-199",
      name: "Charizard ex",
      setId: "sv3pt5",
      number: "199",
      printedTotal: 165,
      rarity: null,
      imageSmall: null,
      imageLarge: null,
      legalities: {},
      rulesText: "",
      variants: ["holofoil"],
    },
  ])
  snapshotCard.mockReset().mockResolvedValue(1)
  revalidatePath.mockReset()
})

test("adding a card saves it, fetches today's price and refreshes the collection", async () => {
  expect(await addCardAction(add)).toEqual({ ok: true })
  expect(await db.select().from(collectionItems)).toMatchObject([{ cardId: "sv3pt5-199", quantity: 1 }])
  expect(snapshotCard).toHaveBeenCalledExactlyOnceWith(db, { provider: true }, "sv3pt5-199", chicagoDate())
  expect(revalidatePath).toHaveBeenCalledWith("/")
})

test("adding does not fetch a price when today's snapshot already exists", async () => {
  await db.insert(priceSnapshots).values({ cardId: "sv3pt5-199", variant: "holofoil", date: chicagoDate(), marketUsd: 98.4 })
  expect(await addCardAction(add)).toEqual({ ok: true })
  expect(snapshotCard).not.toHaveBeenCalled()
})

test("adding still succeeds when the price fetch fails", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
  snapshotCard.mockRejectedValue(new Error("pokemontcg.io down"))
  expect(await addCardAction(add)).toEqual({ ok: true })
  expect(await db.select().from(collectionItems)).toHaveLength(1)
  quiet.mockRestore()
})

test("adding with a bad quantity reports the field and saves nothing", async () => {
  expect(await addCardAction({ ...add, quantity: 0 })).toEqual({
    ok: false,
    field: "quantity",
    message: "Quantity must be a whole number from 1 to 999.",
  })
  expect(await db.select().from(collectionItems)).toHaveLength(0)
  expect(snapshotCard).not.toHaveBeenCalled()
  expect(revalidatePath).not.toHaveBeenCalled()
})

test("updating into another row's variant and condition reports the variant field", async () => {
  await addCardAction(add)
  await addCardAction({ ...add, condition: "LP" })
  const lp = (await db.select().from(collectionItems)).find((row) => row.condition === "LP")
  expect(await updateItemAction(lp?.id ?? 0, edit)).toMatchObject({ ok: false, field: "variant" })
})

test("updating saves the change and refreshes the collection", async () => {
  await addCardAction(add)
  const [row] = await db.select().from(collectionItems)
  revalidatePath.mockReset()
  expect(await updateItemAction(row?.id ?? 0, { ...edit, quantity: 4, paidCents: 4550 })).toEqual({ ok: true })
  expect(await db.select().from(collectionItems)).toMatchObject([{ quantity: 4, paidUsd: 45.5 }])
  expect(revalidatePath).toHaveBeenCalledWith("/")
})

test("removing deletes the row", async () => {
  await addCardAction(add)
  const [row] = await db.select().from(collectionItems)
  expect(await removeItemAction(row?.id ?? 0)).toEqual({ ok: true })
  expect(await db.select().from(collectionItems)).toHaveLength(0)
})

test("an unexpected failure is rethrown, not reported as a field error", async () => {
  await expect(updateItemAction(Number.NaN, edit)).rejects.toThrow()
})

test("the default variant comes from the last add", async () => {
  expect(await defaultVariantAction(["normal", "holofoil"])).toBe("normal")
  await addCardAction(add)
  expect(await defaultVariantAction(["normal", "holofoil"])).toBe("holofoil")
})

test("the price fetch on add tries once with a short timeout", async () => {
  await addCardAction(add)
  expect(providerOptions).toHaveBeenLastCalledWith(expect.objectContaining({ attempts: 1, timeoutMs: 6000 }))
})

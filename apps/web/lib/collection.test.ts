import { collectionItems, priceSnapshots, sets, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { upsertCards, type CatalogCard } from "@poketrack/jobs"
import { eq } from "drizzle-orm"
import { beforeEach, expect, test } from "vitest"
import {
  addItem,
  collectionFilterOptions,
  collectionTotals,
  defaultVariant,
  listCollection,
  removeItem,
  searchCards,
  updateItem,
  type EditInput,
} from "./collection"
import { ValidationError } from "./errors"

let db: Db

function card(id: string, name: string, over: Partial<CatalogCard> = {}): CatalogCard {
  const dash = id.lastIndexOf("-")
  return {
    id,
    name,
    setId: id.slice(0, dash),
    number: id.slice(dash + 1),
    printedTotal: 165,
    rarity: null,
    imageSmall: `https://images.pokemontcg.io/${id}.png`,
    imageLarge: null,
    legalities: {},
    rulesText: name,
    variants: ["normal"],
    ...over,
  }
}

const set = (id: string, name: string, releaseDate: string, printedTotal = 165) => ({ id, name, series: "S", printedTotal, releaseDate })

const snapshot = (cardId: string, variant: string, date: string, marketUsd: number) => ({ cardId, variant, date, marketUsd })

const edit = (over: Partial<EditInput> = {}): EditInput => ({
  variant: "holofoil",
  condition: "NM",
  quantity: 1,
  paidCents: null,
  acquiredOn: null,
  binder: null,
  ...over,
})

async function fieldOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ValidationError)
  return (error as ValidationError).field
}

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(sets).values([set("sv3pt5", "151", "2023-09-22"), set("base1", "Base", "1999-01-09", 102), set("sv4", "Paradox Rift", "2023-11-03", 182)])
  await upsertCards(db, [
    card("sv3pt5-199", "Charizard ex", { variants: ["holofoil"] }),
    card("sv3pt5-6", "Charizard ex", { variants: ["holofoil"] }),
    card("base1-4", "Charizard", { printedTotal: 102, variants: ["holofoil"] }),
    card("sv3pt5-25", "Pikachu", { variants: ["normal", "reverseHolofoil"] }),
    card("base1-58", "Pikachu", { printedTotal: 102 }),
    card("sv4-004", "Charmander", { printedTotal: 182 }),
    card("sv3pt5-151", "Mew ex", { variants: [] }),
    card("sv4-44", "Flabébé", { printedTotal: 182 }),
    card("sv4-83", "Farfetch'd", { printedTotal: 182 }),
    card("sv4-100", "Zygarde 100% Forme", { printedTotal: 182 }),
    card("sv4-101", "Type: Null", { printedTotal: 182 }),
  ])
})

test("search finds cards by part of the name", async () => {
  const hits = await searchCards(db, "chariz")
  expect(hits.map((h) => h.id).sort()).toEqual(["base1-4", "sv3pt5-199", "sv3pt5-6"])
  expect(hits[0]).toMatchObject({ setName: "151", printedTotal: 165, variants: ["holofoil"] })
})

test("search ranks an exact name before a longer one, then newer sets first", async () => {
  const hits = await searchCards(db, "charizard")
  expect(hits.map((h) => h.id)).toEqual(["base1-4", "sv3pt5-6", "sv3pt5-199"])
})

test("search with a trailing number narrows to that collector number", async () => {
  expect((await searchCards(db, "charizard 199")).map((h) => h.id)).toEqual(["sv3pt5-199"])
  expect((await searchCards(db, "charizard 199/165")).map((h) => h.id)).toEqual(["sv3pt5-199"])
})

test("search by number alone works and ignores leading zeros", async () => {
  expect((await searchCards(db, "199/165")).map((h) => h.id)).toEqual(["sv3pt5-199"])
  expect((await searchCards(db, "4")).map((h) => h.id).sort()).toEqual(["base1-4", "sv4-004"])
})

test("search ignores accents, punctuation and spacing", async () => {
  expect((await searchCards(db, "flabebe")).map((h) => h.id)).toEqual(["sv4-44"])
  expect((await searchCards(db, "farfetch'd")).map((h) => h.id)).toEqual(["sv4-83"])
  expect((await searchCards(db, "farfetchd")).map((h) => h.id)).toEqual(["sv4-83"])
  expect((await searchCards(db, "type null")).map((h) => h.id)).toEqual(["sv4-101"])
})

test("search treats wildcard characters as plain text", async () => {
  expect(await searchCards(db, "100%")).toMatchObject([{ id: "sv4-100" }])
  expect(await searchCards(db, "%%")).toEqual([])
  expect(await searchCards(db, "__")).toEqual([])
  expect(await searchCards(db, "ch_r")).toEqual([])
})

test("search needs at least two characters", async () => {
  expect(await searchCards(db, "c")).toEqual([])
  expect(await searchCards(db, "  ")).toEqual([])
})

test("search respects the limit", async () => {
  expect(await searchCards(db, "chariz", 2)).toHaveLength(2)
})

test("adding a new card creates a row", async () => {
  const result = await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  expect(result.merged).toBe(false)
  expect(await db.select().from(collectionItems)).toMatchObject([{ id: result.id, quantity: 1, source: "manual" }])
})

test("adding the same card, variant, condition and binder again raises the quantity", async () => {
  const first = await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  const second = await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 2, binder: "" })
  expect(second).toEqual({ id: first.id, merged: true })
  expect(await db.select().from(collectionItems)).toMatchObject([{ quantity: 3 }])
})

test("a different condition or binder is a separate row", async () => {
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "LP", quantity: 1 })
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1, binder: "Trade" })
  expect(await db.select().from(collectionItems)).toHaveLength(3)
})

test("adding rejects a bad quantity", async () => {
  for (const quantity of [0, -1, 1.5, 1000, Number.NaN]) {
    expect(await fieldOf(addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity }))).toBe("quantity")
  }
  expect(await db.select().from(collectionItems)).toHaveLength(0)
})

test("merging cannot push a row past the quantity limit", async () => {
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 999 })
  expect(await fieldOf(addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 }))).toBe("quantity")
})

test("adding rejects an unknown card, an empty variant and an unknown condition", async () => {
  expect(await fieldOf(addItem(db, { cardId: "nope-1", variant: "normal", condition: "NM", quantity: 1 }))).toBe("cardId")
  expect(await fieldOf(addItem(db, { cardId: "sv3pt5-199", variant: " ", condition: "NM", quantity: 1 }))).toBe("variant")
  expect(await fieldOf(addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "MINT" as never, quantity: 1 }))).toBe("condition")
})

test("updating changes the row", async () => {
  const { id } = await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  await updateItem(db, id, edit({ condition: "LP", quantity: 2, paidCents: 4550, acquiredOn: "2026-01-15", binder: "Main" }))
  const [row] = await db.select().from(collectionItems)
  expect(row).toMatchObject({ condition: "LP", quantity: 2, paidUsd: 45.5, acquiredOn: "2026-01-15", binder: "Main" })
})

test("updating rejects bad input and leaves the row unchanged", async () => {
  const { id } = await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 3 })
  for (const quantity of [0, -2, 2.5]) {
    expect(await fieldOf(updateItem(db, id, edit({ quantity })))).toBe("quantity")
  }
  expect(await fieldOf(updateItem(db, id, edit({ paidCents: -1 })))).toBe("paidCents")
  expect(await fieldOf(updateItem(db, id, edit({ acquiredOn: "2026-02-30" })))).toBe("acquiredOn")
  expect(await fieldOf(updateItem(db, id, edit({ acquiredOn: "2999-01-01" })))).toBe("acquiredOn")
  expect(await db.select().from(collectionItems)).toMatchObject([{ quantity: 3, condition: "NM", paidUsd: null }])
})

test("updating into another row's card, variant and condition is rejected", async () => {
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  const lp = await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "LP", quantity: 1 })
  expect(await fieldOf(updateItem(db, lp.id, edit({ condition: "NM" })))).toBe("variant")
  const [row] = await db.select().from(collectionItems).where(eq(collectionItems.id, lp.id))
  expect(row?.condition).toBe("LP")
})

test("updating a row that no longer exists is rejected", async () => {
  expect(await fieldOf(updateItem(db, 12345, edit()))).toBe("id")
})

test("removing deletes the row", async () => {
  const { id } = await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  await removeItem(db, id)
  expect(await db.select().from(collectionItems)).toHaveLength(0)
})

test("the total is quantity times the latest market price", async () => {
  await addItem(db, { cardId: "base1-58", variant: "normal", condition: "LP", quantity: 2 })
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  await db.insert(priceSnapshots).values([snapshot("base1-58", "normal", "2026-11-14", 4.1), snapshot("sv3pt5-199", "holofoil", "2026-11-14", 98.4)])
  expect(await collectionTotals(db)).toEqual({ totalCents: 10660, changeCents: null, unpricedCount: 0 })
})

test("a row with no snapshot is counted as unpriced, not as zero", async () => {
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  await addItem(db, { cardId: "sv3pt5-151", variant: "normal", condition: "NM", quantity: 4 })
  await db.insert(priceSnapshots).values(snapshot("sv3pt5-199", "holofoil", "2026-11-14", 98.4))
  expect(await collectionTotals(db)).toEqual({ totalCents: 9840, changeCents: null, unpricedCount: 1 })
  const rows = await listCollection(db, {})
  expect(rows.find((r) => r.cardId === "sv3pt5-151")).toMatchObject({ marketCents: null, rowTotalCents: null })
})

test("a snapshot for another variant of the card does not price the row", async () => {
  await addItem(db, { cardId: "sv3pt5-25", variant: "reverseHolofoil", condition: "NM", quantity: 1 })
  await db.insert(priceSnapshots).values(snapshot("sv3pt5-25", "normal", "2026-11-14", 0.21))
  expect(await collectionTotals(db)).toMatchObject({ totalCents: 0, unpricedCount: 1 })
})

test("the change compares each row's two most recent snapshots", async () => {
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 2 })
  await addItem(db, { cardId: "base1-58", variant: "normal", condition: "NM", quantity: 1 })
  await db.insert(priceSnapshots).values([
    snapshot("sv3pt5-199", "holofoil", "2026-11-12", 50),
    snapshot("sv3pt5-199", "holofoil", "2026-11-13", 90),
    snapshot("sv3pt5-199", "holofoil", "2026-11-14", 98.4),
    snapshot("base1-58", "normal", "2026-11-14", 4.1),
  ])
  expect(await collectionTotals(db)).toEqual({ totalCents: 20090, changeCents: 1680, unpricedCount: 0 })
})

test("an empty collection totals zero", async () => {
  expect(await collectionTotals(db)).toEqual({ totalCents: 0, changeCents: null, unpricedCount: 0 })
})

test("list rows carry the card, set and price details", async () => {
  await addItem(db, { cardId: "base1-58", variant: "normal", condition: "LP", quantity: 2 })
  await db.insert(priceSnapshots).values([snapshot("base1-58", "normal", "2026-11-13", 3), snapshot("base1-58", "normal", "2026-11-14", 4.1)])
  expect(await listCollection(db, {})).toMatchObject([
    {
      cardId: "base1-58",
      name: "Pikachu",
      setId: "base1",
      setName: "Base",
      number: "58",
      printedTotal: 102,
      variant: "normal",
      condition: "LP",
      quantity: 2,
      paidCents: null,
      cardVariants: ["normal"],
      marketCents: 410,
      rowTotalCents: 820,
    },
  ])
})

test("list filters by set, variant and condition", async () => {
  await addItem(db, { cardId: "base1-58", variant: "normal", condition: "LP", quantity: 1 })
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  expect((await listCollection(db, { setId: "base1" })).map((r) => r.cardId)).toEqual(["base1-58"])
  expect((await listCollection(db, { variant: "holofoil" })).map((r) => r.cardId)).toEqual(["sv3pt5-199"])
  expect((await listCollection(db, { condition: "LP" })).map((r) => r.cardId)).toEqual(["base1-58"])
  expect(await listCollection(db, { setId: "base1", condition: "NM" })).toEqual([])
})

test("list sorts by value with unpriced rows last, and by name, set and date added", async () => {
  await addItem(db, { cardId: "sv3pt5-151", variant: "normal", condition: "NM", quantity: 1 })
  await addItem(db, { cardId: "base1-58", variant: "normal", condition: "NM", quantity: 1 })
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  await db.insert(priceSnapshots).values([snapshot("base1-58", "normal", "2026-11-14", 4.1), snapshot("sv3pt5-199", "holofoil", "2026-11-14", 98.4)])
  const ids = async (sort?: "value" | "name" | "set" | "added") => (await listCollection(db, { sort })).map((r) => r.cardId)
  expect(await ids()).toEqual(["sv3pt5-199", "base1-58", "sv3pt5-151"])
  expect(await ids("name")).toEqual(["sv3pt5-199", "sv3pt5-151", "base1-58"])
  expect(await ids("set")).toEqual(["sv3pt5-151", "sv3pt5-199", "base1-58"])
  expect(await ids("added")).toEqual(["sv3pt5-199", "base1-58", "sv3pt5-151"])
})

test("filter options list only sets and variants in the collection", async () => {
  await addItem(db, { cardId: "base1-58", variant: "normal", condition: "LP", quantity: 1 })
  await addItem(db, { cardId: "sv3pt5-199", variant: "holofoil", condition: "NM", quantity: 1 })
  expect(await collectionFilterOptions(db)).toEqual({
    sets: [
      { id: "sv3pt5", name: "151" },
      { id: "base1", name: "Base" },
    ],
    variants: ["holofoil", "normal"],
  })
})

test("the default variant is the last one used when the card offers it", async () => {
  expect(await defaultVariant(db, ["normal", "reverseHolofoil"])).toBe("normal")
  await addItem(db, { cardId: "sv3pt5-25", variant: "reverseHolofoil", condition: "NM", quantity: 1 })
  expect(await defaultVariant(db, ["normal", "reverseHolofoil"])).toBe("reverseHolofoil")
  expect(await defaultVariant(db, ["holofoil"])).toBe("holofoil")
  expect(await defaultVariant(db, [])).toBe("normal")
})

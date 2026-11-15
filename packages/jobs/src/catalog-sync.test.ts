import { cards, sets, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { eq } from "drizzle-orm"
import { beforeEach, expect, test } from "vitest"
import { syncCatalog } from "./catalog-sync"
import { reprintKey } from "./normalize"
import { fakeProvider, makeCard, makeSet, type FakeProvider } from "./testing/fake-provider"

let db: Db
let provider: FakeProvider

beforeEach(async () => {
  db = await createTestDb()
  provider = fakeProvider({
    sets: [makeSet("a"), makeSet("b")],
    cards: [makeCard("a-1", { name: "Flabébé", rulesText: "Tackle" }), makeCard("a-2"), makeCard("b-1")],
  })
})

test("the first run fetches every set and stores its cards", async () => {
  const result = await syncCatalog(db, provider)
  expect(result).toEqual({ setsUpserted: 2, setsFetched: 2, cardsUpserted: 3 })
  const [card] = await db.select().from(cards).where(eq(cards.id, "a-1"))
  expect(card).toMatchObject({
    game: "pokemon",
    name: "Flabébé",
    nameSearch: "flabebe",
    reprintKey: reprintKey("Flabébé", "Tackle"),
    variants: ["normal"],
  })
})

test("a second run with nothing changed fetches no cards", async () => {
  await syncCatalog(db, provider)
  provider.calls.listCardsInSet = []
  const result = await syncCatalog(db, provider)
  expect(result.setsFetched).toBe(0)
  expect(provider.calls.listCardsInSet).toEqual([])
})

test("only a set whose updatedAt changed is fetched again", async () => {
  await syncCatalog(db, provider)
  provider.calls.listCardsInSet = []
  provider.sets[1] = makeSet("b", { updatedAt: "2024/05/05 00:00:00" })
  const result = await syncCatalog(db, provider)
  expect(result.setsFetched).toBe(1)
  expect(provider.calls.listCardsInSet).toEqual(["b"])
})

test("full fetches every set regardless", async () => {
  await syncCatalog(db, provider)
  const result = await syncCatalog(db, provider, { full: true })
  expect(result.setsFetched).toBe(2)
})

test("a set that fails mid-run is retried on the next run", async () => {
  provider.fail.listCardsInSet = { b: new Error("boom") }
  await expect(syncCatalog(db, provider)).rejects.toThrow("boom")
  const stored = await db.select().from(sets)
  expect(stored.find((s) => s.id === "a")?.providerUpdatedAt).toBe("2023/01/01 00:00:00")
  expect(stored.find((s) => s.id === "b")?.providerUpdatedAt ?? null).toBeNull()

  provider.fail = {}
  provider.calls.listCardsInSet = []
  await syncCatalog(db, provider)
  expect(provider.calls.listCardsInSet).toEqual(["b"])
})

test("running again does not duplicate rows and overwrites catalog fields", async () => {
  await syncCatalog(db, provider)
  provider.cards[1] = makeCard("a-2", { rarity: "Rare", variants: ["holofoil"] })
  await syncCatalog(db, provider, { full: true })
  expect(await db.select().from(cards)).toHaveLength(3)
  const [card] = await db.select().from(cards).where(eq(cards.id, "a-2"))
  expect(card).toMatchObject({ rarity: "Rare", variants: ["holofoil"] })
})

test("progress is reported once per fetched set", async () => {
  const seen: string[] = []
  await syncCatalog(db, provider, { onSet: (p) => seen.push(`${p.setId} ${p.cards} ${p.done}/${p.total}`) })
  expect(seen).toEqual(["a 2 1/2", "b 1 2/2"])
  seen.length = 0
  await syncCatalog(db, provider, { onSet: (p) => seen.push(p.setId) })
  expect(seen).toEqual([])
})

import { sets, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { upsertCards } from "@poketrack/jobs"
import { beforeEach, expect, test, vi } from "vitest"

let db: Db
vi.mock("@/lib/db", () => ({ getDb: () => db }))
const { GET } = await import("./route")

beforeEach(async () => {
  db = await createTestDb()
  await db.insert(sets).values({ id: "sv3pt5", name: "151", series: "S", printedTotal: 165, releaseDate: "2023-09-22" })
  await upsertCards(db, [
    { id: "sv3pt5-199", name: "Charizard ex", setId: "sv3pt5", number: "199", printedTotal: 165, rarity: null, imageSmall: null, imageLarge: null, legalities: {}, rulesText: "", variants: ["holofoil"] },
  ])
})

test("returns matching cards", async () => {
  const response = await GET(new Request("https://poketrack.test/api/cards/search?q=chariz"))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject([{ id: "sv3pt5-199", name: "Charizard ex", setName: "151" }])
})

test("a missing query returns an empty list", async () => {
  const response = await GET(new Request("https://poketrack.test/api/cards/search"))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual([])
})

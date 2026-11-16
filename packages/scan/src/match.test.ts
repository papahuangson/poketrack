import type { Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { beforeEach, expect, test } from "vitest"
import { matchSlot, proposeVariant, type SlotRead } from "./match"
import { seed } from "./testing"

let db: Db
const noCues = { holo: false, reverse: false, firstEdition: false }
const read = (r: Partial<SlotRead>): SlotRead => ({ name: null, numberAsPrinted: null, setCode: null, cues: noCues, confidence: 1, ...r })

beforeEach(async () => {
  db = await createTestDb()
  await seed(
    db,
    [
      { id: "sv3pt5", printedTotal: 165, ptcgoCode: "MEW" },
      { id: "base1", printedTotal: 102 },
      { id: "xy1", printedTotal: 146 },
      { id: "xy2", printedTotal: 146 },
    ],
    [
      { id: "sv3pt5-199", name: "Charizard ex", setId: "sv3pt5", number: "199" },
      { id: "base1-4", name: "Charizard", setId: "base1", number: "4" },
      { id: "base1-58", name: "Pikachu", setId: "base1", number: "58" },
      { id: "xy1-12", name: "Pidgey", setId: "xy1", number: "12" },
      { id: "xy2-12", name: "Pidgeot", setId: "xy2", number: "12" },
    ],
  )
})

test("set code + number is an exact match at 1.0", async () => {
  const m = await matchSlot(db, read({ setCode: "MEW", numberAsPrinted: "199/165", confidence: 0.95 }))
  expect(m.candidates[0]).toEqual({ cardId: "sv3pt5-199", score: 1, via: "code" })
  expect(m.confidence).toBe(0.95)
})

test("set code is case-insensitive", async () => {
  const m = await matchSlot(db, read({ setCode: "mew", numberAsPrinted: "199/165" }))
  expect(m.candidates[0]?.cardId).toBe("sv3pt5-199")
})

test("null set code falls through to printed total", async () => {
  const m = await matchSlot(db, read({ name: "Pikachu", numberAsPrinted: "58/102" }))
  expect(m.candidates[0]).toEqual({ cardId: "base1-58", score: 0.9, via: "total" })
  expect(m.confidence).toBe(0.9)
})

test("shared printed total ranks by name and caps at 0.8", async () => {
  const m = await matchSlot(db, read({ name: "Pidgeot", numberAsPrinted: "12/146" }))
  expect(m.candidates[0]?.cardId).toBe("xy2-12")
  expect(m.candidates[0]?.score).toBeLessThanOrEqual(0.8)
  expect(m.candidates[1]?.cardId).toBe("xy1-12")
})

test("name below 0.4 similarity is not a printed-total hit", async () => {
  const m = await matchSlot(db, read({ name: "Mewtwo", numberAsPrinted: "58/102" }))
  expect(m.candidates.some((c) => c.cardId === "base1-58" && c.via === "total")).toBe(false)
})

test("fuzzy name fallback returns at most 3 with score ≤ 0.7", async () => {
  const m = await matchSlot(db, read({ name: "Charizrd" }))
  expect(m.candidates.length).toBeGreaterThan(0)
  expect(m.candidates.length).toBeLessThanOrEqual(3)
  for (const c of m.candidates) {
    expect(c.via).toBe("name")
    expect(c.score).toBeLessThanOrEqual(0.7)
  }
  expect(m.candidates.map((c) => c.cardId)).toContain("base1-4")
})

test("number boosts fuzzy name", async () => {
  const m = await matchSlot(db, read({ name: "Charizrd", numberAsPrinted: "4" }))
  expect(m.candidates[0]?.cardId).toBe("base1-4")
})

test("unreadable slot has no candidates", async () => {
  expect(await matchSlot(db, read({}))).toEqual({ candidates: [], confidence: 0 })
})

test("proposeVariant follows cues within the card's variants", () => {
  expect(proposeVariant({ ...noCues, reverse: true }, ["normal", "reverseHolofoil"], "normal")).toBe("reverseHolofoil")
  expect(proposeVariant({ ...noCues, holo: true }, ["holofoil"], "normal")).toBe("holofoil")
  expect(proposeVariant({ ...noCues, holo: true }, ["normal"], "normal")).toBe("normal")
  expect(proposeVariant(noCues, ["holofoil", "reverseHolofoil"], "normal")).toBe("holofoil")
})

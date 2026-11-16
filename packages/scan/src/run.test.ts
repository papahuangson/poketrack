import { collectionItems, scanResults, scans, type Db } from "@poketrack/db"
import { ValidationError } from "@poketrack/db/errors"
import { createTestDb } from "@poketrack/db/testing"
import type { Message } from "@anthropic-ai/sdk/resources/messages"
import { eq } from "@poketrack/db"
import { beforeEach, expect, test, vi } from "vitest"
import { PROMPT_VERSION, type ModelClient } from "./read"
import { runScan, type NewScan } from "./run"
import { seed } from "./testing"

let db: Db
const input: NewScan = { imageUrl: "https://x.public.blob.vercel-storage.com/p.jpg", width: 2000, height: 1500, binder: "  Main ", page: 3 }
const opts = { model: "claude-test", defaultVariant: async (v: string[]) => v[0] ?? "normal", retryDelayMs: 0 }

const slot = (n: number, s: Record<string, unknown> = {}) => ({
  slot: n,
  empty: false,
  name: "Pikachu",
  number_as_printed: "58/102",
  set_code: null,
  cues: { holo: false, reverse: false, first_edition: false },
  confidence: 0.95,
  box: { x: 0, y: 0, w: 0.3, h: 0.3 },
  ...s,
})

const page = [
  slot(1, { name: "Charizard ex", number_as_printed: "199/165", set_code: "MEW", cues: { holo: true, reverse: false, first_edition: false } }),
  slot(2),
  slot(3, { confidence: 0.5 }),
  slot(4, { name: "Zzzz", number_as_printed: null }),
  slot(5, { empty: true, name: null, number_as_printed: null }),
  ...[6, 7, 8, 9].map((n) => slot(n)),
]

const reply = (slots: unknown[]): Message =>
  ({ content: [{ type: "tool_use", id: "t", name: "report_slots", input: { slots } }] }) as unknown as Message
const client = (slots: unknown[]): ModelClient => ({ create: vi.fn().mockResolvedValue(reply(slots)) })

beforeEach(async () => {
  db = await createTestDb()
  await seed(
    db,
    [{ id: "sv3pt5", printedTotal: 165, ptcgoCode: "MEW" }, { id: "base1", printedTotal: 102 }],
    [
      { id: "sv3pt5-199", name: "Charizard ex", setId: "sv3pt5", number: "199", variants: ["normal", "holofoil"] },
      { id: "base1-58", name: "Pikachu", setId: "base1", number: "58", variants: ["normal"] },
    ],
  )
})

const resultsOf = (scanId: number) => db.select().from(scanResults).where(eq(scanResults.scanId, scanId)).orderBy(scanResults.slot)

test("creates scan as reading, then ready with 9 results", async () => {
  const { scanId, status } = await runScan(db, client(page), input, opts)
  expect(status).toBe("ready")
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId))
  expect(scan).toMatchObject({ status: "ready", binder: "Main", page: 3, model: "claude-test", promptVersion: PROMPT_VERSION, imageWidth: 2000 })
  const results = await resultsOf(scanId)
  expect(results).toHaveLength(9)
  expect(results[1]).toMatchObject({ readName: "Pikachu", readNumber: "58", readPrintedTotal: 102, readSetCode: null })
  expect(results[0]?.candidates[0]).toEqual({ cardId: "sv3pt5-199", score: 1, via: "code" })
  expect(results[0]?.box).toEqual({ x: 0, y: 0, w: 0.3, h: 0.3 })
})

test("pre-confirms at ≥ 0.9 with chosen card and proposed variant", async () => {
  const { scanId } = await runScan(db, client(page), input, opts)
  const [first] = await resultsOf(scanId)
  expect(first).toMatchObject({ decision: "confirmed", chosenCardId: "sv3pt5-199", variant: "holofoil", confidence: 0.95 })
})

test("below 0.9 stays pending with chosen = top candidate or null", async () => {
  const { scanId } = await runScan(db, client(page), input, opts)
  const results = await resultsOf(scanId)
  expect(results[2]).toMatchObject({ decision: "pending", chosenCardId: "base1-58", variant: "normal" })
  expect(results[3]).toMatchObject({ decision: "pending", chosenCardId: null, variant: null })
})

test("empty pockets are stored as empty", async () => {
  const { scanId } = await runScan(db, client(page), input, opts)
  const results = await resultsOf(scanId)
  expect(results[4]).toMatchObject({ empty: true, decision: "pending", chosenCardId: null })
})

test("condition defaults to NM", async () => {
  const { scanId } = await runScan(db, client(page), input, opts)
  for (const r of await resultsOf(scanId)) expect(r.condition).toBe("NM")
})

test("claimManual starts true when a binder-less lot of the chosen card and variant exists", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", quantity: 1 })
  await db.insert(collectionItems).values({ cardId: "sv3pt5-199", variant: "holofoil", binder: "Trades" })
  const { scanId } = await runScan(db, client(page), input, opts)
  const results = await resultsOf(scanId)
  expect(results[1]?.claimManual).toBe(true)
  expect(results[0]?.claimManual).toBe(false)
})

test("ReadError marks scan failed with the error text and writes no results", async () => {
  const failing: ModelClient = { create: vi.fn().mockResolvedValue({ content: [] } as unknown as Message) }
  const { scanId, status } = await runScan(db, failing, input, opts)
  expect(status).toBe("failed")
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId))
  expect(scan?.status).toBe("failed")
  expect(scan?.error).toMatch(/did not report/)
  expect(await resultsOf(scanId)).toHaveLength(0)
})

test("binder is trimmed and validated", async () => {
  await expect(runScan(db, client(page), { ...input, binder: "  " }, opts)).rejects.toBeInstanceOf(ValidationError)
  await expect(runScan(db, client(page), { ...input, page: 0 }, opts)).rejects.toBeInstanceOf(ValidationError)
  expect(await db.select().from(scans)).toHaveLength(0)
})

async function committedPage(binder: string, page: number, cardId: string, variant: string) {
  const [s] = await db
    .insert(scans)
    .values({ imageUrl: "u", imageWidth: 1, imageHeight: 1, binder, page, status: "committed" })
    .returning()
  await db.insert(scanResults).values({ scanId: s!.id, slot: 1, chosenCardId: cardId, variant, decision: "confirmed" })
}

test("a rescan doesn't default the claim for a card the page's previous scan already held", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", quantity: 2 })
  await committedPage("main", 3, "base1-58", "normal")
  const { scanId } = await runScan(db, client(page), input, opts)
  const results = await resultsOf(scanId)
  // Slots 2, 3, 6–9 are Pikachu; the previous scan held one, so the first stays unclaimed and later ones default on.
  expect(results[1]?.claimManual).toBe(false)
  expect(results[2]?.claimManual).toBe(true)
})

test("a scan of a different page still defaults the claim", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", quantity: 1 })
  await committedPage("Main", 2, "base1-58", "normal")
  const { scanId } = await runScan(db, client(page), input, opts)
  expect((await resultsOf(scanId))[1]?.claimManual).toBe(true)
})

test("a defaulted claim takes the typed-in copy's condition", async () => {
  await db.insert(collectionItems).values({ cardId: "base1-58", variant: "normal", quantity: 1, condition: "LP" })
  const { scanId } = await runScan(db, client(page), input, opts)
  const results = await resultsOf(scanId)
  expect(results[1]).toMatchObject({ claimManual: true, condition: "LP" })
  expect(results[0]?.condition).toBe("NM")
})

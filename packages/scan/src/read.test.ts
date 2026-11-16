import { APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk"
import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages"
import { readFileSync } from "node:fs"
import { expect, test, vi } from "vitest"
import { readPage, ReadError, type ModelClient } from "./read"

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"))

const message = (input: unknown): Message =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "test",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: "tool_use", id: "tu_1", name: "report_slots", input }],
  }) as unknown as Message

const client = (...replies: (unknown | Error)[]): ModelClient & { create: ReturnType<typeof vi.fn> } => {
  const create = vi.fn()
  for (const r of replies) {
    if (r instanceof Error) create.mockRejectedValueOnce(r)
    else create.mockResolvedValueOnce(message(r))
  }
  return { create }
}

const opts = { imageUrl: "https://x.public.blob.vercel-storage.com/p.jpg", model: "claude-test", retryDelayMs: 0 }

test("full page fixture yields 9 slots in order with parsed fields", async () => {
  const slots = await readPage(client(fixture("read-full")), opts)
  expect(slots.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  expect(slots[0]).toMatchObject({
    empty: false,
    name: "Charizard ex",
    numberAsPrinted: "199/165",
    setCode: "MEW",
    cues: { holo: true, reverse: false, firstEdition: false },
    confidence: 0.95,
  })
  expect(slots[0]?.box).toEqual({ x: 0, y: 0, w: 0.33, h: 0.33 })
})

test("empty pockets come back empty:true with no name", async () => {
  const slots = await readPage(client(fixture("read-empties")), opts)
  expect(slots[7]).toMatchObject({ empty: true, name: null, numberAsPrinted: null })
})

test("missing slots are filled as unreadable, not empty", async () => {
  const slots = await readPage(client(fixture("read-missing")), opts)
  expect(slots).toHaveLength(9)
  expect(slots[7]).toMatchObject({ slot: 8, empty: false, name: null, confidence: 0, box: null })
  expect(slots[8]).toMatchObject({ slot: 9, empty: false, name: null, confidence: 0 })
})

test("extra and duplicate slots: out-of-range dropped, duplicate keeps higher confidence", async () => {
  const slots = await readPage(client(fixture("read-odd")), opts)
  expect(slots).toHaveLength(9)
  expect(slots[0]?.name).toBe("Raichu")
  expect(slots.some((s) => s.name === "Ghost")).toBe(false)
})

test("boxes clamp to 0–1, and confidence clamps to 0–1", async () => {
  const [first] = await readPage(client(fixture("read-odd")), opts)
  expect(first?.confidence).toBe(1)
  expect(first?.box).toEqual({ x: 0, y: 0.1, w: 1, h: 0.3 })
})

test("retries once on a 5xx or timeout, then succeeds", async () => {
  const overloaded = new APIError(529, undefined, "overloaded", new Headers())
  const c = client(overloaded, fixture("read-full"))
  await expect(readPage(c, opts)).resolves.toHaveLength(9)
  expect(c.create).toHaveBeenCalledTimes(2)

  const t = client(new APIConnectionTimeoutError(), fixture("read-full"))
  await expect(readPage(t, opts)).resolves.toHaveLength(9)
})

test("throws ReadError after the second failure", async () => {
  const err = new APIError(500, undefined, "boom", new Headers())
  await expect(readPage(client(err, err), opts)).rejects.toBeInstanceOf(ReadError)
})

test("does not retry a 4xx", async () => {
  const c = client(new APIError(400, undefined, "bad", new Headers()), fixture("read-full"))
  await expect(readPage(c, opts)).rejects.toBeInstanceOf(ReadError)
  expect(c.create).toHaveBeenCalledTimes(1)
})

test("malformed tool output throws ReadError", async () => {
  await expect(readPage(client(fixture("read-malformed")), opts)).rejects.toBeInstanceOf(ReadError)
})

test("request uses the image URL and forces the tool", async () => {
  const c = client(fixture("read-full"))
  await readPage(c, opts)
  const params = c.create.mock.calls[0]?.[0] as MessageCreateParamsNonStreaming
  expect(params.model).toBe("claude-test")
  expect(params.tool_choice).toEqual({ type: "tool", name: "report_slots" })
  const content = params.messages[0]?.content
  expect(Array.isArray(content) && content.some((b) => b.type === "image" && b.source.type === "url" && b.source.url === opts.imageUrl)).toBe(true)
})

import { APIConnectionError, APIError } from "@anthropic-ai/sdk"
import type { Message, MessageCreateParamsNonStreaming, Tool } from "@anthropic-ai/sdk/resources/messages"
import type { SlotBox, SlotCues } from "@poketrack/db"
import type { SlotRead } from "./match"

type PageSlot = SlotRead & { slot: number; empty: boolean; box: SlotBox | null }
type ModelClient = { create(params: MessageCreateParamsNonStreaming): Promise<Message> }
type InlineImage = { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string }
type ImageSource = { type: "url"; url: string } | ({ type: "base64" } & InlineImage)
type ReadOptions = { model: string; retryDelayMs?: number } & ({ imageUrl: string; image?: never } | { image: ImageSource; imageUrl?: never })

const PROMPT_VERSION = "p2-v1"
const SLOT_COUNT = 9

class ReadError extends Error {
  override name = "ReadError"
}

const TOOL: Tool = {
  name: "report_slots",
  description: "Report what is in each of the 9 pockets of the binder page.",
  input_schema: {
    type: "object",
    required: ["slots"],
    properties: {
      slots: {
        type: "array",
        items: {
          type: "object",
          required: ["slot", "empty", "name", "number_as_printed", "set_code", "cues", "confidence", "box"],
          properties: {
            slot: { type: "integer", description: "1-9, row by row from the top left" },
            empty: { type: "boolean" },
            name: { type: ["string", "null"], description: "Card name exactly as printed" },
            number_as_printed: { type: ["string", "null"], description: "Collector number exactly as printed, e.g. 199/165" },
            set_code: { type: ["string", "null"], description: "Set code printed on the card (Scarlet & Violet era and later), else null" },
            cues: {
              type: "object",
              required: ["holo", "reverse", "first_edition"],
              properties: {
                holo: { type: "boolean", description: "The artwork itself is holographic" },
                reverse: { type: "boolean", description: "The card body outside the artwork is holographic" },
                first_edition: { type: "boolean", description: "A 1st Edition stamp is visible" },
              },
            },
            confidence: { type: "number", description: "0-1, how sure you are of name and number" },
            box: {
              type: "object",
              description: "Pocket bounds as fractions of the image width and height",
              required: ["x", "y", "w", "h"],
              properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
            },
          },
        },
      },
    },
  },
}

const PROMPT = `This photo shows one page of a 9-pocket binder of English Pokémon cards (3 rows of 3).
For each pocket, numbered 1-9 row by row from the top left, call report_slots once with all 9 pockets.
- Report the name, collector number and set code exactly as printed. Do not guess: if you cannot read something, use null and lower the confidence.
- Lower the confidence when glare, a sleeve seen at an angle, or anything else hides part of the name or number.
- Mark a pocket with no card as empty: true.`

const clamp01 = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)
const object = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

function toBox(v: unknown): SlotBox | null {
  const b = object(v)
  if (!b) return null
  const x = clamp01(b.x)
  const y = clamp01(b.y)
  return { x, y, w: Math.min(clamp01(b.w), 1 - x), h: Math.min(clamp01(b.h), 1 - y) }
}

function toCues(v: unknown): SlotCues {
  const c = object(v) ?? {}
  return { holo: c.holo === true, reverse: c.reverse === true, firstEdition: c.first_edition === true }
}

const unreadable = (slot: number): PageSlot => ({
  slot,
  empty: false,
  name: null,
  numberAsPrinted: null,
  setCode: null,
  cues: { holo: false, reverse: false, firstEdition: false },
  confidence: 0,
  box: null,
})

function normalizeSlots(raw: unknown): PageSlot[] {
  const slots = object(raw)?.slots
  if (!Array.isArray(slots)) throw new ReadError("The model's answer had no list of pockets.")
  const bySlot = new Map<number, PageSlot>()
  for (const item of slots) {
    const s = object(item)
    const slot = s?.slot
    if (!s || typeof slot !== "number" || !Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) continue
    const empty = s.empty === true
    const parsed: PageSlot = {
      slot,
      empty,
      name: empty ? null : text(s.name),
      numberAsPrinted: empty ? null : text(s.number_as_printed),
      setCode: empty ? null : text(s.set_code),
      cues: toCues(s.cues),
      confidence: clamp01(s.confidence),
      box: toBox(s.box),
    }
    const seen = bySlot.get(slot)
    if (!seen || parsed.confidence > seen.confidence) bySlot.set(slot, parsed)
  }
  return Array.from({ length: SLOT_COUNT }, (_, i) => bySlot.get(i + 1) ?? unreadable(i + 1))
}

const retryable = (error: unknown) =>
  error instanceof APIConnectionError || (error instanceof APIError && typeof error.status === "number" && error.status >= 500)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function imageBlock(image: ImageSource) {
  return image.type === "url"
    ? ({ type: "url", url: image.url } as const)
    : ({ type: "base64", media_type: image.mediaType, data: image.data } as const)
}

async function readPage(client: ModelClient, opts: ReadOptions): Promise<PageSlot[]> {
  const params: MessageCreateParamsNonStreaming = {
    model: opts.model,
    max_tokens: 4096,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: imageBlock(opts.image ?? { type: "url", url: opts.imageUrl! }) },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  }

  let message: Message | undefined
  for (let attempt = 1; attempt <= 2 && !message; attempt++) {
    try {
      message = await client.create(params)
    } catch (error) {
      if (attempt === 2 || !retryable(error)) {
        throw new ReadError(`Reading the photo failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
      await sleep(opts.retryDelayMs ?? 1000)
    }
  }

  const call = message?.content.find((b) => b.type === "tool_use" && b.name === TOOL.name)
  if (!call || call.type !== "tool_use") throw new ReadError("The model did not report any pockets.")
  return normalizeSlots(call.input)
}

export { normalizeSlots, PROMPT_VERSION, readPage, ReadError }
export type { ImageSource, InlineImage, ModelClient, PageSlot, ReadOptions }

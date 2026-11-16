import { and, cards, collectionItems, eq, inArray, scanResults, scans, sql, type Db } from "@poketrack/db"
import { ValidationError } from "@poketrack/db/errors"
import { matchSlot, proposeVariant } from "./match"
import { parseNumber } from "./parse"
import { PROMPT_VERSION, readPage, ReadError, type ModelClient } from "./read"

type NewScan = { imageUrl: string; width: number; height: number; binder: string; page: number }
type RunOptions = {
  model: string
  defaultVariant: (cardVariants: string[]) => Promise<string>
  retryDelayMs?: number
}

const AUTO_CONFIRM = 0.9

function checkInput(input: NewScan): NewScan {
  const binder = input.binder.trim()
  if (binder === "") throw new ValidationError("binder", "Choose a binder.")
  if (!Number.isInteger(input.page) || input.page < 1) throw new ValidationError("page", "Page must be a whole number from 1 up.")
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1) {
    throw new ValidationError("image", "The photo size is missing.")
  }
  return { ...input, binder }
}

async function hasManualLot(db: Db, cardId: string, variant: string): Promise<boolean> {
  const [lot] = await db
    .select({ id: collectionItems.id })
    .from(collectionItems)
    .where(
      and(
        eq(collectionItems.cardId, cardId),
        eq(collectionItems.variant, variant),
        sql`coalesce(trim(${collectionItems.binder}), '') = ''`,
        sql`${collectionItems.quantity} > 0`,
      ),
    )
    .limit(1)
  return lot !== undefined
}

async function runScan(db: Db, client: ModelClient, raw: NewScan, opts: RunOptions): Promise<{ scanId: number; status: "ready" | "failed" }> {
  const input = checkInput(raw)
  const [scan] = await db
    .insert(scans)
    .values({
      imageUrl: input.imageUrl,
      imageWidth: input.width,
      imageHeight: input.height,
      binder: input.binder,
      page: input.page,
      model: opts.model,
      promptVersion: PROMPT_VERSION,
    })
    .returning({ id: scans.id })
  if (!scan) throw new Error("Insert returned no scan")

  try {
    const slots = await readPage(client, { imageUrl: input.imageUrl, model: opts.model, retryDelayMs: opts.retryDelayMs })
    const matches = await Promise.all(slots.map((s) => (s.empty ? null : matchSlot(db, s))))

    const chosenIds = [...new Set(matches.flatMap((m) => (m?.candidates[0] ? [m.candidates[0].cardId] : [])))]
    const variantsById = new Map(
      chosenIds.length === 0
        ? []
        : (await db.select({ id: cards.id, variants: cards.variants }).from(cards).where(inArray(cards.id, chosenIds))).map(
            (c) => [c.id, c.variants] as const,
          ),
    )

    const rows = await Promise.all(
      slots.map(async (s, i) => {
        const match = matches[i]
        const parsed = parseNumber(s.numberAsPrinted)
        const chosenCardId = match?.candidates[0]?.cardId ?? null
        const cardVariants = chosenCardId ? (variantsById.get(chosenCardId) ?? []) : []
        const variant = chosenCardId ? proposeVariant(s.cues, cardVariants, await opts.defaultVariant(cardVariants)) : null
        const confidence = match?.confidence ?? (s.empty ? s.confidence : 0)
        return {
          scanId: scan.id,
          slot: s.slot,
          empty: s.empty,
          readName: s.name,
          readNumber: parsed?.number ?? null,
          readPrintedTotal: parsed?.printedTotal ?? null,
          readSetCode: s.setCode,
          readCues: s.cues,
          confidence,
          box: s.box,
          candidates: match?.candidates ?? [],
          chosenCardId,
          variant,
          decision: chosenCardId && confidence >= AUTO_CONFIRM ? ("confirmed" as const) : ("pending" as const),
          claimManual: chosenCardId && variant ? await hasManualLot(db, chosenCardId, variant) : false,
        }
      }),
    )

    await db.transaction(async (tx) => {
      await tx.insert(scanResults).values(rows)
      await tx.update(scans).set({ status: "ready" }).where(eq(scans.id, scan.id))
    })
    return { scanId: scan.id, status: "ready" }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.update(scans).set({ status: "failed", error: message }).where(eq(scans.id, scan.id))
    if (error instanceof ReadError) return { scanId: scan.id, status: "failed" }
    throw error
  }
}

export { AUTO_CONFIRM, runScan }
export type { NewScan, RunOptions }

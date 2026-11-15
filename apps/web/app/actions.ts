"use server"

import { chicagoDate, priceSnapshots } from "@poketrack/db"
import { createPokemonTcgIo, snapshotCard } from "@poketrack/jobs"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { addItem, defaultVariant, removeItem, updateItem, type AddInput, type EditInput } from "@/lib/collection"
import { getDb } from "@/lib/db"
import { ValidationError } from "@/lib/errors"

type ActionResult = { ok: true } | { ok: false; field: string; message: string }

async function run(work: () => Promise<void>): Promise<ActionResult> {
  try {
    await work()
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, field: error.field, message: error.message }
    throw error
  }
  revalidatePath("/")
  return { ok: true }
}

async function priceIfMissing(cardId: string): Promise<void> {
  const db = getDb()
  const today = chicagoDate()
  const [existing] = await db
    .select({ cardId: priceSnapshots.cardId })
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.cardId, cardId), eq(priceSnapshots.date, today)))
    .limit(1)
  if (existing) return
  try {
    await snapshotCard(db, createPokemonTcgIo({ apiKey: process.env.POKEMONTCG_API_KEY }), cardId, today)
  } catch (error) {
    console.error(`Could not fetch a price for ${cardId}`, error)
  }
}

async function addCardAction(input: AddInput): Promise<ActionResult> {
  return run(async () => {
    await addItem(getDb(), input)
    await priceIfMissing(input.cardId)
  })
}

async function updateItemAction(id: number, input: EditInput): Promise<ActionResult> {
  return run(() => updateItem(getDb(), id, input))
}

async function removeItemAction(id: number): Promise<ActionResult> {
  return run(() => removeItem(getDb(), id))
}

async function defaultVariantAction(cardVariants: string[]): Promise<string> {
  return defaultVariant(getDb(), cardVariants)
}

export { addCardAction, defaultVariantAction, removeItemAction, updateItemAction }
export type { ActionResult }

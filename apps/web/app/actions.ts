"use server"

import { revalidatePath } from "next/cache"
import { addItem, defaultVariant, removeItem, updateItem, type AddInput, type EditInput } from "@/lib/collection"
import { getDb } from "@/lib/db"
import { ValidationError } from "@/lib/errors"
import { priceIfMissing } from "@/lib/price-on-add"

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

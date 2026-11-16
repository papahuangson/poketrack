"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import type { ActionResult } from "@/app/actions"
import { getDb } from "@/lib/db"
import { ValidationError } from "@/lib/errors"
import { priceIfMissing } from "@/lib/price-on-add"
import { commitScan } from "@/lib/scan-commit"
import { loadReview, updateSlot, type SlotPatch } from "@/lib/scan-review"

async function updateSlotAction(resultId: number, patch: SlotPatch): Promise<ActionResult> {
  try {
    const { scanId } = await updateSlot(getDb(), resultId, patch)
    revalidatePath(`/scans/${scanId}`)
    return { ok: true }
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, field: error.field, message: error.message }
    throw error
  }
}

async function commitScanAction(scanId: number): Promise<ActionResult> {
  const db = getDb()
  try {
    await commitScan(db, scanId)
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, field: error.field, message: error.message }
    throw error
  }
  const review = await loadReview(db, scanId)
  const cardIds = new Set(review?.slots.flatMap((s) => (s.decision === "confirmed" && s.chosen ? [s.chosen.id] : [])) ?? [])
  await Promise.allSettled([...cardIds].map((id) => priceIfMissing(id)))
  revalidatePath("/")
  revalidatePath(`/scans/${scanId}`)
  redirect(`/?scanned=${scanId}`)
}

export { commitScanAction, updateSlotAction }

"use server"

import { revalidatePath } from "next/cache"
import type { ActionResult } from "@/app/actions"
import { getDb } from "@/lib/db"
import { ValidationError } from "@/lib/errors"
import { updateSlot, type SlotPatch } from "@/lib/scan-review"

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

export { updateSlotAction }

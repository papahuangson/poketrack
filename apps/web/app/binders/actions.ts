"use server"

import type { Condition } from "@poketrack/db/constants"
import { revalidatePath } from "next/cache"
import type { ActionResult } from "@/app/actions"
import { searchOwned, type OwnedHit } from "@/lib/binder-view"
import { getDb } from "@/lib/db"
import { ValidationError } from "@/lib/errors"
import { editSurplus, movePocketCopy, removePocketCopy, removeSurplus, setLotDetails, type SurplusInput } from "@/lib/pocket-edit"

function checkId(field: "pocket" | "lot", id: unknown): asserts id is number {
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
    throw new ValidationError(field, field === "pocket" ? "That pocket changed. Reload the page." : "That card is no longer in your collection.")
  }
}

async function run(work: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await work()
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, field: error.field, message: error.message }
    throw error
  }
  revalidatePath("/binders")
  revalidatePath("/")
  return { ok: true }
}

type MoveResult = { ok: true; lotId: number } | Extract<ActionResult, { ok: false }>

// Returns the lot the pocket's copy landed in, so the form can save paid price and date onto that lot.
async function movePocketAction(resultId: number, to: { variant: string; condition: Condition }): Promise<MoveResult> {
  let lotId = 0
  const result = await run(async () => {
    checkId("pocket", resultId)
    lotId = (await movePocketCopy(getDb(), resultId, { variant: String(to?.variant ?? ""), condition: to?.condition })).lotId
  })
  return result.ok ? { ok: true, lotId } : result
}

async function removePocketAction(resultId: number): Promise<ActionResult> {
  return run(async () => {
    checkId("pocket", resultId)
    await removePocketCopy(getDb(), resultId)
  })
}

async function setLotDetailsAction(lotId: number, d: { paidCents: number | null; acquiredOn: string | null }): Promise<ActionResult> {
  return run(async () => {
    checkId("lot", lotId)
    await setLotDetails(getDb(), lotId, { paidCents: d?.paidCents ?? null, acquiredOn: d?.acquiredOn ?? null })
  })
}

async function editSurplusAction(lotId: number, input: SurplusInput): Promise<ActionResult> {
  return run(async () => {
    checkId("lot", lotId)
    await editSurplus(getDb(), lotId, {
      variant: String(input?.variant ?? ""),
      condition: input?.condition,
      quantity: input?.quantity,
      binder: typeof input?.binder === "string" ? input.binder : null,
    })
  })
}

async function removeSurplusAction(lotId: number): Promise<ActionResult> {
  return run(async () => {
    checkId("lot", lotId)
    await removeSurplus(getDb(), lotId)
  })
}

async function searchOwnedAction(q: string): Promise<OwnedHit[]> {
  if (typeof q !== "string") return []
  return searchOwned(getDb(), q.slice(0, 100))
}

export { editSurplusAction, movePocketAction, removePocketAction, removeSurplusAction, searchOwnedAction, setLotDetailsAction }

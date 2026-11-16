"use client"

import { useRef, useState, useTransition, type KeyboardEvent } from "react"
import { commitScanAction, updateSlotAction } from "@/app/scans/[id]/actions"
import type { Review, ReviewSlot, SlotPatch } from "@/lib/scan-review"
import { Pocket } from "./pocket"

const MOVES: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }

function summary(slots: ReviewSlot[]): string {
  const matched = slots.filter((s) => !s.empty && s.decision === "confirmed").length
  const check = slots.filter((s) => !s.empty && s.decision === "pending").length
  const empty = slots.filter((s) => s.empty).length
  const rejected = slots.filter((s) => !s.empty && s.decision === "rejected").length
  return [`${matched} matched`, `${check} check`, `${empty} empty`, ...(rejected ? [`${rejected} rejected`] : [])].join(" · ")
}

function ReviewGrid({ review }: { review: Review }) {
  const [slots, setSlots] = useState(review.slots)
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [focused, setFocused] = useState(0)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [committing, startCommit] = useTransition()
  const refs = useRef<(HTMLElement | null)[]>([])

  const readOnly = review.scan.status !== "ready"
  const photo = { imageUrl: `/api/scans/${review.scan.id}/photo`, width: review.scan.width, height: review.scan.height }
  const cards = slots.filter((s) => !s.empty && s.decision === "confirmed").length
  const undecided = slots.some((s) => !s.empty && s.decision === "pending")
  const canCommit = !readOnly && !undecided && !committing

  // Keep server truth when a new review arrives.
  const [source, setSource] = useState(review)
  if (source !== review) {
    setSource(review)
    setSlots(review.slots)
  }

  async function change(index: number, patch: SlotPatch, optimistic: Partial<ReviewSlot>) {
    const before = slots[index]!
    setSlots((all) => all.map((s, i) => (i === index ? { ...s, ...optimistic } : s)))
    setErrors(({ [before.id]: _gone, ...rest }) => rest)
    const result = await updateSlotAction(before.id, patch)
    if (!result.ok) {
      setSlots((all) => all.map((s, i) => (i === index ? before : s)))
      setErrors((all) => ({ ...all, [before.id]: result.message }))
    }
  }

  function keyDown(index: number, event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return
    const move = MOVES[event.key]
    if (move !== undefined) {
      const next = index + move
      const sameRow = Math.abs(move) === 3 || Math.floor(next / 3) === Math.floor(index / 3)
      if (next >= 0 && next < slots.length && sameRow) {
        event.preventDefault()
        setFocused(next)
        refs.current[next]?.focus()
      }
      return
    }
    const pocket = slots[index]
    if (readOnly || !pocket || pocket.empty) return
    if (event.key === "Enter" && pocket.chosen) {
      event.preventDefault()
      void change(index, { decision: "confirmed" }, { decision: "confirmed" })
    } else if (event.key === "x" || event.key === "X") {
      event.preventDefault()
      void change(index, { decision: "rejected" }, { decision: "rejected" })
    }
  }

  function commit() {
    setCommitError(null)
    startCommit(async () => {
      const result = await commitScanAction(review.scan.id)
      if (result && !result.ok) setCommitError(result.message)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-semibold">
          {review.scan.binder} · page {review.scan.page}
        </h1>
        <p className="text-sm text-ink-soft">{summary(slots)}</p>
      </div>

      {review.diff ? (
        <div className="rounded border border-line bg-paper px-3 py-2 text-sm">
          <p>
            +{review.diff.added.length} new, −{review.diff.removed.length} removed, {review.diff.unchanged} unchanged
          </p>
          {review.diff.removed.length > 0 ? (
            <p className="text-ink-soft">Leaving the collection: {review.diff.removed.map((c) => c.name).join(", ")}</p>
          ) : null}
        </div>
      ) : null}

      {review.scan.status === "committed" || review.scan.status === "superseded" ? (
        <p className="text-sm text-ink-soft">This scan was already added. It's shown here for reference.</p>
      ) : review.scan.status === "reading" ? (
        <p className="text-sm text-ink-soft">We're still reading this photo. Refresh in a moment.</p>
      ) : null}

      <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Pockets">
        {slots.map((pocket, index) => (
          <Pocket
            key={pocket.id}
            ref={(el) => {
              refs.current[index] = el
            }}
            pocket={pocket}
            photo={photo}
            readOnly={readOnly}
            error={errors[pocket.id] ?? null}
            focusable={index === focused}
            onFocus={() => setFocused(index)}
            onKeyDown={(e) => keyDown(index, e)}
            onChange={(patch, optimistic) => void change(index, patch, optimistic)}
          />
        ))}
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">Arrows move · Enter confirms · X rejects</p>
          <div className="flex items-center gap-3">
            {commitError ? (
              <p role="alert" className="text-sm text-down">
                {commitError}
              </p>
            ) : null}
            <button type="button" disabled={!canCommit} onClick={commit} className="h-11 rounded bg-ink px-4 text-surface disabled:opacity-50">
              {committing ? "Adding…" : review.diff ? "Replace page" : `Add ${cards} card${cards === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { ReviewGrid }

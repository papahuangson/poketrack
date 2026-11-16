"use client"

import { useRef, useState, useTransition, type KeyboardEvent } from "react"
import { commitScanAction, updateSlotAction } from "@/app/scans/[id]/actions"
import type { Review, ReviewSlot, SlotPatch } from "@/lib/scan-review"
import { Crop } from "./crop"
import { Pocket } from "./pocket"

const MOVES: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }

function summary(slots: ReviewSlot[]): string {
  const matched = slots.filter((s) => !s.empty && s.decision === "confirmed").length
  const check = slots.filter((s) => !s.empty && s.decision === "pending").length
  const empty = slots.filter((s) => s.empty).length
  const rejected = slots.filter((s) => !s.empty && s.decision === "rejected").length
  return [`${matched} matched`, `${check} check`, `${empty} empty`, ...(rejected ? [`${rejected} rejected`] : [])].join(" · ")
}

const STATUS_LABEL = { confirmed: "Matched", pending: "Check", rejected: "Rejected" } as const

const toCheck = (s: ReviewSlot) => !s.empty && s.decision === "pending"

// The next pocket still to check after `from`, wrapping around; `from` itself when none is left.
function nextToCheck(slots: ReviewSlot[], from: number): number {
  for (let step = 1; step < slots.length; step++) {
    const i = (from + step) % slots.length
    if (toCheck(slots[i]!)) return i
  }
  return from
}

function ReviewGrid({ review }: { review: Review }) {
  const [slots, setSlots] = useState(review.slots)
  const [errors, setErrors] = useState<Record<number, string>>({})
  // The pocket shown on a phone, which is also the grid's keyboard stop.
  const [current, setCurrent] = useState(() => Math.max(0, review.slots.findIndex(toCheck)))
  // Phones show one pocket at a time, or every pocket small. Wider screens always show the grid.
  const [view, setView] = useState<"one" | "all">("one")
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
    const after = slots.map((s, i) => (i === index ? { ...s, ...optimistic } : s))
    setSlots(after)
    setErrors(({ [before.id]: _gone, ...rest }) => rest)
    const decided = optimistic.decision === "confirmed" || optimistic.decision === "rejected"
    if (decided && index === current) setCurrent(nextToCheck(after, index))
    const result = await updateSlotAction(before.id, patch)
    if (!result.ok) {
      setSlots((all) => all.map((s, i) => (i === index ? before : s)))
      setErrors((all) => ({ ...all, [before.id]: result.message }))
      if (decided) setCurrent(index)
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
        setCurrent(next)
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

      {slots.length > 0 ? (
        <div className="flex items-center gap-2 sm:hidden">
          {view === "one" ? (
            <>
              <button
                type="button"
                aria-label="Previous pocket"
                disabled={current === 0}
                onClick={() => setCurrent(current - 1)}
                className="h-11 w-11 rounded border border-line bg-surface text-lg disabled:opacity-40"
              >
                ‹
              </button>
              <p className="flex-1 text-center text-sm font-semibold" aria-live="polite">
                Pocket {current + 1} of {slots.length}
              </p>
              <button
                type="button"
                aria-label="Next pocket"
                disabled={current === slots.length - 1}
                onClick={() => setCurrent(current + 1)}
                className="h-11 w-11 rounded border border-line bg-surface text-lg disabled:opacity-40"
              >
                ›
              </button>
              <button type="button" onClick={() => setView("all")} className="h-11 rounded border border-line bg-surface px-3 text-sm">
                View all
              </button>
            </>
          ) : (
            <>
              <p className="flex-1 text-sm text-ink-soft">Tap a pocket to open it</p>
              <button type="button" onClick={() => setView("one")} className="h-11 rounded border border-line bg-surface px-3 text-sm">
                One at a time
              </button>
            </>
          )}
        </div>
      ) : null}

      {view === "all" ? (
        <ul className="grid grid-cols-3 gap-2 sm:hidden" aria-label="All pockets">
          {slots.map((pocket, index) => {
            const name = pocket.empty ? "empty" : (pocket.chosen?.name ?? "not recognized")
            const status = pocket.empty ? null : STATUS_LABEL[pocket.decision]
            return (
              <li key={pocket.id}>
                <button
                  type="button"
                  aria-label={`Pocket ${pocket.slot}: ${name}${status ? `, ${status}` : ""}`}
                  onClick={() => {
                    setCurrent(index)
                    setView("one")
                  }}
                  className={`flex w-full flex-col gap-1 rounded border bg-surface p-1 text-left ${
                    toCheck(pocket) ? "border-energy border-2" : "border-line"
                  } ${pocket.decision === "rejected" && !pocket.empty ? "opacity-60" : ""} ${index === current ? "outline-2 outline-ink" : ""}`}
                >
                  {pocket.empty ? (
                    <span className="flex aspect-[63/88] items-center justify-center text-xs text-ink-soft">(empty)</span>
                  ) : (
                    <Crop imageUrl={photo.imageUrl} width={photo.width} height={photo.height} box={pocket.box} alt="" />
                  )}
                  <span className="truncate text-xs font-semibold">{pocket.empty ? "Empty" : (pocket.chosen?.name ?? "Not recognized")}</span>
                  {status ? <span className={`text-xs ${pocket.decision === "pending" ? "font-semibold" : "text-ink-soft"}`}>{status}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className={`grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3 ${view === "all" ? "max-sm:hidden" : ""}`} aria-label="Pockets">
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
            focusable={index === current}
            current={index === current}
            className={index === current ? "" : "max-sm:hidden"}
            onFocus={() => setCurrent(index)}
            onKeyDown={(e) => keyDown(index, e)}
            onChange={(patch, optimistic) => void change(index, patch, optimistic)}
          />
        ))}
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-3 max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:border-t max-sm:border-line max-sm:bg-paper max-sm:px-4 max-sm:py-2">
          <p className="text-sm text-ink-soft max-sm:hidden">Arrows move · Enter confirms · X rejects</p>
          <div className="flex items-center gap-3 max-sm:w-full max-sm:justify-end">
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

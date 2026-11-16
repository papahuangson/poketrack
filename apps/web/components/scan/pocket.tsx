"use client"

import { CONDITIONS, type Condition, type Decision } from "@poketrack/db/constants"
import { forwardRef, type KeyboardEvent } from "react"
import { LabeledSelect } from "@/components/ui/select"
import type { CardHit } from "@/lib/collection"
import type { ReviewSlot, SlotPatch } from "@/lib/scan-review"
import { variantLabel } from "@/lib/variants"
import { Crop } from "./crop"
import { PocketCardPicker } from "./pocket-card-picker"

type Props = {
  pocket: ReviewSlot
  photo: { imageUrl: string; width: number; height: number }
  readOnly: boolean
  error: string | null
  focusable: boolean
  onChange: (patch: SlotPatch, optimistic: Partial<ReviewSlot>) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onFocus: () => void
}

const STATUS: Record<Decision, string> = { confirmed: "Matched", pending: "Check", rejected: "Rejected" }

const Pocket = forwardRef<HTMLElement, Props>(function Pocket({ pocket, photo, readOnly, error, focusable, onChange, onKeyDown, onFocus }, ref) {
  const card = pocket.chosen
  const name = pocket.empty ? "empty" : (card?.name ?? "not recognized")
  const showClaim = !readOnly && card !== null && (pocket.claimManual || (pocket.manualLot?.available ?? 0) > 0)
  const candidateHits: CardHit[] = pocket.candidates.map(({ cardId: _c, score: _s, via: _v, ...hit }) => hit)

  function pick(hit: CardHit) {
    onChange({ chosenCardId: hit.id }, { chosen: hit, variant: hit.variants[0] ?? null })
  }

  return (
    <section
      ref={ref}
      role="group"
      aria-label={`Pocket ${pocket.slot}: ${name}`}
      tabIndex={focusable ? 0 : -1}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocus()
      }}
      data-decision={pocket.decision}
      className={`flex min-w-0 flex-col gap-2 rounded border bg-surface p-2 outline-offset-2 focus:outline-2 focus:outline-ink ${
        pocket.decision === "pending" && !pocket.empty ? "border-energy" : "border-line"
      } ${pocket.decision === "rejected" ? "opacity-60" : ""}`}
    >
      {pocket.empty ? (
        <p className="flex aspect-[63/88] items-center justify-center text-sm text-ink-soft">(empty)</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1">
            <Crop imageUrl={photo.imageUrl} width={photo.width} height={photo.height} box={pocket.box} alt={`Your photo of pocket ${pocket.slot}`} />
            {card?.imageSmall ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={card.imageSmall} alt={`Catalog image of ${card.name}`} className="aspect-[63/88] w-full rounded-[3px]" />
            ) : (
              <span className="aspect-[63/88] w-full rounded-[3px] bg-paper" />
            )}
          </div>

          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{card?.name ?? "Not recognized"}</p>
              {card ? (
                <p className="truncate text-xs text-ink-soft">
                  {card.setName} · {card.number}/{card.printedTotal}
                </p>
              ) : null}
            </div>
            <span className={`shrink-0 text-xs ${pocket.decision === "pending" ? "font-semibold" : "text-ink-soft"}`}>{STATUS[pocket.decision]}</span>
          </div>

          {!readOnly && pocket.decision === "pending" ? <PocketCardPicker slot={pocket.slot} candidates={candidateHits} onPick={pick} /> : null}

          {!readOnly && card ? (
            <div className="grid grid-cols-2 gap-1">
              <LabeledSelect
                label="Variant"
                value={pocket.variant ?? ""}
                options={card.variants.map((v) => ({ value: v, label: variantLabel(v) }))}
                onValueChange={(v) => onChange({ variant: v }, { variant: v })}
              />
              <LabeledSelect
                label="Condition"
                value={pocket.condition}
                options={CONDITIONS.map((c) => ({ value: c, label: c }))}
                onValueChange={(c) => onChange({ condition: c as Condition }, { condition: c as Condition })}
              />
            </div>
          ) : card ? (
            <p className="text-xs text-ink-soft">
              {variantLabel(pocket.variant ?? "")} · {pocket.condition}
            </p>
          ) : null}

          {showClaim ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={pocket.claimManual}
                onChange={(e) => onChange({ claimManual: e.target.checked }, { claimManual: e.target.checked })}
              />
              Typed in earlier, use that copy
            </label>
          ) : null}
          {pocket.firstEditionNote ? <p className="text-xs font-semibold">1st edition?</p> : null}
          {pocket.otherPages.map((p) => (
            <p key={`${p.binder}-${p.page}`} className="text-xs text-ink-soft">
              Also in {p.binder} · page {p.page}
            </p>
          ))}

          {!readOnly ? (
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                tabIndex={-1}
                disabled={!card || pocket.decision === "confirmed"}
                onClick={() => onChange({ decision: "confirmed" }, { decision: "confirmed" })}
                className="rounded border border-line px-2 py-0.5 disabled:opacity-40"
              >
                Confirm
              </button>
              <button
                type="button"
                tabIndex={-1}
                disabled={pocket.decision === "rejected"}
                onClick={() => onChange({ decision: "rejected" }, { decision: "rejected" })}
                className="rounded border border-line px-2 py-0.5 disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-down">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
})

export { Pocket }

"use client"

import { CardTile } from "@/components/binder/card-tile"
import type { BinderPage, CardRef, PocketView } from "@/lib/binder-view"

type Props = { page: BinderPage; highlightSlot: number | null; onOpen: (ref: CardRef) => void }

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const POCKET =
  "relative block aspect-[63/88] w-full rounded-md p-0 transition-opacity data-[dimmed]:opacity-35 data-[highlight]:outline-[3px] data-[highlight]:outline-offset-2 data-[highlight]:outline-energy"

function label(pocket: PocketView | undefined, slot: number): string {
  if (!pocket || pocket.state === "empty") return `Pocket ${slot}: empty`
  if (pocket.state === "missing") return `Pocket ${slot}: ${pocket.name}, not in your collection`
  return `Pocket ${slot}: ${pocket.name}, ${pocket.number}/${pocket.printedTotal}`
}

function PageGrid({ page, highlightSlot, onOpen }: Props) {
  const bySlot = new Map(page.pockets.map((pocket) => [pocket.slot, pocket]))
  return (
    <ol aria-label={`${page.binder}, page ${page.page}`} className="grid w-full max-w-[22rem] list-none grid-cols-3 gap-2 p-0">
      {SLOTS.map((slot) => {
        const pocket = bySlot.get(slot)
        const marks = {
          "data-highlight": highlightSlot === slot ? "" : undefined,
          "data-dimmed": highlightSlot !== null && highlightSlot !== slot ? "" : undefined,
        }
        if (!pocket || pocket.state === "empty" || pocket.resultId === null) {
          return (
            <li key={slot}>
              <button
                type="button"
                aria-label={label(pocket, slot)}
                aria-disabled="true"
                {...marks}
                className={`${POCKET} cursor-default border-2 border-dashed border-line bg-transparent`}
              />
            </li>
          )
        }
        const resultId = pocket.resultId
        const missing = pocket.state === "missing"
        return (
          <li key={slot}>
            <button
              type="button"
              aria-label={label(pocket, slot)}
              data-pocket={`r${resultId}`}
              data-missing={missing ? "" : undefined}
              {...marks}
              onClick={() => onOpen({ resultId })}
              className={`${POCKET} cursor-pointer border-0 bg-transparent`}
            >
              <span className={`block h-full w-full ${missing ? "opacity-35 grayscale" : ""}`}>
                <CardTile name={pocket.name ?? ""} number={pocket.number ?? ""} printedTotal={pocket.printedTotal ?? 0} imageSmall={pocket.imageSmall} />
              </span>
              {missing ? (
                <span className="absolute inset-x-1 bottom-1 rounded-[3px] bg-ink px-1 py-0.5 text-center text-[0.625rem] font-semibold leading-tight text-surface">
                  Not in your collection
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export { PageGrid }

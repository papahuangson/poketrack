"use client"

import { CardTile } from "@/components/binder/card-tile"
import type { CardRef, UnplacedLot } from "@/lib/binder-view"

type Props = { lots: UnplacedLot[]; highlightLotId: number | null; onOpen: (ref: CardRef) => void }

function UnplacedStrip({ lots, highlightLotId, onOpen }: Props) {
  if (lots.length === 0) return null
  return (
    <section aria-labelledby="unplaced-heading" className="space-y-2">
      <h2 id="unplaced-heading" className="font-display text-lg font-semibold">
        Not on a page yet
      </h2>
      <ul className="flex list-none flex-wrap gap-2 p-0">
        {lots.map((lot) => (
          <li key={lot.lotId}>
            <button
              type="button"
              id={`unplaced-${lot.lotId}`}
              data-pocket={`l${lot.lotId}`}
              data-highlight={highlightLotId === lot.lotId ? "" : undefined}
              aria-label={`${lot.name}, ${lot.number}/${lot.printedTotal}, ${lot.surplus > 1 ? `${lot.surplus} copies ` : ""}not on a page`}
              onClick={() => onOpen({ lotId: lot.lotId })}
              className="relative block aspect-[63/88] w-16 cursor-pointer scroll-mt-24 rounded-md border-0 bg-transparent p-0 data-[highlight]:outline-[3px] data-[highlight]:outline-offset-2 data-[highlight]:outline-energy"
            >
              <CardTile name={lot.name} number={lot.number} printedTotal={lot.printedTotal} imageSmall={lot.imageSmall} />
              {lot.surplus > 1 ? (
                <span className="tabular absolute right-0.5 top-0.5 rounded-[3px] bg-ink px-1 text-xs font-semibold text-surface">×{lot.surplus}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export { UnplacedStrip }

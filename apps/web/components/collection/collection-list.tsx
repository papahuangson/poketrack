import type { ReactNode } from "react"
import type { CollectionRow } from "@/lib/collection"
import { formatUsd } from "@/lib/money"
import { variantLabel } from "@/lib/variants"

type Props = { rows: CollectionRow[]; filtered: boolean; renderMenu?: (row: CollectionRow) => ReactNode }

function Price({ cents, strong }: { cents: number | null; strong?: boolean }) {
  return (
    <span
      aria-label={cents === null ? "No price yet" : undefined}
      className={`tabular text-right ${strong ? "font-semibold" : "text-ink-soft"}`}
    >
      {formatUsd(cents)}
    </span>
  )
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

function note(row: CollectionRow): string | null {
  if (row.marketCents === null) {
    return row.cardVariants.length > 0 && !row.cardVariants.includes(row.variant) ? "Edit to pick a variant" : null
  }
  return row.priceStale && row.priceDate ? `Price from ${SHORT_DATE.format(new Date(row.priceDate))}` : null
}

function CollectionList({ rows, filtered, renderMenu }: Props) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line px-4 py-10 text-center text-ink-soft">
        {filtered ? "No cards match these filters." : "No cards yet. Search above to add your first card."}
      </p>
    )
  }

  return (
    <ul className="divide-y divide-line rounded-md border border-line bg-surface">
      {rows.map((row) => (
        <li
          key={row.id}
          className="grid grid-cols-[3rem_1fr_auto_2.5rem] items-center gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[3rem_minmax(0,1fr)_7rem_3rem_3rem_5.5rem_6rem_2.5rem]"
        >
          {row.imageSmall ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.imageSmall}
              alt=""
              width={48}
              height={67}
              loading="lazy"
              className="row-span-2 aspect-[63/88] w-12 rounded-[3px] bg-paper object-cover sm:row-span-1"
            />
          ) : (
            <span className="row-span-2 aspect-[63/88] w-12 rounded-[3px] bg-paper sm:row-span-1" />
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold">{row.name}</p>
            <p className="truncate text-sm text-ink-soft">
              {row.setName}, {row.number}/{row.printedTotal}
            </p>
            {note(row) && <p className="truncate text-sm font-medium text-down">{note(row)}</p>}
          </div>
          <div className="col-start-2 flex gap-3 text-sm sm:contents">
            <span>{variantLabel(row.variant)}</span>
            <span>{row.condition}</span>
            <span className="tabular">×{row.quantity}</span>
            <span className="sm:contents">
              <Price cents={row.marketCents} />
            </span>
          </div>
          <span className="col-start-3 row-start-1 text-right sm:col-start-auto sm:row-start-auto">
            <Price cents={row.rowTotalCents} strong />
          </span>
          <div className="col-start-4 row-start-1 justify-self-end sm:col-start-auto sm:row-start-auto">
            {renderMenu?.(row)}
          </div>
        </li>
      ))}
    </ul>
  )
}

export { CollectionList }

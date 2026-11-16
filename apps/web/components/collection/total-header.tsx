import Link from "next/link"
import { formatUsd } from "@/lib/money"

type Props = { totalCents: number; changeCents: number | null; unpricedCount: number }

function TotalHeader({ totalCents, changeCents, unpricedCount }: Props) {
  const moved = changeCents !== null && changeCents !== 0
  return (
    <section aria-labelledby="total-heading" className="space-y-1">
      <h1 id="total-heading" className="text-sm text-ink-soft">
        Collection value
      </h1>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <p className="tabular font-display text-6xl leading-none font-semibold tracking-tight sm:text-7xl">
          {formatUsd(totalCents)}
        </p>
        {moved && (
          <p className={`tabular font-semibold ${changeCents > 0 ? "text-up" : "text-down"}`}>
            {changeCents > 0 ? "▲" : "▼"} {formatUsd(Math.abs(changeCents))} since last update
          </p>
        )}
      </div>
      <p className="text-sm text-ink-soft">
        {unpricedCount > 0 && (
          <span className="mr-3 font-semibold text-ink">
            {unpricedCount === 1 ? "1 card unpriced" : `${unpricedCount} cards unpriced`}
          </span>
        )}
        <span>Values use market price and ignore condition.</span>
      </p>
      <p className="pt-2">
        <Link href="/scan" className="inline-flex h-10 items-center rounded border border-ink px-4 text-sm font-semibold no-underline">
          Scan a page
        </Link>
      </p>
    </section>
  )
}

export { TotalHeader }

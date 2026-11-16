import Link from "next/link"
import { getDb } from "@/lib/db"
import { listScanHistory, scanAccuracy, type ScanSummary } from "@/lib/scan-history"

export const dynamic = "force-dynamic"
export const metadata = { title: "Scans · Poketrack" }

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })
const STATUS: Record<ScanSummary["status"], string> = {
  reading: "Reading",
  ready: "Not added yet",
  failed: "Couldn't read",
  committed: "Current",
  superseded: "Replaced",
}

function Row({ scan }: { scan: ScanSummary }) {
  return (
    <li>
      <Link href={`/scans/${scan.id}`}>
        {when(scan.createdAt)} · {STATUS[scan.status]} · {scan.cards} card{scan.cards === 1 ? "" : "s"}
      </Link>
    </li>
  )
}

export default async function ScansPage() {
  const db = getDb()
  const [history, accuracy] = await Promise.all([listScanHistory(db), scanAccuracy(db)])
  const pct = accuracy.nonEmpty > 0 ? Math.round((accuracy.firstGuessRight / accuracy.nonEmpty) * 100) : null
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold">Scans</h1>
        <Link href="/scan">Scan a page</Link>
      </div>
      <p className="text-sm text-ink-soft">
        {pct === null
          ? "No pages added yet."
          : `First guess right: ${accuracy.firstGuessRight} of ${accuracy.nonEmpty} pockets (${pct}%)`}
      </p>
      <ul className="flex flex-col gap-4">
        {history.map((page) => (
          <li key={`${page.binder}-${page.page}`} className="space-y-1">
            <h2 className="font-semibold">
              {page.binder} · page {page.page}
            </h2>
            <ul className="space-y-0.5 text-sm">
              {page.current ? <Row scan={page.current} /> : null}
              {page.older.map((s) => (
                <Row key={s.id} scan={s} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}

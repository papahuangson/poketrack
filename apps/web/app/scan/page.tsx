import { CaptureForm } from "@/components/scan/capture-form"
import { lastPage, latestBinder, listBinders } from "@/lib/binders"
import { getDb } from "@/lib/db"
import { lookupPageAction } from "./actions"

export const dynamic = "force-dynamic"
export const metadata = { title: "Scan a page · Poketrack" }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

// `?binder=&page=` come from the binder view's "Scan this page" links and prefill the form.
export default async function ScanPage({ searchParams }: Props) {
  const db = getDb()
  const raw = await searchParams
  const wantedBinder = typeof raw.binder === "string" ? raw.binder.trim() : ""
  const wantedPage = typeof raw.page === "string" && /^[1-9]\d{0,4}$/.test(raw.page) ? Number(raw.page) : undefined
  const names = await listBinders(db)
  const binders = await Promise.all(names.map(async (name) => ({ name, lastPage: await lastPage(db, name) })))
  const latest = await latestBinder(db)
  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Scan a page</h1>
      <CaptureForm binders={binders} initialBinder={wantedBinder || latest || names[0] || "Main"} initialPage={wantedPage} lookupPage={lookupPageAction} />
    </section>
  )
}

import { CaptureForm } from "@/components/scan/capture-form"
import { lastPage, latestBinder, listBinders } from "@/lib/binders"
import { getDb } from "@/lib/db"
import { lookupPageAction } from "./actions"

export const dynamic = "force-dynamic"
export const metadata = { title: "Scan a page · Poketrack" }

export default async function ScanPage() {
  const db = getDb()
  const names = await listBinders(db)
  const binders = await Promise.all(names.map(async (name) => ({ name, lastPage: await lastPage(db, name) })))
  const latest = await latestBinder(db)
  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Scan a page</h1>
      <CaptureForm binders={binders} initialBinder={latest ?? names[0] ?? "Main"} lookupPage={lookupPageAction} />
    </section>
  )
}

import Link from "next/link"
import { BinderScreen } from "@/components/binder/binder-screen"
import { parseBinderParams, type RawParams } from "@/lib/binder-params"
import { binderPageCount, loadBinderPage, loadCardDetail, loadUnplaced, resolveBinder, type BinderPage } from "@/lib/binder-view"
import { latestBinder, listBinders } from "@/lib/binders"
import { getDb } from "@/lib/db"
import { searchOwnedAction } from "./actions"

export const dynamic = "force-dynamic"
export const metadata = { title: "Binders · Poketrack" }

type Props = { searchParams: Promise<RawParams> }

export default async function BindersPage({ searchParams }: Props) {
  const db = getDb()
  const [raw, binders, latest] = await Promise.all([searchParams, listBinders(db), latestBinder(db)])

  if (binders.length === 0) {
    return (
      <section className="flex flex-col gap-6">
        <h1 className="font-display text-3xl font-semibold">Binders</h1>
        <div className="rounded-md border border-dashed border-line px-4 py-10 text-center">
          <p className="text-ink-soft">No binders yet. Scan a binder page and it shows up here, card for card.</p>
          <Link href="/scan" className="mt-4 inline-flex h-11 items-center rounded bg-ink px-4 text-surface no-underline">
            Scan a page
          </Link>
        </div>
      </section>
    )
  }

  // The binder in the URL under its stored name, else the most recently scanned one, else the first.
  const wanted = typeof raw.b === "string" ? raw.b : ""
  const binder = (await resolveBinder(db, wanted)) ?? (latest ? await resolveBinder(db, latest) : null) ?? binders[0]!
  const pageCount = await binderPageCount(db, binder)
  const params = parseBinderParams(raw, () => pageCount)

  // A binder that only has typed-in cards has no pages yet: show page 1 as unscanned.
  const unscanned: BinderPage = { binder, page: params.page, pageCount: Math.max(1, pageCount), scanId: null, pockets: [], valueCents: 0, unpricedCount: 0 }
  const [page, unplaced, detail] = await Promise.all([
    pageCount === 0 ? null : loadBinderPage(db, binder, params.page),
    params.page >= pageCount ? loadUnplaced(db, binder) : [],
    params.card ? loadCardDetail(db, params.card) : null,
  ])

  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold">Binders</h1>
      <BinderScreen
        binders={binders}
        page={page ?? unscanned}
        unplaced={unplaced}
        highlightSlot={params.hl}
        detail={detail}
        search={searchOwnedAction}
      />
    </section>
  )
}

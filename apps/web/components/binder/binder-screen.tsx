"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { BinderPicker } from "@/components/binder/binder-picker"
import { PageGrid } from "@/components/binder/page-grid"
import { Pager } from "@/components/binder/pager"
import { SearchBox } from "@/components/binder/search-box"
import { UnplacedStrip } from "@/components/binder/unplaced-strip"
import { binderHref } from "@/lib/binder-params"
import type { BinderPage, CardDetail, CardRef, OwnedHit, UnplacedLot } from "@/lib/binder-view"
import { formatUsd } from "@/lib/money"

type Props = {
  binders: string[]
  page: BinderPage
  unplaced: UnplacedLot[]
  highlightSlot: number | null
  detail: CardDetail | null
  search: (q: string) => Promise<OwnedHit[]>
}

const hashLot = () => {
  const match = /^#unplaced-(\d+)$/.exec(window.location.hash)
  return match ? Number(match[1]) : null
}

function BinderScreen({ binders, page, unplaced, highlightSlot, search }: Props) {
  const router = useRouter()
  const [highlightLot, setHighlightLot] = useState<number | null>(null)

  // A search pick of a card that isn't on a page lands here with #unplaced-<lot>. Flips drop the hash, clearing it.
  useEffect(() => {
    setHighlightLot(hashLot())
  }, [page.binder, page.page])

  function open(ref: CardRef) {
    router.push(binderHref({ binder: page.binder, page: page.page, card: ref }), { scroll: false })
  }

  const scanned = page.scanId !== null
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <BinderPicker binders={binders} current={page.binder} />
        </div>
        <div className="min-w-56 flex-1">
          <SearchBox search={search} current={{ binder: page.binder, page: page.page }} onPickUnplaced={setHighlightLot} />
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Pager binder={page.binder} page={page.page} pageCount={page.pageCount}>
          <PageGrid page={page} highlightSlot={highlightSlot} onOpen={open} />
        </Pager>
        {scanned ? (
          <p className="tabular text-sm text-ink-soft">
            Page value <span className="font-semibold text-ink">{formatUsd(page.valueCents)}</span>
            {page.unpricedCount > 0 ? ` · ${page.unpricedCount} unpriced` : ""}
          </p>
        ) : (
          <p className="text-sm text-ink-soft">
            This page hasn’t been scanned.{" "}
            <Link href={`/scan?binder=${encodeURIComponent(page.binder)}&page=${page.page}`} className="font-semibold text-ink">
              Scan this page
            </Link>
          </p>
        )}
      </div>
      <UnplacedStrip lots={unplaced} highlightLotId={highlightLot} onOpen={open} />
    </div>
  )
}

export { BinderScreen }

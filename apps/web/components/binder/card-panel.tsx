"use client"

import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog"
import { Button } from "@ui-sdk/react/button"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { removePocketAction, removeSurplusAction } from "@/app/binders/actions"
import { CardTile } from "@/components/binder/card-tile"
import { PocketEditForm } from "@/components/binder/pocket-edit-form"
import { Sparkline } from "@/components/binder/sparkline"
import { SurplusEditForm } from "@/components/binder/surplus-edit-form"
import { Modal } from "@/components/ui/modal"
import { binderHref } from "@/lib/binder-params"
import type { CardDetail, Where } from "@/lib/binder-view"
import { formatUsd } from "@/lib/money"
import { variantLabel } from "@/lib/variants"

type Props = { detail: CardDetail; closeHref: string }

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })

function Place({ where, thisOne }: { where: Where; thisOne: boolean }) {
  if (where.kind === "pocket") {
    if (thisOne) return <>This pocket · {where.binder} page {where.page}</>
    return (
      <Link href={binderHref({ binder: where.binder, page: where.page, hl: where.slot })}>
        {where.binder} · page {where.page}, pocket {where.slot}
      </Link>
    )
  }
  if (where.kind === "unplaced") return <>{thisOne ? `These copies · ${where.binder}, not on a page` : `${where.binder} · not on a page`}</>
  return <>{thisOne ? "These copies · no binder" : "No binder"}</>
}

function Price({ price }: { price: CardDetail["price"] }) {
  if (price.marketCents === null) return <p className="text-sm text-ink-soft">No price yet</p>
  const change = price.previousCents === null ? null : price.marketCents - price.previousCents
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div>
        <p className="tabular font-display text-2xl font-semibold">{formatUsd(price.marketCents)}</p>
        {change !== null && change !== 0 ? (
          <p className={`tabular text-sm ${change > 0 ? "text-up" : "text-down"}`}>
            {change > 0 ? "+" : "−"}
            {formatUsd(Math.abs(change))} since the last price
          </p>
        ) : null}
      </div>
      <Sparkline points={price.history} />
    </div>
  )
}

function CardPanel({ detail, closeHref }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view")
  const [removeError, setRemoveError] = useState<string | null>(null)

  const close = () => router.replace(closeHref, { scroll: false })
  const { lot, lotId, resultId } = detail
  const pocket = detail.mode === "pocket" && resultId !== null
  const page = detail.scanLink?.page
  // Group mode acts only on copies no pocket accounts for; with none left there is nothing to edit here.
  const editable = lot !== null && lotId !== null && (pocket || lot.surplus > 0)
  const removable = pocket || editable

  async function remove() {
    setRemoveError(null)
    const result = pocket ? await removePocketAction(resultId) : lotId !== null ? await removeSurplusAction(lotId) : null
    if (!result?.ok) {
      setRemoveError(result?.message ?? "Could not remove the card. Try again.")
      throw new Error("remove failed")
    }
    close()
  }

  const copies = lot?.surplus ?? 0
  const removeTitle = pocket ? `Remove this ${detail.name} from page ${page}?` : `Remove ${copies} ${copies === 1 ? "copy" : "copies"} of ${detail.name}?`
  const removeNote = pocket
    ? lot
      ? "This takes one copy out of your collection and leaves the pocket empty."
      : "This pocket's copy is already gone from your collection. This just empties the pocket."
    : lot && lot.pocketed > 0
      ? "Copies in pockets stay in your collection."
      : "This removes them from your collection."

  return (
    <>
      <Modal open onClose={close} title={detail.name} description={`${detail.setName}, ${detail.number}/${detail.printedTotal}`} variant="sheet">
        <div className="flex gap-4">
          <div className="aspect-[63/88] w-28 shrink-0 sm:w-36">
            <CardTile name={detail.name} number={detail.number} printedTotal={detail.printedTotal} imageSmall={detail.imageLarge ?? detail.imageSmall} />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {detail.rarity ? (
                <>
                  <dt className="text-ink-soft">Rarity</dt>
                  <dd>{detail.rarity}</dd>
                </>
              ) : null}
              <dt className="text-ink-soft">Variant</dt>
              <dd>{variantLabel(detail.variant)}</dd>
              <dt className="text-ink-soft">Condition</dt>
              <dd>{detail.condition}</dd>
              {lot ? (
                <>
                  <dt className="text-ink-soft">Paid</dt>
                  <dd className="tabular">{formatUsd(lot.paidCents)}</dd>
                  <dt className="text-ink-soft">Acquired</dt>
                  <dd>{lot.acquiredOn ? SHORT_DATE.format(new Date(lot.acquiredOn)) : "—"}</dd>
                </>
              ) : null}
            </dl>
            <Price price={detail.price} />
          </div>
        </div>

        {pocket && !lot ? (
          <p className="rounded border border-line bg-paper px-3 py-2 text-sm">
            <span className="font-semibold">Not in your collection</span>. This copy was removed from your collection, but the scan still shows it in this pocket.
          </p>
        ) : null}
        {!pocket && lot && lot.surplus === 0 ? (
          <p className="rounded border border-line bg-paper px-3 py-2 text-sm">Every copy here is in a pocket. Open the pocket to edit it.</p>
        ) : null}

        {detail.places.length > 0 ? (
          <div className="space-y-1">
            <h3 className="text-sm text-ink-soft">Where your copies are</h3>
            <ul className="list-none space-y-0.5 p-0 text-sm">
              {detail.places.map((place) => (
                <li key={place.where.kind === "pocket" ? `r${place.where.resultId}` : `l${place.where.lotId}`} className={place.thisOne ? "font-semibold" : undefined}>
                  <Place {...place} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {mode === "edit" && lot && lotId !== null ? (
          pocket ? (
            <PocketEditForm detail={detail} resultId={resultId} lotId={lotId} lot={lot} onSaved={() => setMode("view")} onCancel={() => setMode("view")} />
          ) : (
            <SurplusEditForm detail={detail} lotId={lotId} lot={lot} onSaved={close} onCancel={() => setMode("view")} />
          )
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {detail.scanLink ? (
              <Link href={`/scan?binder=${encodeURIComponent(detail.scanLink.binder)}&page=${detail.scanLink.page}`} className="text-sm">
                Wrong card? Rescan this page
              </Link>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              {removable ? <Button onClick={() => setMode("remove")}>Remove</Button> : null}
              {editable ? (
                <Button data-variant="solid" onClick={() => setMode("edit")}>
                  Edit
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Modal>

      <AlertDialog
        open={mode === "remove"}
        pendingAnnouncement="Removing"
        onOpenChange={(open) => {
          if (!open) {
            setMode("view")
            setRemoveError(null)
          }
        }}
      >
        <AlertDialogBackdrop />
        <AlertDialogContent className="w-[min(26rem,calc(100vw-2rem))] space-y-4">
          <div className="space-y-1">
            <AlertDialogTitle className="font-display text-2xl font-semibold">{removeTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-ink-soft">{removeNote}</AlertDialogDescription>
          </div>
          <AlertDialogClose
            value="confirm"
            action={remove}
            render={(props, state) => (
              <div className="space-y-3">
                {state.error ? (
                  <p role="alert" className="text-sm font-semibold text-down">
                    {removeError ?? "Could not remove the card. Try again."}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <AlertDialogClose>Cancel</AlertDialogClose>
                  <button {...props} data-variant="solid">
                    Remove
                  </button>
                </div>
              </div>
            )}
          />
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { CardPanel }

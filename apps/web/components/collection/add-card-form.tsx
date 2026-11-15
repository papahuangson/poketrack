"use client"

import { Button } from "@ui-sdk/react/button"
import { useEffect, useState, type FormEvent } from "react"
import { addCardAction, defaultVariantAction } from "@/app/actions"
import { LotFields, type Lot } from "@/components/collection/lot-fields"
import { Modal } from "@/components/ui/modal"
import type { CardHit } from "@/lib/collection"

type Props = { card: CardHit | null; onClose: () => void }

type Failure = { field: string; message: string }

function AddCardForm({ card, onClose }: Props) {
  const [shown, setShown] = useState<CardHit | null>(card)
  const [lot, setLot] = useState<Lot>({ variant: "normal", condition: "NM", quantity: 1 })
  const [failure, setFailure] = useState<Failure | null>(null)
  const [saving, setSaving] = useState(false)

  if (card && card !== shown) {
    setShown(card)
    setLot({ variant: card.variants[0] ?? "normal", condition: "NM", quantity: 1 })
    setFailure(null)
  }

  useEffect(() => {
    if (!card) return
    let current = true
    defaultVariantAction(card.variants).then(
      (variant) => {
        if (current) setLot((lot) => ({ ...lot, variant }))
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [card])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!card || saving) return
    setSaving(true)
    try {
      const result = await addCardAction({
        cardId: card.id,
        variant: lot.variant,
        condition: lot.condition,
        quantity: lot.quantity ?? 0,
      })
      if (result.ok) onClose()
      else setFailure(result)
    } catch {
      setFailure({ field: "form", message: "Could not add the card. Try again." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={card !== null}
      onClose={onClose}
      title={shown?.name ?? ""}
      description={shown ? `${shown.setName}, ${shown.number}/${shown.printedTotal}` : undefined}
    >
      <form onSubmit={submit} className="space-y-4">
        <LotFields cardVariants={shown?.variants ?? []} lot={lot} onChange={setLot} invalidField={failure?.field} />
        {failure && (
          <p role="alert" className="text-sm font-semibold text-down">
            {failure.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" data-variant="solid" disabled={saving}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export { AddCardForm }

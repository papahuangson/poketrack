"use client"

import { Field, FieldLabel } from "@ui-sdk/react/field"
import { Input } from "@ui-sdk/react/input"
import type { CardDetail } from "@/lib/binder-view"

type Props = {
  paid: string
  acquiredOn: string
  onPaid: (value: string) => void
  onAcquiredOn: (value: string) => void
  invalidField?: string
  lot: NonNullable<CardDetail["lot"]>
}

const paidText = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2))

// Paid price and acquired date belong to the lot, so with more than one copy the form says who else they change.
function appliesTo(lot: Props["lot"]): string | null {
  if (lot.quantity < 2) return null
  const copies = lot.quantity === 2 ? "both copies" : `all ${lot.quantity} copies`
  return `Applies to ${copies}${lot.binder ? ` in ${lot.binder}` : ""}`
}

function LotDetailFields({ paid, acquiredOn, onPaid, onAcquiredOn, invalidField, lot }: Props) {
  const note = appliesTo(lot)
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3">
        <Field invalid={invalidField === "paidCents" ? true : undefined}>
          <FieldLabel>Paid per copy</FieldLabel>
          <Input inputMode="decimal" placeholder="0.00" value={paid} onValueChange={(value) => onPaid(value)} />
        </Field>
        <Field invalid={invalidField === "acquiredOn" ? true : undefined}>
          <FieldLabel>Acquired on</FieldLabel>
          <Input type="date" value={acquiredOn} onValueChange={(value) => onAcquiredOn(value)} />
        </Field>
      </div>
      {note ? <p className="text-sm text-ink-soft">{note}</p> : null}
    </div>
  )
}

export { LotDetailFields, paidText }

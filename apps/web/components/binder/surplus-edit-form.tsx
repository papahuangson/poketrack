"use client"

import { Field, FieldLabel } from "@ui-sdk/react/field"
import { Input } from "@ui-sdk/react/input"
import { useState } from "react"
import { editSurplusAction, setLotDetailsAction } from "@/app/binders/actions"
import { EditFormShell } from "@/components/binder/edit-form-shell"
import { LotDetailFields, paidText } from "@/components/binder/lot-detail-fields"
import { LotFields, type Lot } from "@/components/collection/lot-fields"
import type { CardDetail } from "@/lib/binder-view"
import { parseUsd } from "@/lib/money"

type Props = { detail: CardDetail; lotId: number; lot: NonNullable<CardDetail["lot"]>; onSaved: () => void; onCancel: () => void }

// Edits the copies of a lot that no pocket accounts for. Quantity is that surplus; pocketed copies never change here.
function SurplusEditForm({ detail, lotId, lot, onSaved, onCancel }: Props) {
  const [fields, setFields] = useState<Lot>({ variant: detail.variant, condition: detail.condition, quantity: lot.surplus })
  const [binder, setBinder] = useState(lot.binder ?? "")
  const [paid, setPaid] = useState(() => paidText(lot.paidCents))
  const [acquiredOn, setAcquiredOn] = useState(lot.acquiredOn ?? "")

  async function save() {
    const paidCents = parseUsd(paid)
    const acquired = acquiredOn === "" ? null : acquiredOn
    const nextBinder = binder.trim() === "" ? null : binder.trim()
    // Details first: they belong to this lot, and copies moved out below carry them along.
    if (paidCents !== lot.paidCents || acquired !== lot.acquiredOn) {
      const saved = await setLotDetailsAction(lotId, { paidCents, acquiredOn: acquired })
      if (!saved.ok) return saved
    }
    const quantity = fields.quantity ?? 0
    if (fields.variant !== detail.variant || fields.condition !== detail.condition || quantity !== lot.surplus || nextBinder !== lot.binder) {
      const edited = await editSurplusAction(lotId, { variant: fields.variant, condition: fields.condition, quantity, binder: nextBinder })
      if (!edited.ok) return edited
    }
    return null
  }

  return (
    <EditFormShell save={save} onSaved={onSaved} onCancel={onCancel}>
      {(failure) => (
        <>
          <LotFields cardVariants={detail.cardVariants} lot={fields} onChange={setFields} invalidField={failure?.field} minQuantity={0} />
          {lot.pocketed > 0 ? (
            <p className="text-sm text-ink-soft">
              Counts only the copies that aren’t in a pocket. {lot.pocketed === 1 ? "The 1 copy in a pocket stays" : `The ${lot.pocketed} copies in pockets stay`} as
              {lot.pocketed === 1 ? " it is" : " they are"}.
            </p>
          ) : null}
          <Field>
            <FieldLabel>Binder</FieldLabel>
            <Input value={binder} onValueChange={(value) => setBinder(value)} />
          </Field>
          <LotDetailFields paid={paid} acquiredOn={acquiredOn} onPaid={setPaid} onAcquiredOn={setAcquiredOn} invalidField={failure?.field} lot={lot} />
        </>
      )}
    </EditFormShell>
  )
}

export { SurplusEditForm }

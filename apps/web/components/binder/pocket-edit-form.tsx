"use client"

import { CONDITIONS, type Condition } from "@poketrack/db/constants"
import { useState } from "react"
import { movePocketAction, setLotDetailsAction } from "@/app/binders/actions"
import { EditFormShell } from "@/components/binder/edit-form-shell"
import { LotDetailFields, paidText } from "@/components/binder/lot-detail-fields"
import { variantOptions } from "@/components/collection/lot-fields"
import { LabeledSelect } from "@/components/ui/select"
import type { CardDetail } from "@/lib/binder-view"
import { parseUsd } from "@/lib/money"

type Props = { detail: CardDetail; resultId: number; lotId: number; lot: NonNullable<CardDetail["lot"]>; onSaved: () => void; onCancel: () => void }

// Edits the one copy in this pocket. A pocket holds exactly one copy and moves only by rescanning,
// so there is no quantity or binder here.
function PocketEditForm({ detail, resultId, lotId, lot, onSaved, onCancel }: Props) {
  const [variant, setVariant] = useState(detail.variant)
  const [condition, setCondition] = useState<Condition>(detail.condition)
  const [paid, setPaid] = useState(() => paidText(lot.paidCents))
  const [acquiredOn, setAcquiredOn] = useState(lot.acquiredOn ?? "")

  async function save() {
    const paidCents = parseUsd(paid)
    const acquired = acquiredOn === "" ? null : acquiredOn
    let holder = lotId
    if (variant !== detail.variant || condition !== detail.condition) {
      const moved = await movePocketAction(resultId, { variant, condition })
      if (!moved.ok) return moved
      holder = moved.lotId
    }
    if (paidCents !== lot.paidCents || acquired !== lot.acquiredOn) {
      const saved = await setLotDetailsAction(holder, { paidCents, acquiredOn: acquired })
      if (!saved.ok) return saved
    }
    return null
  }

  return (
    <EditFormShell save={save} onSaved={onSaved} onCancel={onCancel}>
      {(failure) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <LabeledSelect label="Variant" value={variant} options={variantOptions(detail.cardVariants, variant)} onValueChange={setVariant} />
            <LabeledSelect
              label="Condition"
              value={condition}
              options={CONDITIONS.map((c) => ({ value: c, label: c }))}
              onValueChange={(next) => setCondition(next as Condition)}
            />
          </div>
          <LotDetailFields paid={paid} acquiredOn={acquiredOn} onPaid={setPaid} onAcquiredOn={setAcquiredOn} invalidField={failure?.field} lot={lot} />
        </>
      )}
    </EditFormShell>
  )
}

export { PocketEditForm }

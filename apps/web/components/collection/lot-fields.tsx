"use client"

import { CONDITIONS, type Condition } from "@poketrack/db/constants"
import { QuantityInput } from "@/components/ui/quantity-input"
import { LabeledSelect } from "@/components/ui/select"
import { variantLabel } from "@/lib/variants"

type Lot = { variant: string; condition: Condition; quantity: number | null }

type Props = { cardVariants: string[]; lot: Lot; onChange: (lot: Lot) => void; invalidField?: string }

function variantOptions(cardVariants: string[], current: string) {
  const values = cardVariants.length > 0 ? [...cardVariants] : ["normal"]
  if (current && !values.includes(current)) values.push(current)
  return values.map((value) => ({ value, label: variantLabel(value) }))
}

function LotFields({ cardVariants, lot, onChange, invalidField }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <LabeledSelect
        label="Variant"
        value={lot.variant}
        options={variantOptions(cardVariants, lot.variant)}
        onValueChange={(variant) => onChange({ ...lot, variant })}
      />
      <LabeledSelect
        label="Condition"
        value={lot.condition}
        options={CONDITIONS.map((condition) => ({ value: condition, label: condition }))}
        onValueChange={(condition) => onChange({ ...lot, condition: condition as Condition })}
      />
      <div className="col-span-2">
        <QuantityInput
          value={lot.quantity}
          invalid={invalidField === "quantity"}
          onValueChange={(quantity) => onChange({ ...lot, quantity })}
        />
      </div>
    </div>
  )
}

export { LotFields }
export type { Lot }

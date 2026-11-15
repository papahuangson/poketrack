"use client"

import { Field, FieldLabel } from "@ui-sdk/react/field"
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/react/number-input"

type Props = { value: number | null; onValueChange: (value: number | null) => void; invalid?: boolean }

function QuantityInput({ value, onValueChange, invalid }: Props) {
  return (
    <Field invalid={invalid ? true : undefined}>
      <FieldLabel>Quantity</FieldLabel>
      <NumberInput value={value} min={1} max={999} step={1} onValueChange={(next) => onValueChange(next)}>
        <NumberInputGroup>
          <NumberInputDecrement aria-label="Decrease quantity" />
          <NumberInputControl />
          <NumberInputIncrement aria-label="Increase quantity" />
        </NumberInputGroup>
      </NumberInput>
    </Field>
  )
}

export { QuantityInput }

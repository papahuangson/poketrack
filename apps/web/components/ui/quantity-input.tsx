"use client"

import { Field, FieldLabel } from "@ui-sdk/react/field"
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/react/number-input"

type Props = { value: number | null; onValueChange: (value: number | null) => void; invalid?: boolean; min?: number }

function QuantityInput({ value, onValueChange, invalid, min = 1 }: Props) {
  return (
    <Field invalid={invalid ? true : undefined}>
      <FieldLabel>Quantity</FieldLabel>
      <NumberInput value={value} min={min} max={999} step={1} onValueChange={(next) => onValueChange(next)}>
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

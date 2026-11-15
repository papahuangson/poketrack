"use client"

import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectLabel, SelectTrigger, SelectValue } from "@ui-sdk/react/select"

type Option = { value: string; label: string }

type Props = {
  label: string
  value: string
  options: Option[]
  onValueChange: (value: string) => void
  name?: string
  className?: string
}

function LabeledSelect({ label, value, options, onValueChange, name, className }: Props) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Select
        items={options}
        value={value}
        name={name}
        onValueChange={(next) => {
          if (typeof next === "string") onValueChange(next)
        }}
      >
        <SelectLabel className="text-sm text-ink-soft">{label}</SelectLabel>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export { LabeledSelect }
export type { Option }

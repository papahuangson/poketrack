"use client"

import { CONDITIONS } from "@poketrack/db/constants"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { LabeledSelect } from "@/components/ui/select"
import { variantLabel } from "@/lib/variants"

const ALL = "all"

const SORTS = [
  { value: "value", label: "Value" },
  { value: "name", label: "Name" },
  { value: "set", label: "Set" },
  { value: "added", label: "Date added" },
]

type Props = {
  sets: { id: string; name: string }[]
  variants: string[]
  current: { set?: string; variant?: string; condition?: string; sort?: string }
}

function Filters({ sets, variants, current }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function update(key: string, value: string, fallback: string) {
    const params = new URLSearchParams(searchParams)
    if (value === fallback) params.delete(key)
    else params.set(key, value)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const all = { value: ALL, label: "All" }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <LabeledSelect
        label="Set"
        value={current.set ?? ALL}
        options={[all, ...sets.map((set) => ({ value: set.id, label: set.name }))]}
        onValueChange={(value) => update("set", value, ALL)}
      />
      <LabeledSelect
        label="Variant"
        value={current.variant ?? ALL}
        options={[all, ...variants.map((variant) => ({ value: variant, label: variantLabel(variant) }))]}
        onValueChange={(value) => update("variant", value, ALL)}
      />
      <LabeledSelect
        label="Condition"
        value={current.condition ?? ALL}
        options={[all, ...CONDITIONS.map((condition) => ({ value: condition, label: condition }))]}
        onValueChange={(value) => update("condition", value, ALL)}
      />
      <LabeledSelect
        label="Sort by"
        value={current.sort ?? "value"}
        options={SORTS}
        onValueChange={(value) => update("sort", value, "value")}
      />
    </div>
  )
}

export { Filters }

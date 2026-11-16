"use client"

import { useRouter } from "next/navigation"
import { LabeledSelect } from "@/components/ui/select"
import { binderHref } from "@/lib/binder-params"

type Props = { binders: string[]; current: string }

function BinderPicker({ binders, current }: Props) {
  const router = useRouter()
  return (
    <LabeledSelect
      label="Binder"
      value={current}
      options={binders.map((name) => ({ value: name, label: name }))}
      onValueChange={(binder) => {
        if (binder !== current) router.push(binderHref({ binder, page: 1 }))
      }}
    />
  )
}

export { BinderPicker }

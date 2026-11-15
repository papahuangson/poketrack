"use client"

import { Button } from "@ui-sdk/react/button"
import { Field, FieldLabel } from "@ui-sdk/react/field"
import { Input } from "@ui-sdk/react/input"
import { useState, type FormEvent } from "react"
import { updateItemAction } from "@/app/actions"
import { LotFields, type Lot } from "@/components/collection/lot-fields"
import { Modal } from "@/components/ui/modal"
import type { CollectionRow } from "@/lib/collection"
import { ValidationError } from "@/lib/errors"
import { parseUsd } from "@/lib/money"

type Props = { row: CollectionRow; open: boolean; onClose: () => void }

type Failure = { field: string; message: string }

const initialLot = (row: CollectionRow): Lot => ({ variant: row.variant, condition: row.condition, quantity: row.quantity })
const initialPaid = (row: CollectionRow) => (row.paidCents === null ? "" : (row.paidCents / 100).toFixed(2))

function EditDialog({ row, open, onClose }: Props) {
  const [wasOpen, setWasOpen] = useState(open)
  const [lot, setLot] = useState<Lot>(() => initialLot(row))
  const [paid, setPaid] = useState(() => initialPaid(row))
  const [acquiredOn, setAcquiredOn] = useState(row.acquiredOn ?? "")
  const [binder, setBinder] = useState(row.binder ?? "")
  const [failure, setFailure] = useState<Failure | null>(null)
  const [saving, setSaving] = useState(false)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setLot(initialLot(row))
      setPaid(initialPaid(row))
      setAcquiredOn(row.acquiredOn ?? "")
      setBinder(row.binder ?? "")
      setFailure(null)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    let paidCents: number | null
    try {
      paidCents = parseUsd(paid)
    } catch (error) {
      if (error instanceof ValidationError) return setFailure({ field: error.field, message: error.message })
      throw error
    }
    setSaving(true)
    try {
      const result = await updateItemAction(row.id, {
        variant: lot.variant,
        condition: lot.condition,
        quantity: lot.quantity ?? 0,
        paidCents,
        acquiredOn: acquiredOn === "" ? null : acquiredOn,
        binder: binder.trim() === "" ? null : binder.trim(),
      })
      if (result.ok) onClose()
      else setFailure(result)
    } catch {
      setFailure({ field: "form", message: "Could not save the change. Try again." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${row.name}`}
      description={`${row.setName}, ${row.number}/${row.printedTotal}`}
    >
      <form onSubmit={submit} className="space-y-4">
        <LotFields cardVariants={row.cardVariants} lot={lot} onChange={setLot} invalidField={failure?.field} />
        <div className="grid grid-cols-2 gap-3">
          <Field invalid={failure?.field === "paidCents" ? true : undefined}>
            <FieldLabel>Paid per copy</FieldLabel>
            <Input inputMode="decimal" placeholder="0.00" value={paid} onValueChange={(value) => setPaid(value)} />
          </Field>
          <Field invalid={failure?.field === "acquiredOn" ? true : undefined}>
            <FieldLabel>Acquired on</FieldLabel>
            <Input type="date" value={acquiredOn} onValueChange={(value) => setAcquiredOn(value)} />
          </Field>
          <div className="col-span-2">
            <Field>
              <FieldLabel>Binder</FieldLabel>
              <Input value={binder} onValueChange={(value) => setBinder(value)} />
            </Field>
          </div>
        </div>
        {failure && (
          <p role="alert" className="text-sm font-semibold text-down">
            {failure.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" data-variant="solid" disabled={saving}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export { EditDialog }

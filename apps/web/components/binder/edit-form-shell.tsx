"use client"

import { Button } from "@ui-sdk/react/button"
import { useState, type FormEvent, type ReactNode } from "react"
import { ValidationError } from "@/lib/errors"

type Failure = { field: string; message: string }
type Props = {
  /** Does the save. Returns a failure to show, or null when everything saved. May throw ValidationError. */
  save: () => Promise<Failure | null>
  onSaved: () => void
  onCancel: () => void
  children: (failure: Failure | null) => ReactNode
}

// The submit, error and button row shared by the pocket and group edit forms.
function EditFormShell({ save, onSaved, onCancel, children }: Props) {
  const [failure, setFailure] = useState<Failure | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const failed = await save()
      if (failed) setFailure(failed)
      else onSaved()
    } catch (error) {
      if (error instanceof ValidationError) setFailure({ field: error.field, message: error.message })
      else setFailure({ field: "form", message: "Could not save the change. Try again." })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {children(failure)}
      {failure ? (
        <p role="alert" className="text-sm font-semibold text-down">
          {failure.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" data-variant="solid" disabled={saving}>
          Save
        </Button>
      </div>
    </form>
  )
}

export { EditFormShell }
export type { Failure }

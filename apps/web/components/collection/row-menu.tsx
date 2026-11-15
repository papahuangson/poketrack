"use client"

import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu"
import { useState } from "react"
import { removeItemAction } from "@/app/actions"
import { EditDialog } from "@/components/collection/edit-dialog"
import type { CollectionRow } from "@/lib/collection"

function RowMenu({ row }: { row: CollectionRow }) {
  const [mode, setMode] = useState<"edit" | "remove" | null>(null)

  async function remove() {
    const result = await removeItemAction(row.id)
    if (!result.ok) throw new Error(result.message)
  }

  return (
    <>
      <Menu>
        <MenuTrigger aria-label={`Actions for ${row.name}`}>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
          </svg>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setMode("edit")}>Edit</MenuItem>
          <MenuItem onSelect={() => setMode("remove")}>Remove</MenuItem>
        </MenuContent>
      </Menu>
      <EditDialog row={row} open={mode === "edit"} onClose={() => setMode(null)} />
      <AlertDialog
        open={mode === "remove"}
        pendingAnnouncement="Removing"
        onOpenChange={(open) => {
          if (!open) setMode(null)
        }}
      >
        <AlertDialogBackdrop />
        <AlertDialogContent className="w-[min(26rem,calc(100vw-2rem))] space-y-4">
          <div className="space-y-1">
            <AlertDialogTitle className="font-display text-2xl font-semibold">Remove {row.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-ink-soft">
              This removes all {row.quantity} from your collection.
            </AlertDialogDescription>
          </div>
          <AlertDialogClose
            value="confirm"
            action={remove}
            render={(props, state) => (
              <div className="space-y-3">
                {state.error ? (
                  <p role="alert" className="text-sm font-semibold text-down">
                    Could not remove the card. Try again.
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <AlertDialogClose>Cancel</AlertDialogClose>
                  <button {...props} data-variant="solid">
                    Remove
                  </button>
                </div>
              </div>
            )}
          />
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { RowMenu }

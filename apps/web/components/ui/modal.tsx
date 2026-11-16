"use client"

import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/react/dialog"
import type { ReactNode } from "react"

type Props = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  /** "sheet" is full-width and anchored to the bottom on phones, and a wider dialog from the `sm` breakpoint up. */
  variant?: "dialog" | "sheet"
  children: ReactNode
}

const WIDTH = {
  dialog: "w-[min(28rem,calc(100vw-2rem))]",
  sheet: "w-[min(32rem,calc(100vw-2rem))] max-sm:mb-0 max-sm:max-h-[88dvh] max-sm:w-full max-sm:rounded-b-none",
}

function Modal({ open, onClose, title, description, variant = "dialog", children }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogBackdrop />
      <DialogContent data-variant={variant} className={`${WIDTH[variant]} space-y-4`}>
        <div className="space-y-1">
          <DialogTitle className="font-display text-2xl font-semibold">{title}</DialogTitle>
          {description && <DialogDescription className="text-sm text-ink-soft">{description}</DialogDescription>}
        </div>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export { Modal }

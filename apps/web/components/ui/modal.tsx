"use client"

import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/react/dialog"
import type { ReactNode } from "react"

type Props = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
}

function Modal({ open, onClose, title, description, children }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogBackdrop />
      <DialogContent className="w-[min(28rem,calc(100vw-2rem))] space-y-4">
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

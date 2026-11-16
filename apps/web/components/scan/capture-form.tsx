"use client"

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@ui-sdk/react/combobox"
import { uploadPresigned } from "@vercel/blob/client"
import { useRouter } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"
import { prepareImage, UnreadableImageError } from "@/lib/prepare-image"
import type { CommittedScan } from "@/lib/binders"

type BinderInfo = { name: string; lastPage: number | null }
type Props = {
  binders: BinderInfo[]
  initialBinder: string
  lookupPage: (binder: string, page: number) => Promise<CommittedScan | null>
}
type Uploaded = { url: string; width: number; height: number }

const nextPageFor = (binders: BinderInfo[], binder: string) =>
  (binders.find((b) => b.name.trim().toLowerCase() === binder.trim().toLowerCase())?.lastPage ?? 0) + 1

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })

function CaptureForm({ binders, initialBinder, lookupPage }: Props) {
  const router = useRouter()
  const [binder, setBinder] = useState(initialBinder)
  const [page, setPage] = useState(() => nextPageFor(binders, initialBinder))
  const [file, setFile] = useState<File | null>(null)
  const [existing, setExisting] = useState<CommittedScan | null>(null)
  const [status, setStatus] = useState<"idle" | "working">("idle")
  const [error, setError] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<Uploaded | null>(null)

  useEffect(() => {
    let live = true
    setExisting(null)
    if (binder.trim() !== "" && Number.isInteger(page) && page >= 1) {
      lookupPage(binder.trim(), page).then((found) => live && setExisting(found), () => {})
    }
    return () => {
      live = false
    }
  }, [binder, page, lookupPage])

  function changeBinder(next: string) {
    setBinder(next)
    setPage(nextPageFor(binders, next))
    setUploaded(null)
  }

  async function run(from: Uploaded | null) {
    setError(null)
    setStatus("working")
    try {
      let photo = from
      if (!photo) {
        if (!file) throw new Error("Take a photo of the page first.")
        const prepared = await prepareImage(file)
        const blob = await uploadPresigned("scans/page.jpg", prepared.blob, {
          access: "private",
          handleUploadUrl: "/api/blob/upload",
          contentType: "image/jpeg",
        })
        photo = { url: blob.url, width: prepared.width, height: prepared.height }
        setUploaded(photo)
      }
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageUrl: photo.url, width: photo.width, height: photo.height, binder: binder.trim(), page }),
      })
      const result = (await response.json().catch(() => null)) as { scanId?: number; message?: string } | null
      if (response.ok && result?.scanId) {
        router.push(`/scans/${result.scanId}`)
        return
      }
      throw new Error(result?.message ?? "Couldn't read that photo. Try again.")
    } catch (caught) {
      setError(caught instanceof UnreadableImageError ? caught.message : caught instanceof Error ? caught.message : String(caught))
      setStatus("idle")
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void run(null)
  }

  const items = binders.map((b) => ({ value: b.name, label: b.name }))
  const working = status === "working"

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <Combobox
        items={items}
        value={null}
        query={binder}
        onQueryChange={changeBinder}
        onValueChange={(value, details) => {
          details.cancel()
          if (typeof value === "string") changeBinder(value)
        }}
      >
        <div className="flex flex-col gap-1">
          <ComboboxLabel className="text-sm text-ink-soft">Binder</ComboboxLabel>
          <ComboboxInput placeholder="Main" className="h-11 w-full" />
        </div>
        <ComboboxContent>
          <ComboboxList>
            {(state) =>
              (state.items as typeof items).map((item) => (
                <ComboboxItem key={item.value} value={item.value} label={item.label}>
                  {item.label}
                </ComboboxItem>
              ))
            }
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      <label className="flex flex-col gap-1 text-sm text-ink-soft">
        Page
        <input
          type="number"
          min={1}
          step={1}
          required
          value={Number.isNaN(page) ? "" : page}
          onChange={(e) => {
            setPage(e.target.valueAsNumber)
            setUploaded(null)
          }}
          className="h-11 w-28 rounded border border-line bg-surface px-3 text-base text-ink"
        />
      </label>

      {existing ? (
        <p className="rounded border border-line bg-paper px-3 py-2 text-sm">
          Replaces the scan from {shortDate(existing.committedAt)} ({existing.cards} cards).
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm text-ink-soft">
        Photo of the page
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setUploaded(null)
          }}
          className="text-base text-ink"
        />
      </label>

      {error ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-down">
          <span>{error}</span>
          {uploaded ? (
            <button type="button" onClick={() => void run(uploaded)} className="underline">
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      <button type="submit" disabled={working} className="h-11 rounded bg-ink px-4 text-surface disabled:opacity-60">
        {working ? "Reading 9 pockets…" : "Scan page"}
      </button>
    </form>
  )
}

export { CaptureForm }
export type { BinderInfo }

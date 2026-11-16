"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, type PointerEvent, type ReactNode } from "react"
import { binderHref } from "@/lib/binder-params"

type Props = { binder: string; page: number; pageCount: number; children?: ReactNode }

const SWIPE_MIN_PX = 50
const ARROW = "grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-line bg-surface text-lg leading-none"

const typingInto = (target: EventTarget | null) =>
  target instanceof Element && target.closest("input, textarea, select, [contenteditable], [role='dialog'], [role='alertdialog'], [role='listbox']") !== null

// Wraps the page grid: swipe on the grid, arrow keys anywhere, and previous / dots / next underneath.
// Flips replace the URL so the back button doesn't step through every page turned.
function Pager({ binder, page, pageCount, children }: Props) {
  const router = useRouter()
  const start = useRef<{ x: number; y: number } | null>(null)

  function flip(to: number) {
    if (to < 1 || to > pageCount || to === page) return
    router.replace(binderHref({ binder, page: to }), { scroll: false })
  }
  const latest = useRef(flip)
  latest.current = flip

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || typingInto(event.target)) return
      if (event.key === "ArrowLeft") latest.current(page - 1)
      if (event.key === "ArrowRight") latest.current(page + 1)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [page])

  function pointerUp(event: PointerEvent) {
    const from = start.current
    start.current = null
    if (!from || event.pointerType === "mouse") return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return
    flip(dx < 0 ? page + 1 : page - 1)
  }

  return (
    <div className="flex w-full max-w-[22rem] flex-col gap-3">
      <div
        className="touch-pan-y"
        onPointerDown={(event) => {
          start.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={pointerUp}
        onPointerCancel={() => {
          start.current = null
        }}
      >
        {children}
      </div>
      <nav aria-label="Binder pages" className="flex items-center justify-between gap-3">
        <button type="button" aria-label="Previous page" onClick={() => flip(page - 1)} className={ARROW}>
          <span aria-hidden="true">‹</span>
        </button>
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <p className="tabular text-sm font-semibold">
            Page {page} of {pageCount}
          </p>
          <ol className="flex list-none flex-wrap justify-center gap-0.5 p-0">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <li key={n}>
                <a
                  href={binderHref({ binder, page: n })}
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault()
                    flip(n)
                  }}
                  className="group grid h-6 w-4 place-items-center"
                >
                  <span className="block h-2 w-2 rounded-full bg-line group-aria-[current=page]:bg-ink" />
                </a>
              </li>
            ))}
          </ol>
        </div>
        <button type="button" aria-label="Next page" onClick={() => flip(page + 1)} className={ARROW}>
          <span aria-hidden="true">›</span>
        </button>
      </nav>
    </div>
  )
}

export { Pager }

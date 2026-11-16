import type { CardRef } from "./binder-view"

type RawParams = Record<string, string | string[] | undefined>
type BinderParams = { binder: string | null; page: number; card: CardRef | null; hl: number | null }

const SLOTS = 9

function parseCard(text: string | undefined): CardRef | null {
  const match = /^([rl])(\d+)$/.exec(text ?? "")
  if (!match) return null
  return match[1] === "r" ? { resultId: Number(match[2]) } : { lotId: Number(match[2]) }
}

// `pageCount` is asked for the binder named in the URL; the page is clamped to 1..pageCount. `p=last` is the last page.
function parseBinderParams(raw: RawParams, pageCount: (binder: string) => number): BinderParams {
  const one = (key: string) => {
    const value = raw[key]
    return typeof value === "string" ? value : undefined
  }
  const binder = one("b")?.trim() || null
  const pages = Math.max(1, pageCount(binder ?? ""))
  const p = one("p") ?? ""
  const page = p === "last" ? pages : /^\d+$/.test(p) ? Math.min(pages, Math.max(1, Number(p))) : 1
  const hl = one("hl") ?? ""
  return {
    binder,
    page,
    card: parseCard(one("card")),
    hl: /^[1-9]$/.test(hl) && Number(hl) <= SLOTS ? Number(hl) : null,
  }
}

function binderHref(p: { binder: string; page: number | "last"; card?: CardRef | null; hl?: number | null }): string {
  let href = `/binders?b=${encodeURIComponent(p.binder)}&p=${p.page}`
  if (p.card) href += `&card=${"resultId" in p.card ? `r${p.card.resultId}` : `l${p.card.lotId}`}`
  if (p.hl) href += `&hl=${p.hl}`
  return href
}

export { binderHref, parseBinderParams }
export type { BinderParams, RawParams }

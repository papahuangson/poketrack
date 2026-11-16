"use client"

import { useAsyncOptions } from "@ui-sdk/react/async-options"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxStatus,
} from "@ui-sdk/react/combobox"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { binderHref } from "@/lib/binder-params"
import type { OwnedHit, Where } from "@/lib/binder-view"

type Props = {
  search: (q: string) => Promise<OwnedHit[]>
  current: { binder: string; page: number }
  /** Called when a card that isn't on a page is picked, so the strip can highlight it even without a page change. */
  onPickUnplaced?: (lotId: number) => void
}

type Option = { value: string; label: string; hit: OwnedHit }

const DEBOUNCE_MS = 250

const keyOf = (where: Where) => (where.kind === "pocket" ? `r${where.resultId}` : `${where.kind === "unplaced" ? "u" : "l"}${where.lotId}`)

function whereText(where: Where): string {
  if (where.kind === "pocket") return `${where.binder} · page ${where.page}, pocket ${where.slot}`
  if (where.kind === "unplaced") return `${where.binder} · not on a page`
  return "No binder"
}

function SearchBox({ search, current, onPickUnplaced }: Props) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const owned = useAsyncOptions(
    async (q: string): Promise<Option[]> => {
      if (q.trim().length < 2) return []
      return (await search(q)).map((hit) => ({ value: keyOf(hit.where), label: hit.name, hit }))
    },
    { debounce: DEBOUNCE_MS },
  )

  function changeQuery(next: string) {
    setQuery(next)
    owned.setQuery(next)
  }

  function go({ where }: OwnedHit) {
    if (where.kind === "pocket") {
      router.push(binderHref({ binder: where.binder, page: where.page, hl: where.slot }))
    } else if (where.kind === "unplaced") {
      router.push(`${binderHref({ binder: where.binder, page: "last" })}#unplaced-${where.lotId}`)
      onPickUnplaced?.(where.lotId)
    } else {
      router.push(binderHref({ binder: current.binder, page: current.page, card: { lotId: where.lotId } }), { scroll: false })
    }
  }

  return (
    <Combobox
      items={owned.items}
      filter={false}
      status={owned.status}
      value={null}
      query={query}
      onQueryChange={changeQuery}
      onValueChange={(value, details) => {
        details.cancel()
        const option = owned.items.find((item) => item.value === value)
        if (!option) return
        changeQuery("")
        go(option.hit)
      }}
    >
      <div className="flex flex-col gap-1">
        <ComboboxLabel className="text-sm text-ink-soft">Find a card</ComboboxLabel>
        <ComboboxInput placeholder="Search your cards…" className="h-11 w-full text-base" />
      </div>
      <ComboboxContent>
        <ComboboxStatus>{(state) => (state.status === "error" ? "Search is not working right now. Try again." : null)}</ComboboxStatus>
        <ComboboxEmpty>
          {(state) =>
            owned.status !== "error" && state.empty && !state.loading && state.query.trim().length >= 2 ? "None of your cards match." : null
          }
        </ComboboxEmpty>
        <ComboboxList>
          {(state) =>
            (state.items as Option[]).map(({ value, label, hit }) => (
              <ComboboxItem key={value} value={value} label={label} className="flex h-auto items-center gap-3 py-1.5">
                {hit.imageSmall ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hit.imageSmall} alt="" width={32} height={45} className="aspect-[63/88] w-8 rounded-[2px]" />
                ) : (
                  <span className="aspect-[63/88] w-8 shrink-0 rounded-[2px] bg-paper" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">
                    {hit.name} · {hit.setName} {hit.number}/{hit.printedTotal}
                  </span>
                  <span className="truncate text-sm text-ink-soft">{whereText(hit.where)}</span>
                </span>
              </ComboboxItem>
            ))
          }
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export { SearchBox }

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
} from "@ui-sdk/react/combobox"
import { useState } from "react"
import type { CardHit } from "@/lib/collection"

type Option = { value: string; label: string; hit: CardHit }

async function search(query: string, { signal }: { signal: AbortSignal }): Promise<Option[]> {
  if (query.trim().length < 2) return []
  const response = await fetch(`/api/cards/search?q=${encodeURIComponent(query)}`, { signal })
  if (!response.ok) throw new Error(`Search failed with ${response.status}`)
  return ((await response.json()) as CardHit[]).map((hit) => ({ value: hit.id, label: hit.name, hit }))
}

type Props = { slot: number; candidates: CardHit[]; hasCard: boolean; onPick: (card: CardHit) => void }

function PocketCardPicker({ slot, candidates, hasCard, onPick }: Props) {
  const found = useAsyncOptions(search, { debounce: 200 })
  const [query, setQuery] = useState("")
  const seeded: Option[] = candidates.map((hit) => ({ value: hit.id, label: hit.name, hit }))
  const items = query.trim().length >= 2 ? found.items : seeded

  return (
    <Combobox
      items={items}
      filter={false}
      status={query.trim().length >= 2 ? found.status : undefined}
      value={null}
      query={query}
      onQueryChange={(next) => {
        setQuery(next)
        found.setQuery(next)
      }}
      onValueChange={(value, details) => {
        details.cancel()
        const option = items.find((item) => item.value === value)
        if (!option) return
        onPick(option.hit)
        setQuery("")
      }}
    >
      <ComboboxLabel className="sr-only">Card in pocket {slot}</ComboboxLabel>
      <ComboboxInput placeholder={hasCard ? "Wrong card? Pick or search…" : "Pick or search…"} className="h-9 w-full text-sm" />
      <ComboboxContent>
        <ComboboxEmpty>{(state) => (state.empty && !state.loading ? "No cards found." : null)}</ComboboxEmpty>
        <ComboboxList>
          {(state) =>
            (state.items as Option[]).map(({ value, label, hit }) => (
              <ComboboxItem key={value} value={value} label={label} className="flex h-auto items-center gap-2 py-1">
                {hit.imageSmall ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hit.imageSmall} alt="" width={24} height={34} className="aspect-[63/88] w-6 rounded-[2px]" />
                ) : null}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{label}</span>
                  <span className="truncate text-xs text-ink-soft">
                    {hit.setName}, {hit.number}/{hit.printedTotal}
                  </span>
                </span>
              </ComboboxItem>
            ))
          }
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export { PocketCardPicker }

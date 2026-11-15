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
import { useState } from "react"
import { AddCardForm } from "@/components/collection/add-card-form"
import type { CardHit } from "@/lib/collection"

type Option = { value: string; label: string; hit: CardHit }

async function search(query: string, { signal }: { signal: AbortSignal }): Promise<Option[]> {
  if (query.trim().length < 2) return []
  const response = await fetch(`/api/cards/search?q=${encodeURIComponent(query)}`, { signal })
  if (!response.ok) throw new Error(`Search failed with ${response.status}`)
  const hits = (await response.json()) as CardHit[]
  return hits.map((hit) => ({ value: hit.id, label: hit.name, hit }))
}

function AddCard() {
  const cards = useAsyncOptions(search, { debounce: 200 })
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<CardHit | null>(null)

  function changeQuery(next: string) {
    setQuery(next)
    cards.setQuery(next)
  }

  return (
    <div>
      <Combobox
        items={cards.items}
        filter={false}
        status={cards.status}
        value={null}
        query={query}
        onQueryChange={changeQuery}
        onValueChange={(value, details) => {
          details.cancel()
          const option = cards.items.find((item) => item.value === value)
          if (!option) return
          setPicked(option.hit)
          changeQuery("")
        }}
      >
        <div className="flex flex-col gap-1">
          <ComboboxLabel className="text-sm text-ink-soft">Add a card</ComboboxLabel>
          <ComboboxInput placeholder="Search cards to add…" className="h-12 w-full text-base" />
        </div>
        <ComboboxContent>
          <ComboboxStatus>
            {(state) => (state.status === "error" ? "Search is not working right now. Try again." : null)}
          </ComboboxStatus>
          <ComboboxEmpty>
            {(state) =>
              cards.status !== "error" && state.empty && !state.loading && state.query.trim().length >= 2
                ? "No cards found."
                : null
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
                    <span className="aspect-[63/88] w-8 rounded-[2px] bg-paper" />
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{label}</span>
                    <span className="truncate text-sm text-ink-soft">
                      {hit.setName}, {hit.number}/{hit.printedTotal}
                    </span>
                  </span>
                </ComboboxItem>
              ))
            }
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <AddCardForm card={picked} onClose={() => setPicked(null)} />
    </div>
  )
}

export { AddCard }

import { CollectionList } from "@/components/collection/collection-list"
import { Filters } from "@/components/collection/filters"
import { TotalHeader } from "@/components/collection/total-header"
import { collectionFilterOptions, collectionTotals, listCollection } from "@/lib/collection"
import { getDb } from "@/lib/db"
import { parseFilters } from "@/lib/params"

export const dynamic = "force-dynamic"

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function CollectionPage({ searchParams }: Props) {
  const db = getDb()
  const [raw, totals, options] = await Promise.all([searchParams, collectionTotals(db), collectionFilterOptions(db)])
  const filters = parseFilters(raw, { setIds: options.sets.map((set) => set.id), variants: options.variants })
  const rows = await listCollection(db, filters)
  const filtered = Boolean(filters.setId || filters.variant || filters.condition)

  return (
    <div className="space-y-8">
      <TotalHeader {...totals} />
      <section aria-label="Your cards" className="space-y-4">
        <Filters
          sets={options.sets}
          variants={options.variants}
          current={{ set: filters.setId, variant: filters.variant, condition: filters.condition, sort: filters.sort }}
        />
        <CollectionList rows={rows} filtered={filtered} />
      </section>
    </div>
  )
}

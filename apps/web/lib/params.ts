import { CONDITIONS, type Condition } from "@poketrack/db/constants"
import type { Sort } from "./collection"

const SORTS: readonly Sort[] = ["value", "name", "set", "added"]

type RawParams = Record<string, string | string[] | undefined>

type Parsed = { setId?: string; variant?: string; condition?: Condition; sort?: Sort }

function parseFilters(raw: RawParams, known: { setIds: string[]; variants: string[] }): Parsed {
  const one = (key: string) => {
    const value = raw[key]
    return typeof value === "string" ? value : undefined
  }
  const set = one("set")
  const variant = one("variant")
  const condition = one("condition")
  const sort = one("sort")
  return {
    setId: set && known.setIds.includes(set) ? set : undefined,
    variant: variant && known.variants.includes(variant) ? variant : undefined,
    condition: CONDITIONS.find((c) => c === condition),
    sort: SORTS.find((s) => s === sort),
  }
}

export { parseFilters }

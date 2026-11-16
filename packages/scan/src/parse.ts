type ParsedNumber = { number: string; printedTotal: number | null }

const clean = (part: string) => part.replace(/\s+/g, "").toUpperCase()

function normalizeNumber(raw: string): string | null {
  const text = clean(raw)
  if (!/^[A-Z]*\d+[A-Z]?$/.test(text)) return null
  if (/^\d+$/.test(text)) return String(Number.parseInt(text, 10))
  return text
}

function parseNumber(printed: string | null): ParsedNumber | null {
  if (printed === null) return null
  const [left, right, ...rest] = printed.split("/")
  if (left === undefined || rest.length > 0) return null
  const number = normalizeNumber(left)
  if (number === null) return null
  if (right === undefined) return { number, printedTotal: null }
  const total = clean(right).match(/^[A-Z]*(\d+)$/)
  return { number, printedTotal: total?.[1] ? Number.parseInt(total[1], 10) : null }
}

export { parseNumber }
export type { ParsedNumber }

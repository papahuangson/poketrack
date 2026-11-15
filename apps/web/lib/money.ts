import { ValidationError } from "./errors"

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function formatUsd(cents: number | null): string {
  return cents === null ? "—" : usd.format(cents / 100)
}

function parseUsd(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replaceAll(",", "")
  if (cleaned === "") return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new ValidationError("paidCents", "Enter a price like 12.50.")
  }
  return Math.round(Number(cleaned) * 100)
}

export { formatUsd, parseUsd }

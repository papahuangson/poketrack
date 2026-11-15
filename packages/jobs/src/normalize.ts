import { createHash } from "node:crypto"

function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

function reprintKey(name: string, rulesText: string): string {
  return createHash("sha256")
    .update(`${normalizeText(name)}|${normalizeText(rulesText)}`)
    .digest("hex")
}

export { normalizeText, reprintKey }

"use server"

import { committedScanFor, type CommittedScan } from "@/lib/binders"
import { getDb } from "@/lib/db"

async function lookupPageAction(binder: string, page: number): Promise<CommittedScan | null> {
  if (binder.trim() === "" || !Number.isInteger(page) || page < 1) return null
  return committedScanFor(getDb(), binder, page)
}

export { lookupPageAction }

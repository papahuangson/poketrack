import { chicagoDate, type Db, type Runner } from "@poketrack/db"
import { syncCatalog } from "./catalog-sync"
import { refreshPrices } from "./prices"
import { claimRun, finishRun } from "./run-lock"
import type { CatalogProvider, PriceProvider } from "./types"

const NIGHTLY_JOB = "nightly"

type NightlyResult = { claimed: false } | { claimed: true; status: "ok" } | { claimed: true; status: "failed"; error: string }

async function runNightly(
  db: Db,
  provider: CatalogProvider & PriceProvider,
  { runner, gitSha, now = new Date() }: { runner: Runner; gitSha: string; now?: Date },
): Promise<NightlyResult> {
  const runDate = chicagoDate(now)
  if (!(await claimRun(db, { job: NIGHTLY_JOB, runDate, runner, gitSha, now }))) return { claimed: false }

  try {
    await syncCatalog(db, provider)
    await refreshPrices(db, provider, runDate)
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)
    await finishRun(db, { job: NIGHTLY_JOB, runDate, status: "failed", error })
    return { claimed: true, status: "failed", error }
  }
  await finishRun(db, { job: NIGHTLY_JOB, runDate, status: "ok" })
  return { claimed: true, status: "ok" }
}

export { NIGHTLY_JOB, runNightly }
export type { NightlyResult }

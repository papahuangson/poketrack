import { sql, type Db, type ScanStatus } from "@poketrack/db"
import { expireStaleReads } from "./scan-expiry"

type ScanSummary = { id: number; status: ScanStatus; createdAt: string; cards: number }
type PageHistory = { binder: string; page: number; current: ScanSummary | null; older: ScanSummary[] }

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] }
  return result.rows
}

async function listScanHistory(db: Db): Promise<PageHistory[]> {
  await expireStaleReads(db)
  const found = await rows<{ id: number; binder: string; page: number; status: ScanStatus; createdAt: Date | string; cards: number }>(
    db,
    sql`select s.id, trim(s.binder) as binder, s.page, s.status, s.created_at as "createdAt",
               (select count(*)::int from scan_results r
                 where r.scan_id = s.id and r.decision = 'confirmed' and not r.empty) as cards
        from scans s
        order by lower(trim(s.binder)), s.page, s.created_at desc, s.id desc`,
  )
  const pages = new Map<string, PageHistory>()
  for (const r of found) {
    const key = `${r.binder.toLowerCase()}|${r.page}`
    const page = pages.get(key) ?? { binder: r.binder, page: r.page, current: null, older: [] }
    const summary: ScanSummary = { id: r.id, status: r.status, createdAt: new Date(r.createdAt).toISOString(), cards: r.cards }
    if (r.status === "committed") page.current = summary
    else page.older.push(summary)
    pages.set(key, page)
  }
  for (const page of pages.values()) if (page.current) page.binder = found.find((r) => r.id === page.current!.id)!.binder
  return [...pages.values()]
}

async function scanAccuracy(db: Db): Promise<{ firstGuessRight: number; nonEmpty: number }> {
  const [row] = await rows<{ right: number; nonEmpty: number }>(
    db,
    sql`select count(*) filter (where r.decision = 'confirmed' and r.chosen_card_id = r.candidates->0->>'cardId')::int as right,
               count(*)::int as "nonEmpty"
        from scan_results r join scans s on s.id = r.scan_id
        where s.status = 'committed' and not r.empty`,
  )
  return { firstGuessRight: row?.right ?? 0, nonEmpty: row?.nonEmpty ?? 0 }
}

async function addedNote(db: Db, scanId: number): Promise<string | null> {
  const [row] = await rows<{ binder: string; page: number; cards: number }>(
    db,
    sql`select trim(s.binder) as binder, s.page,
               (select count(*)::int from scan_results r where r.scan_id = s.id and r.decision = 'confirmed' and not r.empty) as cards
        from scans s where s.id = ${scanId} and s.status = 'committed'`,
  )
  if (!row) return null
  return `Added ${row.cards} card${row.cards === 1 ? "" : "s"} from ${row.binder} · page ${row.page}`
}

export { addedNote, listScanHistory, scanAccuracy }
export type { PageHistory, ScanSummary }

import { sql, type Db } from "@poketrack/db"

type CommittedScan = { id: number; committedAt: string; cards: number }

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] }
  return result.rows
}

const key = (binder: string) => binder.trim().toLowerCase()

async function listBinders(db: Db): Promise<string[]> {
  const found = await rows<{ name: string }>(
    db,
    sql`select name from (
          select trim(binder) as name, 0 as source, min(id) as first from scans group by trim(binder)
          union all
          select trim(binder) as name, 1 as source, min(id) as first from collection_items
          where binder is not null and trim(binder) <> '' group by trim(binder)
        ) b order by source, first`,
  )
  const seen = new Map<string, string>()
  for (const { name } of found) if (!seen.has(key(name))) seen.set(key(name), name)
  return [...seen.values()]
}

async function lastPage(db: Db, binder: string): Promise<number | null> {
  const [row] = await rows<{ page: number | null }>(db, sql`select max(page)::int as page from scans where lower(trim(binder)) = ${key(binder)}`)
  return row?.page ?? null
}

async function committedScanFor(db: Db, binder: string, page: number): Promise<CommittedScan | null> {
  const [row] = await rows<{ id: number; committedAt: Date | string; cards: number }>(
    db,
    sql`select s.id, s.committed_at as "committedAt",
               (select count(*)::int from scan_results r where r.scan_id = s.id and r.decision = 'confirmed' and not r.empty) as cards
        from scans s
        where lower(trim(s.binder)) = ${key(binder)} and s.page = ${page} and s.status = 'committed'
        limit 1`,
  )
  if (!row) return null
  return { id: row.id, committedAt: new Date(row.committedAt).toISOString(), cards: row.cards }
}

async function latestBinder(db: Db): Promise<string | null> {
  const [row] = await rows<{ binder: string }>(db, sql`select trim(binder) as binder from scans order by id desc limit 1`)
  return row?.binder ?? null
}

export { committedScanFor, lastPage, latestBinder, listBinders }
export type { CommittedScan }

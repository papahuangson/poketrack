import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema"

type Db = PgDatabase<PgQueryResultHKT, typeof schema>

function createDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 5 })
  return drizzle(pool, { schema }) as unknown as Db
}

export { createDb }
export type { Db }

import { PGlite } from "@electric-sql/pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { Db } from "./client"
import { migrationsFolder } from "./migrations-path"
import * as schema from "./schema"

let template: Promise<PGlite> | undefined

async function migrated(): Promise<PGlite> {
  const client = new PGlite({ extensions: { pg_trgm } })
  await migrate(drizzle(client, { schema }), { migrationsFolder })
  return client
}

async function createTestDb(): Promise<Db> {
  template ??= migrated()
  const client = (await (await template).clone()) as PGlite
  return drizzle(client, { schema }) as unknown as Db
}

export { createTestDb }

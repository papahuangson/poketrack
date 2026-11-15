import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"
import { loadDotEnv } from "../src/env"
import { migrationsFolder } from "../src/migrations-path"

loadDotEnv()

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set")
  process.exit(2)
}

const pool = new pg.Pool({ connectionString: url })
await migrate(drizzle(pool), { migrationsFolder })
await pool.end()
console.log("Migrations applied")

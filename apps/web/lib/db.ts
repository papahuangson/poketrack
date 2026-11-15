import { createDb, type Db } from "@poketrack/db"

let db: Db | undefined

function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL is not set")
    db = createDb(url)
  }
  return db
}

export { getDb }

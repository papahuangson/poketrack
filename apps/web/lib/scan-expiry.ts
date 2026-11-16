import { sql, type Db } from "@poketrack/db"

const STUCK_AFTER_SECONDS = 90

// A scan whose request died (timeout, crash) would otherwise stay "reading" forever.
async function expireStaleReads(db: Db): Promise<void> {
  await db.execute(
    sql`update scans set status = 'failed', error = 'Reading the photo took too long. Try again.'
        where status = 'reading' and created_at < now() - make_interval(secs => ${STUCK_AFTER_SECONDS})`,
  )
}

export { expireStaleReads }

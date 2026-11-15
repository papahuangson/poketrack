import { fileURLToPath } from "node:url"

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url))

export { migrationsFolder }

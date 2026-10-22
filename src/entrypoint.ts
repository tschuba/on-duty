import { logger } from "./lib/logger.js"
import { fileURLToPath } from 'url'
import { join } from 'path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { runSeed } from './db/seed.js'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql)

try {
  await migrate(db, { migrationsFolder: join(fileURLToPath(new URL('.', import.meta.url)), '../drizzle') })
  await runSeed()
} catch (err) {
  logger.fatal({ err }, "Startup failed")
  process.exit(1)
} finally {
  await sql.end()
}

await import('./index.js')

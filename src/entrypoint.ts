import { logger } from "./lib/logger.js"
import { fileURLToPath } from 'url'
import { join } from 'path'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { runSeed } from './db/seed.js'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL!, max: 1 })
const db = drizzle(pool)

try {
  await migrate(db, { migrationsFolder: join(fileURLToPath(new URL('.', import.meta.url)), '../drizzle') })
  await runSeed()
} catch (err) {
  logger.fatal({ err }, "Startup failed")
  process.exit(1)
} finally {
  await pool.end()
}

await import('./index.js')

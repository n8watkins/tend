// Applies the SQL migrations in db/migrations (written by `drizzle-kit
// generate`) to TURSO_DATABASE_URL, in name order, each once. Applied names
// are kept in the _migrations table; each migration runs in one batch, so it
// applies fully or not at all.
//
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate.mjs
//   node scripts/migrate.mjs --fresh    (local file: databases only) start from an empty file

import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('TURSO_DATABASE_URL is not set')
  process.exit(1)
}

if (process.argv.includes('--fresh')) {
  if (!url.startsWith('file:')) {
    console.error('--fresh only runs against a local file: database')
    process.exit(1)
  }
  const file = url.slice('file:'.length)
  mkdirSync(dirname(file), { recursive: true })
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true })
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
await client.execute('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL)')
const applied = new Set((await client.execute('SELECT name FROM _migrations')).rows.map((r) => r.name))

const dir = join(process.cwd(), 'db', 'migrations')
const pending = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => !applied.has(f))

for (const name of pending) {
  const statements = readFileSync(join(dir, name), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
  await client.batch(
    [...statements, { sql: 'INSERT INTO _migrations (name, appliedAt) VALUES (?, ?)', args: [name, Date.now()] }],
    'write',
  )
  console.log(`applied ${name}`)
}
console.log(pending.length ? `${pending.length} migration(s) applied` : 'database is up to date')
client.close()

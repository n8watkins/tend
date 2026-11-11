import { defineConfig } from 'drizzle-kit'

// Only `drizzle-kit generate` uses this: it writes SQL migrations from
// db/schema.ts. scripts/migrate.mjs applies them.
export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'turso',
})

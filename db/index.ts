/**
 * The Drizzle client for Turso (libSQL). Server-only.
 *
 * Created lazily on first use, so importing this module (for example while
 * `next build` collects routes) does not need TURSO_DATABASE_URL. The proxy's
 * target shares LibSQLDatabase's prototype so the Auth.js adapter's
 * `is(db, BaseSQLiteDatabase)` check passes without connecting.
 */

import { createClient } from '@libsql/client'
import { drizzle, LibSQLDatabase } from 'drizzle-orm/libsql'

import * as schema from './schema'

export type Database = LibSQLDatabase<typeof schema>

let instance: Database | undefined

function getDb(): Database {
  if (!instance) {
    const url = process.env.TURSO_DATABASE_URL
    if (!url) throw new Error('TURSO_DATABASE_URL is not set (see README.md, Development)')
    instance = drizzle(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }), { schema })
  }
  return instance
}

export const db: Database = new Proxy(Object.create(LibSQLDatabase.prototype) as Database, {
  get(_target, prop) {
    const real = getDb()
    const value = Reflect.get(real, prop, real)
    return typeof value === 'function' ? value.bind(real) : value
  },
})

export { schema }

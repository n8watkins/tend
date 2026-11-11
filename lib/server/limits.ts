import 'server-only'

/**
 * Fixed-window counters in the rate_limit table (docs/SPEC.md section 11).
 * Each key is per UTC day; the cron deletes expired rows.
 */

import { lt, sql } from 'drizzle-orm'

import { db } from '@/db'
import { rateLimits } from '@/db/schema'
import { DAY } from '@/lib/time'

export interface Rule {
  key: string
  limit: number
}

function dayStamp(now: number): { stamp: string; resetAt: number } {
  const start = now - (now % DAY)
  return { stamp: new Date(start).toISOString().slice(0, 10), resetAt: start + DAY }
}

/** Reads a numeric limit from the environment, or the default. */
export function readLimit(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * Spends one from every rule. Refused (false) when any rule is already at its
 * limit; a refused request still counts against the rules checked before it.
 */
export async function spend(rules: Rule[], now = Date.now()): Promise<boolean> {
  const { stamp, resetAt } = dayStamp(now)
  for (const rule of rules) {
    const key = `${rule.key}:${stamp}`
    const [row] = await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt })
      .onConflictDoUpdate({ target: rateLimits.key, set: { count: sql`${rateLimits.count} + 1` } })
      .returning({ count: rateLimits.count })
    if (!row || row.count > rule.limit) return false
  }
  return true
}

export async function pruneLimits(now = Date.now()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, now))
}

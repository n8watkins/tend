import 'server-only'

/**
 * Fixed-window counters in the rate_limit table (docs/SPEC.md section 11).
 * Each key is per UTC day unless its rule says `hourly`; the cron deletes
 * expired rows.
 */

import { and, eq, gt, lt, sql } from 'drizzle-orm'

import { db } from '@/db'
import { rateLimits } from '@/db/schema'
import { DAY, HOUR } from '@/lib/time'

export interface Rule {
  key: string
  limit: number
  /** Count per UTC hour instead of per UTC day. */
  hourly?: boolean
}

function windowStamp(now: number, hourly = false): { stamp: string; resetAt: number } {
  const size = hourly ? HOUR : DAY
  const start = now - (now % size)
  return { stamp: new Date(start).toISOString().slice(0, hourly ? 13 : 10), resetAt: start + size }
}

/** How many times a rule's key was spent in the current window, without spending. */
export async function spent(rule: Rule, now = Date.now()): Promise<number> {
  const { stamp } = windowStamp(now, rule.hourly)
  const [row] = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, `${rule.key}:${stamp}`), gt(rateLimits.resetAt, now)))
  return row?.count ?? 0
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
  for (const rule of rules) {
    const { stamp, resetAt } = windowStamp(now, rule.hourly)
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

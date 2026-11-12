// The helper's loop (docs/SIGNAL-HELPER.md 2.3 to 2.5 and 3.3): poll Tend,
// claim one approved message, send it once through signal-cli, report.
//
// Its own rules hold even if Tend misbehaves:
// - never more than HARD_DAILY_MAX sends in 24 hours, never two within
//   MIN_GAP_MS, never anything approved more than two hours ago or past its
//   sendBy;
// - the journal is written before and after every send, so a crash leads to
//   "unknown" and never to a second send;
// - a captcha ("proof required") or an unlinked account halts all sending
//   until the user resumes (`tend-helper resume` here, and in Settings);
// - logs carry ids, outcomes and reason codes only.

import { createHash } from 'node:crypto'

import { Revoked, Unreachable } from './api.mjs'
import { log } from './log.mjs'
import { classifySend } from './signal-cli.mjs'

export const HARD_DAILY_MAX = 20
export const MIN_GAP_MS = 2 * 60 * 1000
export const LATE_MS = 2 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000
const MAX_BODY = 4000

/** The same hash Tend binds an approval to (lib/helper.ts bodyHash). */
export function bodyHash(body) {
  return createHash('sha256').update(`tend-body-v1:${body}`).digest('base64url')
}

export function versionAtLeast(version, min) {
  const parse = (v) => (/^\d+(\.\d+){0,2}$/.test(v ?? '') ? v.split('.').map(Number) : null)
  const a = parse(version)
  const b = parse(min)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}

const E164 = /^\+[1-9]\d{6,14}$/

export class Runner {
  /**
   * @param {{
   *   api: import('./api.mjs').TendApi,
   *   openSignal: () => import('./signal-cli.mjs').SignalCli,
   *   journal: import('./journal.mjs').Journal,
   *   state: { read: () => object, write: (s: object) => void },
   *   version: string,
   *   now?: () => number,
   * }} options
   */
  constructor(options) {
    this.api = options.api
    this.openSignal = options.openSignal
    this.journal = options.journal
    this.state = options.state
    this.version = options.version
    this.now = options.now ?? Date.now
    this.signal = null
    this.lastStatus = null
    this.outdatedReported = false
    this.pollSeconds = 30
  }

  signalCli() {
    if (!this.signal || this.signal.exited !== null) this.signal = this.openSignal()
    return this.signal
  }

  async close() {
    await this.signal?.close()
  }

  note(status, fields = {}) {
    if (status !== this.lastStatus) log(status, fields)
    this.lastStatus = status
    return status
  }

  halt(reason, extra = {}) {
    this.state.write({ ...this.state.read(), halted: true, haltReason: reason, haltedAt: this.now(), ...extra })
  }

  /** Reports what the journal says is unsettled: crashed mid-send (unknown) or not yet accepted. */
  async recover() {
    for (const p of this.journal.pending()) {
      const accepted = await this.api.result(p.id, { claimId: p.claimId, outcome: p.outcome, signalTimestamp: p.signalTimestamp ?? null, ...(p.reason ? { reason: p.reason } : {}) })
      // Accepted, or Tend no longer knows this claim: either way it is settled here.
      this.journal.reported(p.id, p.claimId, this.now())
      log('reported', { messageId: p.id, claimId: p.claimId, outcome: p.outcome, status: accepted ? 'accepted' : 'stale' })
    }
  }

  /** One poll. Returns what happened, for the loop and the tests. Throws Revoked when the token is gone. */
  async cycle() {
    let data
    try {
      await this.recover()
      data = await this.api.jobs()
    } catch (error) {
      if (error instanceof Revoked) throw error
      if (error instanceof Unreachable) return this.note('offline')
      throw error
    }
    const poll = Number(data.pollSeconds)
    this.pollSeconds = Number.isFinite(poll) ? Math.min(300, Math.max(10, poll)) : 30

    if (!versionAtLeast(this.version, data.minHelperVersion)) {
      if (!this.outdatedReported) {
        this.outdatedReported = true
        await this.api.event('outdated').catch(() => {})
      }
      return this.note('outdated', { version: this.version, minVersion: String(data.minHelperVersion) })
    }
    const local = this.state.read()
    if (local.halted) return this.note('halted', { reason: local.haltReason ?? 'halted' })
    if (data.paused) return this.note('paused')
    if (data.halted) return this.note('halted_by_tend', { reason: String(data.halted) })

    const now = this.now()
    const jobs = Array.isArray(data.jobs) ? data.jobs : []
    if (!jobs.length) return this.note('idle')
    const cap = Math.min(HARD_DAILY_MAX, Number(data.caps?.dailyMax) || HARD_DAILY_MAX)
    if (this.journal.startedSince(now - DAY) >= cap) return this.note('local_cap', { count: cap })
    if (now - this.journal.lastStartedAt() < MIN_GAP_MS) return this.note('waiting')

    const job = jobs.find((j) => typeof j.id === 'string' && this.mayStart(j, now))
    if (!job) return this.note('nothing_to_start', { jobs: jobs.length })
    return this.sendOne(job.id)
  }

  /**
   * Never a message whose earlier attempt is unsettled, and never one already
   * attempted here unless the user approved it again afterwards ("Send it
   * again"), whatever Tend says.
   */
  mayStart(job, now) {
    if (this.journal.unsettled(job.id) || this.late(job, now)) return false
    const last = this.journal.lastStartedFor(job.id)
    return !last || Number(job.approvedAt) > last
  }

  late(job, now) {
    return !(Number(job.sendBy) >= now) || now - Number(job.approvedAt) > LATE_MS
  }

  async sendOne(id) {
    /** @type {{ ok: boolean, job?: any, reason?: string }} */
    const claim = await this.api.claim(id).catch((error) => {
      if (error instanceof Revoked) throw error
      return { ok: false, reason: 'unreachable' }
    })
    if (!claim.ok) {
      log('refused', { messageId: id, reason: claim.reason })
      this.lastStatus = 'refused'
      return 'refused'
    }
    const job = claim.job
    const now = this.now()
    const attempted = this.journal.lastStartedFor(id)
    this.journal.started(id, job.claimId, now)

    let outcome
    const invalid =
      job.id !== id ||
      (attempted && !(Number(job.approvedAt) > attempted)) ||
      !E164.test(String(job.recipient)) ||
      typeof job.body !== 'string' ||
      !job.body ||
      job.body.length > MAX_BODY ||
      bodyHash(job.body) !== job.bodyHash
    if (invalid) outcome = { outcome: 'failed', reason: 'other' }
    else if (this.late(job, now)) outcome = { outcome: 'failed', reason: 'late' }
    else {
      let result = null
      let error = null
      try {
        result = await this.signalCli().send(job.recipient, job.body)
      } catch (e) {
        error = e
      }
      outcome = classifySend(result, error)
    }

    this.journal.done(id, job.claimId, outcome.outcome, { signalTimestamp: outcome.signalTimestamp ?? null, ...(outcome.reason ? { reason: outcome.reason } : {}) }, this.now())
    log('send', { messageId: id, claimId: job.claimId, outcome: outcome.outcome, reason: outcome.reason })

    if (outcome.reason === 'challenge' || outcome.reason === 'unlinked') {
      // Stop everything until the user deals with it; no captcha is ever solved here.
      this.halt(outcome.reason, outcome.challenge ? { challengeToken: outcome.challenge } : {})
      await this.api.event(outcome.reason).catch(() => {})
      log('halted', { reason: outcome.reason })
    }
    try {
      await this.api.result(id, {
        claimId: job.claimId,
        outcome: outcome.outcome,
        signalTimestamp: outcome.signalTimestamp ?? null,
        ...(outcome.reason ? { reason: outcome.reason === 'unlinked' ? 'unlinked' : outcome.reason } : {}),
      })
      this.journal.reported(id, job.claimId, this.now())
    } catch (error) {
      if (error instanceof Revoked) throw error
      // Reported on the next poll (recover), from the journal.
    }
    this.lastStatus = outcome.outcome
    return outcome.outcome
  }

  /** Polls until stopped. Resolves with an exit code: 3 when the token was revoked. */
  async loop(stop) {
    log('started', { version: this.version })
    while (!stop.stopped) {
      try {
        await this.cycle()
      } catch (error) {
        if (error instanceof Revoked) {
          log('revoked')
          return 3
        }
        log('error', { code: error?.code ? String(error.code) : 'unexpected' })
      }
      await stop.sleep(this.pollSeconds * 1000)
    }
    log('stopped')
    return 0
  }
}

/** A stop switch for the loop: SIGTERM and SIGINT end it after the current poll (never mid-send). */
export function stopSwitch() {
  const stop = {
    stopped: false,
    wake: null,
    sleep(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        stop.wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    },
    trigger() {
      stop.stopped = true
      stop.wake?.()
    },
  }
  return stop
}

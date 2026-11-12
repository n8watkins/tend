// The local journal that makes sends at most once (docs/SIGNAL-HELPER.md 2.4).
//
// An append-only file of JSON lines, each written and flushed to disk
// (fsync) before the helper moves on:
//
//   started   before signal-cli is asked to send
//   done      after signal-cli answered (sent or failed)
//   reported  after Tend accepted the result
//
// On start, a "started" with no "done" means the helper stopped mid-send:
// it reports "unknown" and never sends that claim again. A "done" with no
// "reported" is reported again (Tend accepts a result once per claim).
// Only ids, claim ids, outcomes and times are written: never numbers or text.

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs'

import { writePrivate } from './config.mjs'

const DAY = 24 * 60 * 60 * 1000
const KEEP = 14 * DAY

export class Journal {
  constructor(file) {
    this.file = file
    this.entries = []
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          this.entries.push(JSON.parse(line))
        } catch {
          // A line cut short by a crash mid-write: the entry before it still counts.
        }
      }
    }
    this.compact()
  }

  append(entry) {
    const record = { ...entry, at: entry.at ?? Date.now() }
    if (!existsSync(this.file)) writePrivate(this.file, '')
    const fd = openSync(this.file, 'a', 0o600)
    try {
      writeSync(fd, `${JSON.stringify(record)}\n`)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    this.entries.push(record)
    return record
  }

  started(id, claimId, at) {
    return this.append({ t: 'started', id, claimId, at })
  }

  done(id, claimId, outcome, extra = {}, at) {
    return this.append({ t: 'done', id, claimId, outcome, ...extra, at })
  }

  reported(id, claimId, at) {
    return this.append({ t: 'reported', id, claimId, at })
  }

  /** Claims that still need a report: crashed mid-send (unknown), or done but not yet accepted by Tend. */
  pending() {
    const byClaim = new Map()
    for (const e of this.entries) {
      const item = byClaim.get(e.claimId) ?? { id: e.id, claimId: e.claimId }
      if (e.t === 'started') item.started = e
      if (e.t === 'done') item.done = e
      if (e.t === 'reported') item.reported = e
      byClaim.set(e.claimId, item)
    }
    const out = []
    for (const item of byClaim.values()) {
      if (!item.started || item.reported) continue
      if (item.done) out.push({ id: item.id, claimId: item.claimId, outcome: item.done.outcome, signalTimestamp: item.done.signalTimestamp ?? null, reason: item.done.reason })
      else out.push({ id: item.id, claimId: item.claimId, outcome: 'unknown', signalTimestamp: null })
    }
    return out
  }

  /** True while an earlier claim of this message is not settled: never start it again. */
  unsettled(id) {
    return this.pending().some((p) => p.id === id)
  }

  /** Sends started in the last 24 hours (attempts count, whatever their outcome). */
  startedSince(since) {
    return this.entries.filter((e) => e.t === 'started' && e.at > since).length
  }

  /** When this message was last started here (0 if never). */
  lastStartedFor(id) {
    let last = 0
    for (const e of this.entries) if (e.t === 'started' && e.id === id && e.at > last) last = e.at
    return last
  }

  lastStartedAt() {
    let last = 0
    for (const e of this.entries) if (e.t === 'started' && e.at > last) last = e.at
    return last
  }

  /** Drops settled entries older than two weeks, so the file stays small. */
  compact(now = Date.now()) {
    if (this.entries.length < 2000) return
    const open = new Set(this.pending().map((p) => p.claimId))
    this.entries = this.entries.filter((e) => e.at > now - KEEP || open.has(e.claimId))
    writePrivate(this.file, this.entries.map((e) => `${JSON.stringify(e)}\n`).join(''))
  }
}

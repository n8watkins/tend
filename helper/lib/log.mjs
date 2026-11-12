// The helper's log: one JSON line per event, to journald (stdout under
// systemd) or the console. Ids, outcomes, reason codes and counts only:
// never names, phone numbers or message text (docs/SIGNAL-HELPER.md 6.4).
//
// This is enforced here, not left to each call: only known field names are
// kept, and only values that look like ids or codes (letters, digits, and
// . _ : -, at most 64 characters) or numbers and booleans. A phone number
// ("+1..."), a sentence or anything longer is dropped.

const FIELDS = new Set([
  'messageId',
  'claimId',
  'outcome',
  'reason',
  'status',
  'count',
  'jobs',
  'version',
  'minVersion',
  'retryInSeconds',
  'code',
  'halted',
  'paused',
  'received',
  'exitCode',
])
const SAFE = /^[A-Za-z0-9_.:-]{0,64}$/

let sink = (line) => process.stdout.write(`${line}\n`)

/** Tests capture the log here. */
export function setLogSink(fn) {
  const previous = sink
  sink = fn
  return previous
}

export function clean(fields = {}) {
  const out = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!FIELDS.has(key)) continue
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (typeof value === 'boolean') out[key] = value
    else if (typeof value === 'string' && SAFE.test(value)) out[key] = value
  }
  return out
}

export function log(event, fields) {
  if (!SAFE.test(event)) return
  sink(JSON.stringify({ at: new Date().toISOString(), event, ...clean(fields) }))
}

// Tend's helper API (docs/SIGNAL-HELPER.md 8.1), outbound HTTPS only, with
// the device token. Errors are classes the runner can act on: a revoked
// token stops the helper; anything else is retried on the next poll.

export class Revoked extends Error {}
export class Unreachable extends Error {}

export class TendApi {
  /** @param {{ url: string, token: string, version: string, signalCliVersion?: string | null, fetch?: typeof fetch }} options */
  constructor(options) {
    this.options = options
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async call(method, path, body) {
    let response
    try {
      response = await this.fetch(`${this.options.url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          'x-tend-helper-version': this.options.version,
          ...(this.options.signalCliVersion ? { 'x-signal-cli-version': this.options.signalCliVersion } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new Unreachable('Tend is not reachable')
    }
    if (response.status === 401) throw new Revoked('This helper was removed in Tend')
    /** @type {any} */
    const data = await response.json().catch(() => ({}))
    return { status: response.status, data }
  }

  /** The poll and heartbeat. */
  async jobs() {
    const { status, data } = await this.call('GET', '/api/helper/jobs')
    if (status !== 200) throw new Unreachable(`jobs answered ${status}`)
    return data
  }

  /** @returns {Promise<{ ok: boolean, job?: any, reason?: string, retryAt?: number }>} */
  async claim(id) {
    const { status, data } = await this.call('POST', `/api/helper/jobs/${encodeURIComponent(id)}/claim`)
    if (status === 200) return { ok: true, job: data }
    if (status === 409 || status === 404) return { ok: false, reason: String(data.error ?? 'refused'), retryAt: data.retryAt }
    throw new Unreachable(`claim answered ${status}`)
  }

  /** True once Tend has the result (also for a repeat); false when Tend says this claim is not current. */
  async result(id, body) {
    const { status } = await this.call('POST', `/api/helper/jobs/${encodeURIComponent(id)}/result`, body)
    if (status === 200) return true
    if (status === 409 || status === 404) return false
    throw new Unreachable(`result answered ${status}`)
  }

  async event(kind) {
    await this.call('POST', '/api/helper/events', { kind })
  }

  /** Exchanges a pairing code for a device token (no token yet). */
  static async pair(url, code, name, version, fetchImpl = globalThis.fetch) {
    let response
    try {
      response = await fetchImpl(`${url}/api/helper/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, name, helperVersion: version }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new Unreachable(`Could not reach ${url}`)
    }
    /** @type {any} */
    const data = await response.json().catch(() => ({}))
    if (response.ok && typeof data.token === 'string') return data.token
    if (response.status === 429) throw new Error('Too many tries. Wait an hour, then get a new code.')
    if (response.status === 404) throw new Error('This Tend does not offer the Signal helper for your account.')
    throw new Error('That code did not work. It works once, for 10 minutes: get a new one in Settings.')
  }
}

import 'server-only'

/**
 * Google Contacts import (optional): an OAuth 2.0 web-server flow with the
 * read-only contacts scope, then the People API. On only when GOOGLE_CLIENT_ID
 * and GOOGLE_CLIENT_SECRET are set. The access token is used once, for the
 * import preview, then revoked; it is never stored and no refresh token is
 * asked for (access_type=online).
 *
 * Google treats contacts.readonly as a sensitive scope: until the app is
 * verified, sign-in shows an "unverified app" warning and works for at most
 * 100 users (docs/SPEC.md, "Contact import").
 */

import { peopleToRows, type GooglePerson, type ImportRow, MAX_IMPORT_ROWS } from '@/lib/import'
import { publicUrl } from '@/lib/url'

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly'
export const GOOGLE_STATE_COOKIE = 'tend_google_state'

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

/** Google's endpoints. Only the test environment may point them at the local mock. */
function endpoints() {
  const mock = process.env.APP_ENV === 'test' ? process.env.GOOGLE_API_BASE : undefined
  return mock
    ? { auth: `${mock}/google/auth`, token: `${mock}/google/token`, people: `${mock}/google/people`, revoke: `${mock}/google/revoke` }
    : {
        auth: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        people: 'https://people.googleapis.com/v1/people/me/connections',
        revoke: 'https://oauth2.googleapis.com/revoke',
      }
}

export function googleRedirectUri(): string {
  return publicUrl('/people/import/google')
}

export function googleAuthUrl(state: string): string {
  const url = new URL(endpoints().auth)
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'online',
    include_granted_scopes: 'false',
    prompt: 'consent',
    state,
  }).toString()
  return url.toString()
}

export type GoogleResult = { ok: true; rows: ImportRow[]; truncated: boolean } | { ok: false; reason: 'exchange' | 'scope' | 'fetch' }

/** Exchanges the code, reads up to MAX_IMPORT_ROWS contacts, and revokes the token. Never throws. */
export async function readGoogleContacts(code: string): Promise<GoogleResult> {
  const urls = endpoints()
  let token: string | undefined
  try {
    const exchange = await fetch(urls.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: googleRedirectUri(),
        grant_type: 'authorization_code',
      }),
    })
    const grant = (await exchange.json().catch(() => null)) as { access_token?: string; scope?: string } | null
    if (!exchange.ok || !grant?.access_token) return { ok: false, reason: 'exchange' }
    token = grant.access_token
    // The person may untick the contacts box on Google's consent screen.
    if (grant.scope && !grant.scope.split(' ').includes(GOOGLE_SCOPE)) return { ok: false, reason: 'scope' }

    const people: GooglePerson[] = []
    let pageToken: string | undefined
    let truncated = false
    do {
      const url = new URL(urls.people)
      url.search = new URLSearchParams({
        personFields: 'names,phoneNumbers,emailAddresses,birthdays,events',
        pageSize: '1000',
        sortOrder: 'FIRST_NAME_ASCENDING',
        ...(pageToken ? { pageToken } : {}),
      }).toString()
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
      if (!response.ok) return { ok: false, reason: 'fetch' }
      const page = (await response.json()) as { connections?: GooglePerson[]; nextPageToken?: string }
      people.push(...(page.connections ?? []))
      pageToken = page.nextPageToken
      if (people.length > MAX_IMPORT_ROWS * 2) {
        truncated = Boolean(pageToken)
        break
      }
    } while (pageToken)
    const rows = peopleToRows(people)
    return { ok: true, rows: rows.slice(0, MAX_IMPORT_ROWS), truncated: truncated || rows.length > MAX_IMPORT_ROWS }
  } catch {
    return { ok: false, reason: 'fetch' }
  } finally {
    // Used once: revoke it, so it is worth nothing even if it leaked.
    if (token) {
      await fetch(urls.revoke, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      }).catch(() => undefined)
    }
  }
}

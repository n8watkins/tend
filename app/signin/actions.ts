'use server'

/**
 * Sign-in. The email path checks Turnstile (refusing when it is not configured in production) and the
 * sign-in email limits before Auth.js sends a link: per address, per IP and
 * site-wide per day, because every link spends from the account's shared
 * Email Service quota. Addresses and IPs are stored only as salted hashes.
 */

import { AuthError } from 'next-auth'
import { headers } from 'next/headers'
import { redirect, unstable_rethrow } from 'next/navigation'
import { z } from 'zod'

import { githubConfigured, signIn } from '@/auth'
import { hashKey } from '@/lib/crypto'
import { SIGNIN_PER_ADDRESS_DAILY, SIGNIN_PER_IP_DAILY, SIGNIN_SITE_DAILY } from '@/lib/limits'
import { readLimit, spend } from '@/lib/server/limits'
import { TURNSTILE_FIELD, verifyTurnstile } from '@/lib/server/turnstile'

export type SignInState = { error?: string } | undefined

const emailSchema = z.string().trim().toLowerCase().email().max(254)

export async function emailSignIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = emailSchema.safeParse(form.get('email'))
  if (!email.success) return { error: 'Enter a valid email address.' }
  const h = await headers()
  const ip = h.get('cf-connecting-ip')?.trim() || null
  const token = form.get(TURNSTILE_FIELD)
  const human = await verifyTurnstile(typeof token === 'string' ? token : null, ip)
  if (human === 'not_configured') {
    console.error(JSON.stringify({ event: 'turnstile_not_configured' }))
    return { error: 'Email sign-in is unavailable right now because the bot check is not set up. Please use GitHub or try again later.' }
  }
  if (human !== 'ok') return { error: "We couldn't confirm you're human. Please try again." }
  const rules = [
    { key: `signin:addr:${await hashKey(email.data)}`, limit: readLimit('SIGNIN_PER_ADDRESS_DAILY', SIGNIN_PER_ADDRESS_DAILY) },
    ...(ip ? [{ key: `signin:ip:${await hashKey(ip)}`, limit: readLimit('SIGNIN_PER_IP_DAILY', SIGNIN_PER_IP_DAILY) }] : []),
    { key: 'signin:site', limit: readLimit('SIGNIN_SITE_DAILY', SIGNIN_SITE_DAILY) },
  ]
  if (!(await spend(rules))) {
    return { error: 'Too many sign-in emails today. Please try again tomorrow, or use the newest link you have.' }
  }
  let next: string
  try {
    // redirect: false returns where Auth.js would go. A server-side signIn
    // ignores pages.verifyRequest, so the app sends people to its own page.
    next = await signIn('email', { email: email.data, redirectTo: '/today', redirect: false })
  } catch (error) {
    unstable_rethrow(error)
    console.error(JSON.stringify({ event: 'signin_email_failed', name: error instanceof AuthError ? error.type : 'Error' }))
    return { error: "We couldn't send the email just now. Please try again in a minute." }
  }
  if (typeof next === 'string' && next.includes('error=')) {
    return { error: "We couldn't send the email just now. Please try again in a minute." }
  }
  redirect('/signin/check-email')
}

export async function githubSignIn(): Promise<void> {
  if (!githubConfigured()) redirect('/signin')
  await signIn('github', { redirectTo: '/today' })
}

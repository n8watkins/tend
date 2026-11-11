import { handlers } from '@/auth'

export const { GET } = handlers

/**
 * Email links start only from the sign-in action (app/signin/actions.ts),
 * which checks Turnstile and the email limits. A direct POST here would skip
 * both, so it is refused; every other Auth.js POST (GitHub, sign-out) passes.
 */
export async function POST(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === '/api/auth/signin/email') {
    return new Response('Use the sign-in form.', { status: 403 })
  }
  return handlers.POST(request as Parameters<typeof handlers.POST>[0])
}

/** Per-user limits (docs/SPEC.md section 11). */
export const MAX_CONTACTS = 500
export const MAX_OPEN_MESSAGES = 20
export const SIGNIN_PER_ADDRESS_DAILY = 5
export const SIGNIN_PER_IP_DAILY = 20
export const SIGNIN_SITE_DAILY = 10
export const REMINDERS_PER_USER_DAILY = 6
export const REMINDERS_SITE_DAILY = 10
// Telegram messages from the bot (reminders and replies). Free, but capped so a
// bug or abuse can never flood anyone.
export const TELEGRAM_PER_USER_DAILY = 20
export const TELEGRAM_SITE_DAILY = 300
export const TELEGRAM_PUBLIC_DAILY = 50

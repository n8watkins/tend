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
// Phone notifications (Web Push, free): one per reminder run, with the same
// daily caps as reminder emails; PUSH_* in the environment override them.
export const PUSH_PER_USER_DAILY = REMINDERS_PER_USER_DAILY
export const PUSH_SITE_DAILY = REMINDERS_SITE_DAILY
export const PUSH_SUBSCRIPTIONS_PER_USER = 10
// Contact import: files read (or Google imports started) per user a day.
export const IMPORT_READS_PER_USER_DAILY = 30
// Signal helper pushes (approval requests and outcomes). Helper sends
// themselves are capped in lib/helper.ts (HELPER_LIMITS).
export const HELPER_PUSH_PER_USER_DAILY = 40
export const HELPER_PUSH_SITE_DAILY = 400
// Approve and Skip from notification buttons, per address an hour.
export const APPROVAL_ACTIONS_PER_IP_HOURLY = 60
// Pairing attempts per address an hour (an 8-character code; see lib/helper.ts).
export const HELPER_PAIR_PER_IP_HOURLY = 10

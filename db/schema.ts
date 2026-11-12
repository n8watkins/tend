/**
 * Drizzle schema for Turso (libSQL). docs/SPEC.md section 4 describes every
 * table. Timestamps are epoch milliseconds. Every application row carries
 * userId and every query filters by it.
 */

import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { AdapterAccountType } from 'next-auth/adapters'

import type { ConsentState, MessageKind, MessageStatus, SignalStatus, Translation } from '@/lib/enums'

const uuid = () => crypto.randomUUID()

/* Auth.js adapter tables ---------------------------------------------------- */

export const users = sqliteTable('user', {
  id: text('id').primaryKey().$defaultFn(uuid),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: integer('emailVerified', { mode: 'timestamp_ms' }),
  image: text('image'),
})

export const accounts = sqliteTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
)

export const sessions = sqliteTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
})

export const verificationTokens = sqliteTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: integer('expires', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

/* Application tables -------------------------------------------------------- */

export {
  CONSENT_STATES,
  MESSAGE_KINDS,
  MESSAGE_STATUSES,
  SIGNAL_STATUSES,
  TRANSLATIONS,
  type ConsentState,
  type MessageKind,
  type MessageStatus,
  type SignalStatus,
  type Translation,
} from '@/lib/enums'

export const userSettings = sqliteTable(
  'user_settings',
  {
    userId: text('userId')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('UTC'),
    emailReminders: integer('emailReminders', { mode: 'boolean' }).notNull().default(true),
    pausedAt: integer('pausedAt'),
    translation: text('translation').$type<Translation>().notNull().default('web'),
    // Telegram (lib/server/telegram.ts): the linked private chat, if any, and
    // whether due reminders also go there.
    telegramChatId: text('telegramChatId'),
    telegramLinkedAt: integer('telegramLinkedAt'),
    telegramReminders: integer('telegramReminders', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('createdAt').notNull(),
  },
  (t) => [uniqueIndex('user_settings_telegram_chat_idx').on(t.telegramChatId)],
)

/** One-time codes for linking a Telegram chat: t.me/<bot>?start=<code>. Only a hash is kept. */
export const telegramLinkCodes = sqliteTable('telegram_link_code', {
  codeHash: text('codeHash').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expiresAt').notNull(),
})

/**
 * Web Push subscriptions (lib/server/push.ts): one per browser or installed
 * app that turned on phone notifications. Stored as given: a subscription is
 * useless without Tend's VAPID private key, which the push services check.
 * Deleted when the push service says it is gone (404 or 410).
 */
export const pushSubscriptions = sqliteTable(
  'push_subscription',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    // A short label for Settings, like "Chrome on Android".
    device: text('device').notNull(),
    createdAt: integer('createdAt').notNull(),
    lastPushedAt: integer('lastPushedAt'),
  },
  (t) => [index('push_subscription_user_idx').on(t.userId)],
)

/** Small site-wide facts, such as the Telegram bot's username and webhook fingerprint. */
export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updatedAt').notNull(),
})

export const contacts = sqliteTable(
  'contact',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phoneEnc: text('phoneEnc'),
    notesEnc: text('notesEnc'),
    timezone: text('timezone').notNull(),
    signalStatus: text('signalStatus').$type<SignalStatus>().notNull().default('unknown'),
    consent: text('consent').$type<ConsentState>().notNull().default('not_asked'),
    consentUpdatedAt: integer('consentUpdatedAt').notNull(),
    stoppedByRecipient: integer('stoppedByRecipient', { mode: 'boolean' }).notNull().default(false),
    minDaysBetween: integer('minDaysBetween').notNull().default(7),
    maxPer30Days: integer('maxPer30Days').notNull().default(4),
    windowStart: integer('windowStart').notNull().default(540),
    windowEnd: integer('windowEnd').notNull().default(1200),
    allowedDays: integer('allowedDays').notNull().default(127),
    // Their own Bible translation; null means the sender's default.
    translation: text('translation').$type<Translation>(),
    stopToken: text('stopToken').notNull().unique(),
    archivedAt: integer('archivedAt'),
    createdAt: integer('createdAt').notNull(),
    updatedAt: integer('updatedAt').notNull(),
  },
  (t) => [index('contact_user_idx').on(t.userId)],
)

export const contactTopics = sqliteTable(
  'contact_topic',
  {
    contactId: text('contactId')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    weight: integer('weight').notNull().default(2),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.topic] })],
)

export const messages = sqliteTable(
  'message',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactId: text('contactId')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<MessageKind>().notNull(),
    contentId: text('contentId'),
    body: text('body').notNull(),
    status: text('status').$type<MessageStatus>().notNull().default('scheduled'),
    scheduledFor: integer('scheduledFor').notNull(),
    remindedAt: integer('remindedAt'),
    sentAt: integer('sentAt'),
    createdAt: integer('createdAt').notNull(),
    updatedAt: integer('updatedAt').notNull(),
  },
  (t) => [
    index('message_due_idx').on(t.status, t.scheduledFor),
    index('message_contact_idx').on(t.contactId, t.sentAt),
    index('message_user_idx').on(t.userId, t.status),
  ],
)

export const consentEvents = sqliteTable(
  'consent_event',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactId: text('contactId')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    from: text('from').$type<ConsentState>().notNull(),
    to: text('to').$type<ConsentState>().notNull(),
    by: text('by').$type<'you' | 'recipient'>().notNull(),
    at: integer('at').notNull(),
  },
  (t) => [index('consent_event_contact_idx').on(t.contactId, t.at)],
)

export const rateLimits = sqliteTable('rate_limit', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: integer('resetAt').notNull(),
})

export type Contact = typeof contacts.$inferSelect
export type Message = typeof messages.$inferSelect
export type UserSettings = typeof userSettings.$inferSelect

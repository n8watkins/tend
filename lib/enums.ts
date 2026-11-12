/** Enumerations shared by the schema, the server and client components (no database imports). */

export const SIGNAL_STATUSES = ['unknown', 'on_signal', 'invited', 'not_on_signal'] as const
export type SignalStatus = (typeof SIGNAL_STATUSES)[number]

export const CONSENT_STATES = ['not_asked', 'asked', 'yes', 'no', 'stopped'] as const
export type ConsentState = (typeof CONSENT_STATES)[number]

export const MESSAGE_KINDS = ['content', 'consent_request', 'personal'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export const MESSAGE_STATUSES = ['scheduled', 'sent', 'skipped', 'canceled'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

// Public-domain translations, full text in content/library.json (docs/TRANSLATIONS.md).
export const TRANSLATIONS = ['web', 'webbe', 'kjv', 'asv', 'bsb', 'bbe', 'darby', 'dra'] as const
export type Translation = (typeof TRANSLATIONS)[number]

/* Signal helper (docs/SIGNAL-HELPER.md) ------------------------------------- */

// Whether a message waits for the user's go-ahead before the helper may send it.
export const APPROVAL_STATES = ['none', 'pending', 'approved', 'skipped', 'expired'] as const
export type ApprovalState = (typeof APPROVAL_STATES)[number]

// The helper's send of an approved message: at most once, never twice (SIGNAL-HELPER.md 2.4).
export const SEND_STATES = ['idle', 'sending', 'sent', 'failed', 'unknown'] as const
export type SendState = (typeof SEND_STATES)[number]

export const SENT_VIA = ['you', 'helper'] as const
export type SentVia = (typeof SENT_VIA)[number]

export const APPROVED_VIA = ['app', 'push'] as const
export type ApprovedVia = (typeof APPROVED_VIA)[number]

export const HELPER_EVENT_KINDS = [
  'paired',
  'removed',
  'approved',
  'skipped',
  'claimed',
  'refused',
  'sent',
  'failed',
  'unknown',
  'expired',
  'challenge',
  'resumed',
  'outdated',
  'unlinked',
] as const
export type HelperEventKind = (typeof HELPER_EVENT_KINDS)[number]

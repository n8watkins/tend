/** Enumerations shared by the schema, the server and client components (no database imports). */

export const SIGNAL_STATUSES = ['unknown', 'on_signal', 'invited', 'not_on_signal'] as const
export type SignalStatus = (typeof SIGNAL_STATUSES)[number]

export const CONSENT_STATES = ['not_asked', 'asked', 'yes', 'no', 'stopped'] as const
export type ConsentState = (typeof CONSENT_STATES)[number]

export const MESSAGE_KINDS = ['content', 'consent_request', 'personal'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]

export const MESSAGE_STATUSES = ['scheduled', 'sent', 'skipped', 'canceled'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

export const TRANSLATIONS = ['web', 'kjv'] as const
export type Translation = (typeof TRANSLATIONS)[number]

import { describe, expect, it } from 'vitest'

import { smsShareUrl, telegramShareUrl, whatsappShareUrl } from '@/lib/share'
import { isCommand, parseCallback, parseStart, reminderKeyboard, reminderText, TELEGRAM_TEXT_MAX } from '@/lib/telegram'

const item = { id: '0f8c3a52-1b2c-4d5e-8f90-123456789abc', contactName: 'Sam', kind: 'content', body: 'Thinking of you & yours.\n- Psalm 23:1 (WEB)' }

describe('share links', () => {
  it('encode the whole message for each app', () => {
    const encoded = encodeURIComponent(item.body)
    expect(whatsappShareUrl(item.body)).toBe(`https://wa.me/?text=${encoded}`)
    expect(smsShareUrl(item.body)).toBe(`sms:?&body=${encoded}`)
    expect(telegramShareUrl(item.body)).toBe(`https://t.me/share/url?url=${encoded}`)
  })
})

describe('reminder messages', () => {
  it('carry the prepared message and say who it is for', () => {
    const text = reminderText(item)
    expect(text.startsWith('Time to message Sam.')).toBe(true)
    expect(text).toContain(item.body)
    expect(reminderText({ ...item, kind: 'consent_request' }).startsWith('Time to ask Sam.')).toBe(true)
  })

  it('stay within Telegram’s length limit', () => {
    expect(reminderText({ ...item, body: 'x'.repeat(10_000) }).length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX)
  })

  it('have Share and Open links, and I sent it and Snooze buttons that fit Telegram’s 64 bytes', () => {
    const [links, actions] = reminderKeyboard(item, 'https://tend.n8builds.dev/send/x')
    expect(links).toEqual([
      { text: 'Share', url: telegramShareUrl(item.body) },
      { text: 'Open in Tend', url: 'https://tend.n8builds.dev/send/x' },
    ])
    expect(actions).toEqual([
      { text: 'I sent it', callback_data: `sent:${item.id}` },
      { text: 'Snooze a day', callback_data: `snooze:${item.id}` },
    ])
    for (const b of actions!) expect(new TextEncoder().encode((b as { callback_data: string }).callback_data).length).toBeLessThanOrEqual(64)
  })

  it('drop the Share link when the message is too long for a button', () => {
    const [links] = reminderKeyboard({ ...item, body: 'y'.repeat(3000) }, 'https://tend.n8builds.dev/send/x')
    expect(links!.map((b) => b.text)).toEqual(['Open in Tend'])
  })
})

describe('bot input', () => {
  it('reads /start codes', () => {
    expect(parseStart('/start abc_DEF-123')).toBe('abc_DEF-123')
    expect(parseStart('/start@TendBot abc')).toBe('abc')
    expect(parseStart('/start')).toBe('')
    expect(parseStart('/start bad code!')).toBeNull()
    expect(parseStart('hello')).toBeNull()
    expect(parseStart(undefined)).toBeNull()
  })

  it('knows /stop', () => {
    expect(isCommand('/stop', 'stop')).toBe(true)
    expect(isCommand(' /stop@TendBot ', 'stop')).toBe(true)
    expect(isCommand('/stopnow', 'stop')).toBe(false)
  })

  it('reads button presses and refuses anything else', () => {
    expect(parseCallback(`sent:${item.id}`)).toEqual({ action: 'sent', messageId: item.id })
    expect(parseCallback(`snooze:${item.id}`)).toEqual({ action: 'snooze', messageId: item.id })
    expect(parseCallback('delete:abc')).toBeNull()
    expect(parseCallback('sent:../../x')).toBeNull()
    expect(parseCallback(undefined)).toBeNull()
  })
})

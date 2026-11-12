import { describe, expect, it } from 'vitest'

import { allowedEndpoint, deviceLabel, reminderPush } from '@/lib/push'

describe('push endpoints', () => {
  const prod = { APP_ENV: 'production' }

  it('allow only https addresses at the browsers’ push services', () => {
    expect(allowedEndpoint('https://fcm.googleapis.com/fcm/send/abc:def', prod)).toBe(true)
    expect(allowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc', prod)).toBe(true)
    expect(allowedEndpoint('https://web.push.apple.com/QGx', prod)).toBe(true)
    expect(allowedEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x', prod)).toBe(true)
    expect(allowedEndpoint('http://fcm.googleapis.com/fcm/send/abc', prod)).toBe(false)
    expect(allowedEndpoint('https://fcm.googleapis.com:8443/fcm/send/abc', prod)).toBe(false)
    expect(allowedEndpoint('https://evilfcm.googleapis.com.example.com/x', prod)).toBe(false)
    expect(allowedEndpoint('https://notfcm.googleapis.com/x', prod)).toBe(false)
    expect(allowedEndpoint('https://user:pw@fcm.googleapis.com/x', prod)).toBe(false)
    expect(allowedEndpoint('https://127.0.0.1/x', prod)).toBe(false)
    expect(allowedEndpoint('not a url', prod)).toBe(false)
    expect(allowedEndpoint(`https://fcm.googleapis.com/${'x'.repeat(1100)}`, prod)).toBe(false)
  })

  it('allow the local push mock in the test environment only', () => {
    const base = 'http://localhost:7843/push'
    expect(allowedEndpoint(`${base}/a`, { APP_ENV: 'test', PUSH_TEST_BASE: base })).toBe(true)
    expect(allowedEndpoint(`${base}/a`, { APP_ENV: 'production', PUSH_TEST_BASE: base })).toBe(false)
    expect(allowedEndpoint('http://localhost:9999/a', { APP_ENV: 'test', PUSH_TEST_BASE: base })).toBe(false)
  })
})

describe('reminder notifications', () => {
  it('open the send screen for one message', () => {
    expect(reminderPush([{ id: 'm1', contactName: 'Sam', kind: 'content' }])).toEqual({
      title: 'Time to message Sam',
      body: 'Your message is ready. Open it, copy it, and send it on Signal.',
      url: '/send/m1',
      tag: 'tend-reminder',
    })
    expect(reminderPush([{ id: 'm1', contactName: 'Sam', kind: 'consent_request' }]).title).toBe('Time to ask Sam')
  })

  it('open Today for several, naming who they are for', () => {
    const two = reminderPush([
      { id: 'a', contactName: 'Sam', kind: 'content' },
      { id: 'b', contactName: 'Mum', kind: 'content' },
    ])
    expect(two).toMatchObject({ title: '2 messages are ready to send', body: 'For Sam and Mum. Open Tend to send them on Signal.', url: '/today' })
    const five = reminderPush(['A', 'B', 'C', 'D', 'E'].map((n) => ({ id: n, contactName: n, kind: 'content' })))
    expect(five.body).toBe('For A, B, C and 2 more. Open Tend to send them on Signal.')
  })
})

describe('device labels', () => {
  it('name the browser and system', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')).toBe(
      'Chrome on Android',
    )
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe(
      'Safari on iPhone',
    )
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toBe(
      'Edge on Windows',
    )
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.1; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe('Firefox on Mac')
    expect(deviceLabel('')).toBe('A browser')
  })
})

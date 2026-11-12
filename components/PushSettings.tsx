'use client'

import { useEffect, useId, useState } from 'react'

import { removeOtherPushSubscriptions, removePushSubscription, savePushSubscription, sendTestPush } from '@/app/(app)/actions'
import { isIos, isStandalone } from '@/lib/pwa-client'

type Status = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on'

export interface PushDevice {
  endpoint: string
  device: string
}

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4))
  return Uint8Array.from(text, (c) => c.charCodeAt(0))
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? null
}

/**
 * "Phone notifications" in Settings, for this device: asks permission,
 * subscribes with Tend's VAPID key and stores the subscription; off removes
 * it. On iPhone and iPad, Web Push works only in the installed app.
 */
export function PushSettings({ publicKey, devices }: { publicKey: string; devices: PushDevice[] }) {
  const [status, setStatus] = useState<Status>('loading')
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null)
  const labelId = useId()
  const hintId = useId()

  useEffect(() => {
    let live = true
    ;(async () => {
      let next: Status
      if (isIos() && !isStandalone()) next = 'ios-install'
      else if (!supported()) next = 'unsupported'
      else {
        const sub = await (await registration())?.pushManager.getSubscription()
        // On only when this browser is subscribed and Tend still has it (it
        // may have been turned off from another device, or expired).
        const known = Boolean(sub && devices.some((d) => d.endpoint === sub.endpoint))
        if (live) setEndpoint(known ? sub!.endpoint : null)
        next = known ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off'
      }
      if (live) setStatus(next)
    })().catch(() => live && setStatus('unsupported'))
    return () => {
      live = false
    }
  }, [devices])

  async function turnOn() {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      setStatus(permission === 'denied' ? 'denied' : 'off')
      return
    }
    const reg = (await registration()) ?? (await navigator.serviceWorker.ready)
    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
    const saved = await savePushSubscription(sub.toJSON())
    if (!saved.ok) {
      await sub.unsubscribe().catch(() => {})
      setMessage({ tone: 'warn', text: saved.error ?? 'Notifications could not be turned on.' })
      return
    }
    setEndpoint(sub.endpoint)
    setStatus('on')
    setMessage({ tone: 'good', text: 'Notifications are on for this device.' })
  }

  async function turnOff() {
    const sub = await (await registration())?.pushManager.getSubscription()
    const target = sub?.endpoint ?? endpoint
    if (target) await removePushSubscription(target)
    await sub?.unsubscribe().catch(() => {})
    setEndpoint(null)
    setStatus('off')
    setMessage(null)
  }

  async function toggle() {
    setBusy(true)
    setMessage(null)
    try {
      await (status === 'on' ? turnOff() : turnOn())
    } catch {
      setMessage({ tone: 'warn', text: 'Something went wrong. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    const sent = await sendTestPush().catch(() => ({ ok: false, error: 'Something went wrong. Please try again.' }))
    setMessage(sent.ok ? { tone: 'good', text: 'Sent. It should arrive in a few seconds.' } : { tone: 'warn', text: sent.error ?? 'Not sent.' })
    setBusy(false)
  }

  const others = devices.filter((d) => d.endpoint !== endpoint)
  const on = status === 'on'
  const disabled = busy || status === 'loading' || status === 'unsupported' || status === 'ios-install'

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={labelId} className="min-w-0 cursor-pointer">
          <span className="block font-semibold">Phone notifications</span>
          <span id={hintId} className="hint block">
            A notification on this device when a message is ready to send. Tap it to open the message.
          </span>
        </label>
        <button
          id={labelId}
          type="button"
          role="switch"
          aria-checked={on}
          aria-describedby={hintId}
          disabled={disabled}
          onClick={toggle}
          className="switch mt-0.5"
        />
      </div>

      {status === 'ios-install' ? (
        <p className="notice notice-warn">
          On iPhone and iPad, notifications work only once Tend is on your Home Screen. Add it (see Install Tend above), open Tend from your Home Screen, then turn
          this on.
        </p>
      ) : null}
      {status === 'denied' ? (
        <p className="notice notice-warn">Notifications are blocked for Tend in this browser. Allow them in the site settings (the icon next to the address), then turn this on.</p>
      ) : null}
      {status === 'unsupported' ? <p className="hint">This browser cannot show notifications. Try Chrome on Android, or Safari on iPhone with Tend on your Home Screen.</p> : null}

      {message ? (
        <p role="status" className={`notice ${message.tone === 'good' ? 'notice-good' : 'notice-warn'}`}>
          {message.text}
        </p>
      ) : null}

      {on ? (
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={test}>
          Send a test notification
        </button>
      ) : null}

      {others.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="hint">Also on for {others.map((d) => d.device).join(', ')}.</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await removeOtherPushSubscriptions(endpoint ?? '')
              setBusy(false)
            }}
          >
            {endpoint ? 'Turn off on other devices' : 'Turn off on all devices'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

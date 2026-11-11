import { beforeEach, describe, expect, it, vi } from 'vitest'

import { scheduledReminders } from '../worker/cron'

const setCronMailroom = vi.hoisted(() => vi.fn())
vi.mock('../lib/server/email', () => ({ setCronMailroom }))
vi.mock('../lib/server/reminder-cron', () => ({ runReminderCron: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('scheduledReminders', () => {
  it('hands the mailroom binding to the email code, then runs the reminder code directly', async () => {
    const mailroom = { send: vi.fn() }
    const run = vi.fn().mockResolvedValue({ emailed: 1 })
    await scheduledReminders({ MAILROOM: mailroom }, run)
    expect(setCronMailroom).toHaveBeenCalledWith(mailroom)
    expect(run).toHaveBeenCalledTimes(1)
    expect(setCronMailroom.mock.invocationCallOrder[0]!).toBeLessThan(run.mock.invocationCallOrder[0]!)
  })

  it('lets a failed run fail the cron invocation', async () => {
    const run = vi.fn().mockRejectedValue(new Error('db down'))
    await expect(scheduledReminders({}, run)).rejects.toThrow('db down')
  })
})

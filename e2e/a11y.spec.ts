import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { addPerson, signIn, testEmail } from './helpers'

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ colorScheme, timezoneId: 'UTC' })

    test('public and signed-in pages have no WCAG A or AA violations', async ({ page }, info) => {
      const check = async (path: string) => {
        await page.goto(path)
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
        expect(results.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => `${n.target.join(" ")} ${n.any[0]?.message ?? ""}`).join("; ")}`)).toEqual([])
      }
      for (const path of ['/', '/signin', '/privacy', '/terms']) await check(path)

      await signIn(page, testEmail(info, `a11y-${colorScheme}`))
      const id = await addPerson(page, { name: 'Robin', consent: 'yes', topics: ['Joy'] })
      for (const path of ['/today', '/people', '/people/new', `/people/${id}`, `/people/${id}/edit`, `/compose?contact=${id}&kind=personal`, '/library', '/history', '/settings']) {
        await check(path)
      }
    })
  })
}

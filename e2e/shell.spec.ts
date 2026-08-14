import { expect, test } from '@playwright/test'

test('app shell renders and navigates', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await page.getByRole('link', { name: /Stats/ }).click()
  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible()
})

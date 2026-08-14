import { expect, test, type Page } from '@playwright/test'

/** Drive whatever the player shows until the session completes. */
async function driveSessionToCompletion(page: Page) {
  for (let i = 0; i < 300; i++) {
    if (await page.getByRole('heading', { name: 'Workout complete!' }).isVisible().catch(() => false)) return
    const done = page.getByRole('button', { name: 'Done ✓' })
    if (await done.isVisible().catch(() => false)) {
      await done.click()
      continue
    }
    const startNow = page.getByRole('button', { name: 'Start now →' })
    if (await startNow.isVisible().catch(() => false)) {
      await startNow.click()
      continue
    }
    const skip = page.getByRole('button', { name: 'Skip →' })
    if (await skip.isVisible().catch(() => false)) {
      await skip.click()
      continue
    }
    await page.waitForTimeout(150)
  }
  throw new Error('session did not complete within bounds')
}

test('golden path: duo workout from start to celebration', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: /Start duo workout/ }).click()
  await expect(page.getByText(/WARM-UP/i)).toBeVisible()

  // Duo target panels appear once we reach work; drive the whole session.
  await driveSessionToCompletion(page)

  await expect(page.getByRole('heading', { name: 'Workout complete!' })).toBeVisible()
  await expect(page.getByText(/\+\d+ XP/).first()).toBeVisible()
  await expect(page.getByText(/1-day streak/).first()).toBeVisible()
  await expect(page.getByText('Atul')).toBeVisible()
  await expect(page.getByText('Partner')).toBeVisible()

  await page.getByRole('button', { name: 'Back to Today' }).click()
  // A strength session marks the day as a WORKOUT, distinct from a recovery
  // session — the badge is what tells them whether the real session is done.
  await expect(page.getByText('Workout done ✓').first()).toBeVisible()
  // Real streak derivation drives the person cards.
  await expect(page.getByText('🔥 1').first()).toBeVisible()
})

test('feedback taps during a block transition are recorded', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: /Start duo workout/ }).click()

  // Skip warm-up (variable length): click Skip until the first work screen.
  for (let i = 0; i < 20; i++) {
    if (await page.getByRole('button', { name: 'Done ✓' }).isVisible().catch(() => false)) break
    const startNow = page.getByRole('button', { name: 'Start now →' })
    if (await startNow.isVisible().catch(() => false)) {
      await startNow.click()
      continue
    }
    await page.getByRole('button', { name: 'Skip →' }).click()
  }
  // Finish the first block (bounded loop until the feedback screen appears).
  for (let i = 0; i < 30; i++) {
    if (await page.getByText(/Block done!/).isVisible().catch(() => false)) break
    const done = page.getByRole('button', { name: 'Done ✓' })
    if (await done.isVisible().catch(() => false)) {
      await done.click()
      continue
    }
    const skip = page.getByRole('button', { name: 'Skip →' })
    if (await skip.isVisible().catch(() => false)) await skip.click()
    else await page.waitForTimeout(100)
  }
  await expect(page.getByText('How was that block?')).toBeVisible()
  await page.getByRole('button', { name: '😴' }).first().click()
  const stored = await page.evaluate(() => localStorage.getItem('fitduo.feedback.v1'))
  expect(stored).toContain('too_easy')
})

test('kill-safe: reload mid-session offers resume', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: /Start duo workout/ }).click()
  await expect(page.getByText(/WARM-UP/i)).toBeVisible()
  await page.getByRole('button', { name: 'Skip →' }).click()

  await page.reload()
  await page.goto('/workout')
  await expect(page.getByText('Resume your workout?')).toBeVisible()
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByText(/WARM-UP/i)).toBeVisible()
})

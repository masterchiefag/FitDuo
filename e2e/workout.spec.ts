import { expect, test } from '@playwright/test'

test('golden path: duo workout from start to celebration', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: /Start duo workout/ }).click()
  await expect(page.getByText(/WARM-UP/i)).toBeVisible()

  // Skip through all 7 warm-up items.
  for (let i = 0; i < 7; i++) {
    await page.getByRole('button', { name: 'Skip →' }).click()
  }
  // Block transition into Strength A -> start now.
  await expect(page.getByText(/Up next: Strength A/)).toBeVisible()
  await page.getByRole('button', { name: 'Start now →' }).click()

  // Round 1: squat (duo panels visible), then row.
  await expect(page.getByRole('heading', { name: 'Dumbbell Squat' })).toBeVisible()
  await expect(page.getByText('Atul')).toBeVisible()
  await expect(page.getByText('Partner')).toBeVisible()
  await page.getByRole('button', { name: 'Done ✓' }).click()
  await expect(page.getByRole('heading', { name: 'Bent-Over Row' })).toBeVisible()
  await page.getByRole('button', { name: 'Done ✓' }).click()

  // Rest screen with next-up preview; skip it.
  await expect(page.getByText('Rest', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Skip →' }).click()

  // Rounds 2 and 3.
  for (let round = 1; round < 3; round++) {
    await page.getByRole('button', { name: 'Done ✓' }).click()
    await page.getByRole('button', { name: 'Done ✓' }).click()
    const rest = page.getByRole('button', { name: 'Skip →' })
    if (await rest.isVisible().catch(() => false)) await rest.click()
  }

  // Block transition: give feedback for both people on one exercise.
  await expect(page.getByText(/Block done!/)).toBeVisible()
  const easyButtons = page.getByRole('button', { name: '😴' })
  await easyButtons.first().click()
  await page.getByRole('button', { name: 'Start now →' }).click()

  // Fast-path the rest of the session: blocks B, C (3 rounds × 2 items each) and finisher (2 × 3).
  for (let block = 0; block < 2; block++) {
    for (let round = 0; round < 3; round++) {
      await page.getByRole('button', { name: 'Done ✓' }).click()
      await page.getByRole('button', { name: 'Done ✓' }).click()
      const skip = page.getByRole('button', { name: 'Skip →' })
      if (await skip.isVisible().catch(() => false)) await skip.click()
    }
    await page.getByRole('button', { name: 'Start now →' }).click()
  }
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Done ✓' }).click()
    const skip = page.getByRole('button', { name: 'Skip →' })
    if (await skip.isVisible().catch(() => false)) await skip.click()
  }

  // Cool-down: 5 stretches.
  await expect(page.getByText(/COOL-DOWN/i)).toBeVisible()
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Skip →' }).click()
  }

  // Celebration: both people, XP, streak.
  await expect(page.getByRole('heading', { name: 'Workout complete!' })).toBeVisible()
  await expect(page.getByText(/\+\d+ XP/).first()).toBeVisible()
  await expect(page.getByText(/1-day streak/).first()).toBeVisible()

  // Back home: both marked done today with a live streak.
  await page.getByRole('button', { name: 'Back to Today' }).click()
  await expect(page.getByText('Done today ✓').first()).toBeVisible()
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

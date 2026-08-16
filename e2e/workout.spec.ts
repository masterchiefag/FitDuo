import { expect, test, type Page } from '@playwright/test'

/**
 * Drive whatever the player shows until the session completes.
 *
 * The real session is hands-off — every phase ends on its own clock — but a
 * smoke test cannot sit through 55 minutes of real timers, so it finishes each
 * set early with Done and skips each wait. The block gate is the one thing it
 * genuinely has to answer, which is the point of the gate.
 */
async function driveSessionToCompletion(page: Page) {
  for (let i = 0; i < 300; i++) {
    if (await page.getByRole('heading', { name: 'Workout complete!' }).isVisible().catch(() => false)) return
    const cont = page.getByRole('button', { name: 'Continue →' })
    if (await cont.isVisible().catch(() => false)) {
      await cont.click()
      continue
    }
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
    const ready = page.getByRole('button', { name: /I.m ready/ })
    if (await ready.isVisible().catch(() => false)) {
      await ready.click()
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

/** Advance until the first work screen of the session. */
async function reachFirstSet(page: Page) {
  for (let i = 0; i < 20; i++) {
    if (await page.getByRole('button', { name: 'Done ✓' }).isVisible().catch(() => false)) return
    const startNow = page.getByRole('button', { name: 'Start now →' })
    if (await startNow.isVisible().catch(() => false)) {
      await startNow.click()
      continue
    }
    await page.getByRole('button', { name: 'Skip →' }).click()
  }
  throw new Error('never reached a work phase')
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
  // One card per participant, asserted by structure. Real names live in
  // gitignored profiles.local.json (CLAUDE.md — the remote is public), so
  // asserting them both leaks a name and makes the suite pass or fail on
  // whether that file happens to exist in the checkout.
  await expect(page.getByText(/\d+\/\d+ sets/)).toHaveCount(2)

  await page.getByRole('button', { name: 'Back to Today' }).click()
  // A strength session marks the day as a WORKOUT, distinct from a recovery
  // session — the badge is what tells them whether the real session is done.
  await expect(page.getByText('Workout done ✓').first()).toBeVisible()
  // Real streak derivation drives the person cards.
  await expect(page.getByText('🔥 1').first()).toBeVisible()
})

test('a set runs on its own clock and logs itself when it expires', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  // 20 minutes: the same engine at a smaller budget, and a shorter warm-up to
  // walk through.
  await page.getByRole('button', { name: '20 min' }).first().click()
  await page.getByRole('button', { name: /Start duo workout/ }).click()
  await reachFirstSet(page)

  // The set is counting down — nobody has to press anything for it to end.
  const countdown = page.locator('svg circle').first()
  await expect(countdown).toBeVisible()
  await expect(page.getByRole('button', { name: 'Done ✓' })).toBeVisible()

  // Finish this one early so the assertion does not wait out a real set, then
  // check what got written: the app called the reps, so the log says so.
  await page.getByRole('button', { name: 'Done ✓' }).click()
  const logs = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('fitduo.setlogs.v1') ?? '[]'),
  )
  expect(logs.length).toBeGreaterThan(0)
  expect(logs[0].assumed).toBe(true)
  expect(logs[0].actualReps).toBe(logs[0].targetReps)
})

test('an adjustment is logged for that set and does not leak to the next', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '20 min' }).first().click()
  await page.getByRole('button', { name: /Start duo workout/ }).click()
  await reachFirstSet(page)

  // Drop the first person's reps by one, then finish the set.
  await page.getByRole('button', { name: '−' }).first().click()
  await page.getByRole('button', { name: 'Done ✓' }).click()

  const first = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('fitduo.setlogs.v1') ?? '[]'),
  )
  expect(first[0].actualReps).toBe(first[0].targetReps - 1)
  expect(first[0].assumed).toBe(false)
  // The partner, untouched, is still an assumed log at their own target.
  expect(first[1].assumed).toBe(true)

  // Next exercise: back to the prescribed target for everyone.
  await page.getByRole('button', { name: /I.m ready/ }).click() // through the changeover
  await expect(page.getByRole('button', { name: 'Done ✓' })).toBeVisible()
  await page.getByRole('button', { name: 'Done ✓' }).click()
  const second = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('fitduo.setlogs.v1') ?? '[]'),
  )
  expect(second.length).toBe(4)
  expect(second[2].actualReps).toBe(second[2].targetReps)
  expect(second.slice(2).every((l: { assumed: boolean }) => l.assumed)).toBe(true)
})

test('the block gate records a rating, and assumes "right" for the rest', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: '20 min' }).first().click()
  await page.getByRole('button', { name: /Start duo workout/ }).click()
  await reachFirstSet(page)

  // Finish the first block (bounded loop until the gate appears).
  for (let i = 0; i < 40; i++) {
    if (await page.getByRole('button', { name: 'Continue →' }).isVisible().catch(() => false)) break
    const done = page.getByRole('button', { name: 'Done ✓' })
    if (await done.isVisible().catch(() => false)) {
      await done.click()
      continue
    }
    const ready = page.getByRole('button', { name: /I.m ready/ })
    if (await ready.isVisible().catch(() => false)) {
      await ready.click()
      continue
    }
    const skip = page.getByRole('button', { name: 'Skip →' })
    if (await skip.isVisible().catch(() => false)) await skip.click()
    else await page.waitForTimeout(100)
  }
  await expect(page.getByText(/How was that\?/)).toBeVisible()
  await page.getByRole('button', { name: '😴' }).first().click()
  await page.getByRole('button', { name: 'Continue →' }).click()

  const feedback = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('fitduo.feedback.v1') ?? '[]'),
  )
  // The tapped rating survives; everyone else in the block is recorded 'right'.
  expect(feedback.filter((f: { rating: string }) => f.rating === 'too_easy')).toHaveLength(1)
  expect(feedback.filter((f: { rating: string }) => f.rating === 'right').length).toBeGreaterThan(0)
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

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

/**
 * Get past the opening ritual — the day, its shape and today's targets, which
 * every session now starts with (R6c) and which holds until somebody taps.
 */
async function passOpening(page: Page) {
  await page.getByRole('button', { name: /^Start (warm-up|→)/ }).click()
}

/** Advance until the first work screen of the session. */
async function reachFirstSet(page: Page) {
  await passOpening(page)
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
  // The opening names the day and its shape before anything starts. Asserted
  // structurally: the day type rotates with the date, and the target panels
  // carry names from gitignored profiles (CLAUDE.md — the remote is public),
  // so what is checked is that each person got one.
  await expect(page.getByText(/blocks · \d+ sets each · about \d+ min/)).toBeVisible()
  await expect(page.getByText(/to have out|nothing to pick up/)).toHaveCount(2)
  await passOpening(page)
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
  await passOpening(page)
  await expect(page.getByText(/WARM-UP/i)).toBeVisible()
  await page.getByRole('button', { name: 'Skip →' }).click()

  await page.reload()
  await page.goto('/workout')
  await expect(page.getByText('Resume your workout?')).toBeVisible()
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByText(/WARM-UP/i)).toBeVisible()
})

/**
 * The opening loads a plan and writes nothing, so leaving it by the nav — a
 * permanent sidebar on the laptop, and far more reachable than "Not now" — must
 * not strand that plan in the store, where it would shadow the snapshot the
 * Today banner is offering and make the unfinished session unreachable (Grok,
 * PR #40).
 */
test('an unfinished session survives someone opening today and changing their mind', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  // Leave a real session unfinished.
  await page.getByRole('button', { name: /Start duo workout/ }).click()
  await passOpening(page)
  await expect(page.getByText(/WARM-UP/i)).toBeVisible()
  await page.getByRole('button', { name: 'Skip →' }).click()
  await page.getByRole('link', { name: /Today/ }).click()
  await expect(page.getByText('Unfinished session')).toBeVisible()

  // Start something new, then back out by the nav rather than by "Not now".
  await page.getByRole('button', { name: /Start duo workout/ }).click()
  await expect(page.getByText(/sets each · about \d+ min/)).toBeVisible()
  await page.getByRole('link', { name: /Today/ }).click()

  // The banner is still true, and Resume opens the session it names.
  await expect(page.getByText('Unfinished session')).toBeVisible()
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByText(/WARM-UP/i)).toBeVisible()
})

test('a mobility session opens on what it works, and on the kit it needs', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: /Posture & Shoulders/ }).click()

  // A mobility plan carries a placeholder dayType to satisfy the shared plan
  // shape, so the one thing this opening must not say is "Full Body". It names
  // the regions the chosen stretches actually address instead.
  await expect(page.getByText('Mobility & relief').first()).toBeVisible()
  await expect(page.getByText(/phases · about \d+ min/)).toBeVisible()
  // This used to assert the opposite — no kit panel, no weight talk anywhere,
  // on the reasoning that relief days have no loads. PR #41 gave Activate real
  // sets on a band, so the panel has to say what to fetch; suppressing it hid
  // the one piece of kit the session needs until the third phase.
  // The example profile owns no bands — deliberately, since prescribing a band
  // nobody owns is the worse failure (content/profiles.example.json) — so this
  // relief session has nothing to fetch and the panel stays away. What must
  // never come back is the old blanket rule: the panel is suppressed by an
  // empty kit, not by the mode, or the day a band IS owned the person finds
  // out at the third phase. The kit line itself is covered against real band
  // movements in tests/resistance.test.ts.
  await expect(page.getByText(/to have out/)).toHaveCount(0)
  // Never the force a colour pulls: "1.7 kg" is not a thing anyone picks up.
  await expect(page.getByText(/1\.7 kg|0\.9 kg|2\.7 kg/)).toHaveCount(0)
  // And the line must not deny load on a session that now progresses band work.
  await expect(page.getByText(/No loads today|Nothing to hit/)).toHaveCount(0)

  await passOpening(page)
  await expect(page.getByText(/Mobilise/i).first()).toBeVisible()
})

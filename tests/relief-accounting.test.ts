import { describe, expect, it } from 'vitest'
import { deriveProgression, deriveStats } from '../src/core/gamification/derive'

/**
 * `db-reverse-fly` is a `pull_h` main AND an Activate movement, and it is not
 * the only one. Pooling both into one progression lets Sunday's 2.5 kg cuff
 * work set Monday's rear-delt prescription: the strength day opens at a rehab
 * weight and "progresses" downwards from there.
 *
 * This is also what keeps `generator/types.ts` literally true when it says
 * recovery days do not drive progression — they drive their own, never
 * strength's.
 */
describe('relief work and strength work progress on separate tracks', () => {
  const SHARED = 'db-reverse-fly'
  const strengthSession = {
    dateISO: '2026-08-24' as const,
    mode: 'full' as const,
    completed: true,
    participantIds: ['p1'],
    startedAt: Date.UTC(2026, 7, 24, 9, 0),
    endedAt: Date.UTC(2026, 7, 24, 10, 0),
  }
  const reliefSession = {
    dateISO: '2026-08-25' as const,
    mode: 'mobility' as const,
    completed: true,
    participantIds: ['p1'],
    startedAt: Date.UTC(2026, 7, 25, 9, 0),
    endedAt: Date.UTC(2026, 7, 25, 9, 20),
  }
  const set = (at: number, weight: number, reps: number) => ({
    userId: 'p1',
    exerciseId: SHARED,
    targetReps: reps,
    actualReps: reps,
    weight,
    loggedAt: at,
  })
  const sessions = [strengthSession, reliefSession]
  const sets = [
    set(Date.UTC(2026, 7, 24, 9, 30), 10, 12),
    set(Date.UTC(2026, 7, 25, 9, 10), 2.5, 15),
  ]

  it('the strength track never reads a set logged in a relief session', () => {
    const strength = deriveProgression('p1', sessions, sets, [], 'strength')
    expect(strength[SHARED]?.lastWeight).toBe(10)
  })

  it('the relief track never reads a set logged in a strength session', () => {
    const relief = deriveProgression('p1', sessions, sets, [], 'relief')
    expect(relief[SHARED]?.lastWeight).toBe(2.5)
  })

  /** History from before the split is strength work, and stays where it was. */
  it('keeps unassigned history on the strength track', () => {
    const orphan = [set(Date.UTC(2026, 6, 1, 9, 0), 7.5, 10)]
    expect(deriveProgression('p1', sessions, orphan, [], 'strength')[SHARED]?.lastWeight).toBe(7.5)
    expect(deriveProgression('p1', sessions, orphan, [], 'relief')[SHARED]).toBeUndefined()
  })
})

/**
 * A relief session logs sets now, and sets are what strength accounting counts.
 * Left alone, cuff work would raise lifetime tonnage toward the Ten Tons
 * achievement and set "personal records" at 2.5 kg.
 *
 * The line is the one `sessionsCompleted` already drew, with the reason already
 * written beside it: recovery work is real, and it is not a workout milestone.
 * What a relief session DOES keep is its own celebration card — "120 kg moved"
 * is a true statement about that session — and the streak, which recovery has
 * always fed.
 */
describe('relief work stays out of strength accounting', () => {
  const person = ['p1']
  const day = (h: number) => Date.UTC(2026, 7, 25, h, 0)
  const sessions = [
    {
      dateISO: '2026-08-25' as const,
      mode: 'mobility' as const,
      completed: true,
      participantIds: person,
      startedAt: day(9),
      endedAt: day(10),
    },
  ]
  const sets = [
    {
      userId: 'p1',
      exerciseId: 'db-reverse-fly',
      targetReps: 12,
      actualReps: 12,
      weight: 5,
      loggedAt: day(9) + 60_000,
      assumed: false,
    },
  ]
  const SCHEDULE = [true, true, true, true, true, false, false]

  it('does not add to lifetime tonnage', () => {
    const stats = deriveStats('p1', sessions, sets, SCHEDULE, '2026-08-26')
    expect(stats.totalVolumeKg).toBe(0)
  })

  it('does not set a personal record', () => {
    const twice = [...sets, { ...sets[0]!, weight: 10, loggedAt: day(9) + 120_000 }]
    const stats = deriveStats('p1', sessions, twice, SCHEDULE, '2026-08-26')
    expect(stats.prCount).toBe(0)
  })

  it('still counts as a day trained', () => {
    const stats = deriveStats('p1', sessions, sets, SCHEDULE, '2026-08-26')
    expect(stats.streak).toBeGreaterThanOrEqual(1)
    // ...but never as a workout: `Regular` and `Veteran` are workout milestones.
    expect(stats.sessionsCompleted).toBe(0)
  })
})

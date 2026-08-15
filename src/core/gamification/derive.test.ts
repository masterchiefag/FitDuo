import { describe, expect, it } from 'vitest'
import {
  deriveProgression,
  deriveStats,
  levelFromXp,
  totalXpForLevel,
  type SessionEvent,
  type SetEvent,
} from './derive'
import type { SessionMode } from '../generator/types'

const U = 'p1'
const WEEKDAYS = [true, true, true, true, true, false, false] // Mon–Fri
const ALL_DAYS = [true, true, true, true, true, true, true]

// 2026-08-03 is a Monday.
const ms = (dateISO: string, hour = 18) =>
  Date.parse(`${dateISO}T${String(hour).padStart(2, '0')}:00:00`)

function session(
  dateISO: string,
  opts: { completed?: boolean; duo?: boolean; hour?: number; mode?: SessionMode } = {},
): SessionEvent {
  return {
    dateISO,
    mode: opts.mode ?? 'full',
    completed: opts.completed ?? true,
    participantIds: opts.duo ? [U, 'p2'] : [U],
    startedAt: ms(dateISO, opts.hour ?? 18),
  }
}

function setsFor(dateISO: string, count: number, weight = 10, reps = 10, target = 10): SetEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    userId: U,
    exerciseId: 'db-squat',
    targetReps: target,
    actualReps: reps,
    weight,
    loggedAt: ms(dateISO) + i * 60_000,
    assumed: false,
  }))
}

describe('levels', () => {
  it('curve anchors', () => {
    expect(totalXpForLevel(1)).toBe(0)
    expect(totalXpForLevel(2)).toBe(250)
    expect(levelFromXp(0)).toBe(1)
    expect(levelFromXp(249)).toBe(1)
    expect(levelFromXp(250)).toBe(2)
  })
})

describe('deriveStats', () => {
  it('single completed session: base + sets + full-clear XP, streak 1', () => {
    const stats = deriveStats(
      U,
      [session('2026-08-03')],
      setsFor('2026-08-03', 24),
      WEEKDAYS,
      '2026-08-03',
    )
    expect(stats.totalXp).toBe(50 + 48 + 25)
    expect(stats.streak).toBe(1)
    expect(stats.sessionsCompleted).toBe(1)
    expect(stats.achievements.map((a) => a.id)).toContain('first_workout')
  })

  it('rest days never break the streak', () => {
    // Mon–Fri completed, Sat+Sun rest, next Mon completed => streak 6.
    const days = [
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-10',
    ]
    const stats = deriveStats(
      U,
      days.map((d) => session(d)),
      [],
      WEEKDAYS,
      '2026-08-10',
    )
    expect(stats.streak).toBe(6)
  })

  it('one missed scheduled day per week is absorbed by the freeze', () => {
    // Missed Wed 08-05; freeze absorbs it; streak continues.
    const days = ['2026-08-03', '2026-08-04', '2026-08-06', '2026-08-07']
    const stats = deriveStats(
      U,
      days.map((d) => session(d)),
      [],
      WEEKDAYS,
      '2026-08-07',
    )
    expect(stats.streak).toBe(4)
  })

  it('a second miss in the same week resets the streak', () => {
    // Missed Wed AND Thu; second miss resets, Friday restarts at 1.
    const days = ['2026-08-03', '2026-08-04', '2026-08-07']
    const stats = deriveStats(
      U,
      days.map((d) => session(d)),
      [],
      WEEKDAYS,
      '2026-08-07',
    )
    expect(stats.streak).toBe(1)
  })

  it('bonus rest-day workout extends the streak', () => {
    // Fri + Sat (rest day) + Sun (rest day) => 3.
    const days = ['2026-08-07', '2026-08-08', '2026-08-09']
    const stats = deriveStats(
      U,
      days.map((d) => session(d)),
      [],
      WEEKDAYS,
      '2026-08-09',
    )
    expect(stats.streak).toBe(3)
  })

  it('7-day streak awards milestone bonus and On Fire', () => {
    const days = Array.from({ length: 7 }, (_, i) => `2026-08-${String(3 + i).padStart(2, '0')}`)
    const stats = deriveStats(
      U,
      days.map((d) => session(d)),
      [],
      ALL_DAYS,
      '2026-08-09',
    )
    expect(stats.streak).toBe(7)
    expect(stats.totalXp).toBe(7 * 50 + 50)
    expect(stats.achievements.map((a) => a.id)).toContain('week_streak')
  })

  it('abandoned sessions keep per-set XP but no streak', () => {
    const stats = deriveStats(
      U,
      [session('2026-08-03', { completed: false })],
      setsFor('2026-08-03', 5),
      WEEKDAYS,
      '2026-08-03',
    )
    expect(stats.totalXp).toBe(10)
    expect(stats.streak).toBe(0)
  })

  it('a recovery session pays the reduced rate, not a strength rate', () => {
    const stats = deriveStats(
      U,
      [session('2026-08-03', { mode: 'mobility' })],
      [],
      WEEKDAYS,
      '2026-08-03',
    )
    expect(stats.totalXp).toBe(20)
    expect(stats.streak).toBe(1) // showing up still counts
    expect(stats.sessionsCompleted).toBe(0) // ...but it is not a workout
  })

  it('mobility then strength on ONE day pays each session its own rate', () => {
    // The UI actively suggests this ("on its own or after a workout"), and a
    // date-keyed replay paid the whole day at whichever session came first.
    const morning: SessionEvent = {
      dateISO: '2026-08-03',
      mode: 'mobility',
      completed: true,
      participantIds: [U],
      startedAt: ms('2026-08-03', 8),
    }
    const evening: SessionEvent = {
      dateISO: '2026-08-03',
      mode: 'full',
      completed: true,
      participantIds: [U],
      startedAt: ms('2026-08-03', 18),
    }
    const strengthSets: SetEvent[] = Array.from({ length: 10 }, (_, i) => ({
      userId: U,
      exerciseId: 'db-squat',
      targetReps: 10,
      actualReps: 10,
      weight: 10,
      loggedAt: ms('2026-08-03', 18) + i * 60_000,
      assumed: false,
    }))
    const stats = deriveStats(U, [morning, evening], strengthSets, WEEKDAYS, '2026-08-03')
    // 20 (recovery) + 50 base + 2x10 sets + 25 full clear = 115
    expect(stats.totalXp).toBe(20 + 50 + 20 + 25)
    // Both sessions paid, but only the strength one is a "workout".
    expect(stats.sessionsCompleted).toBe(1)
    expect(stats.streak).toBe(1) // one calendar day, however many sessions
  })

  it('sets are credited to the session that produced them, not the day', () => {
    // Reversing the order must not move the strength sets onto the mobility
    // session (the failure mode Grok found).
    const mobilityLater: SessionEvent = {
      dateISO: '2026-08-03',
      mode: 'mobility',
      completed: true,
      participantIds: [U],
      startedAt: ms('2026-08-03', 20),
    }
    const strengthFirst: SessionEvent = {
      dateISO: '2026-08-03',
      mode: 'full',
      completed: true,
      participantIds: [U],
      startedAt: ms('2026-08-03', 7),
    }
    const sets: SetEvent[] = Array.from({ length: 10 }, (_, i) => ({
      userId: U,
      exerciseId: 'db-squat',
      targetReps: 10,
      actualReps: 10,
      weight: 10,
      loggedAt: ms('2026-08-03', 7) + i * 60_000,
      assumed: false,
    }))
    const stats = deriveStats(U, [strengthFirst, mobilityLater], sets, WEEKDAYS, '2026-08-03')
    expect(stats.totalXp).toBe(20 + 50 + 20 + 25)
  })

  it('two strength sessions in a day are paid separately, not pooled', () => {
    // The distinguishing case: crediting a day's sets to each session would
    // pay both sessions for all 10 sets. Only per-session bucketing gets this
    // right, and the mobility+strength case cannot detect the difference
    // (a mobility session has no sets).
    const mk = (hour: number): SessionEvent => ({
      dateISO: '2026-08-03',
      mode: 'full',
      completed: true,
      participantIds: [U],
      startedAt: ms('2026-08-03', hour),
    })
    const setsAt = (hour: number): SetEvent[] =>
      Array.from({ length: 5 }, (_, i) => ({
        userId: U,
        exerciseId: 'db-squat',
        targetReps: 10,
        actualReps: 10,
        weight: 10,
        loggedAt: ms('2026-08-03', hour) + i * 60_000,
        assumed: false,
      }))
    const stats = deriveStats(
      U,
      [mk(7), mk(18)],
      [...setsAt(7), ...setsAt(18)],
      WEEKDAYS,
      '2026-08-03',
    )
    // Each session: 50 base + 2x5 sets + 25 full clear = 85. Pooling would
    // charge each session for all 10 sets and yield 190.
    expect(stats.totalXp).toBe(85 + 85)
  })

  it('a session paused for hours still owns the sets logged after it resumes', () => {
    // Start 21:00, pause (lid closed), finish after 03:00. A fixed 6h window
    // from the start would orphan the later sets — 2 XP each and a full-clear
    // judged on the first hour only. endedAt is the real boundary.
    const overnight: SessionEvent = {
      dateISO: '2026-08-03',
      mode: 'full',
      completed: true,
      participantIds: [U],
      startedAt: ms('2026-08-03', 21),
      endedAt: Date.parse('2026-08-04T03:30:00'),
    }
    const sets: SetEvent[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        userId: U,
        exerciseId: 'db-squat',
        targetReps: 10,
        actualReps: 10,
        weight: 10,
        loggedAt: ms('2026-08-03', 21) + i * 60_000,
        assumed: false,
      })),
      // Resumed well past the old 6h cut-off.
      ...Array.from({ length: 4 }, (_, i) => ({
        userId: U,
        exerciseId: 'db-squat',
        targetReps: 10,
        actualReps: 10,
        weight: 10,
        loggedAt: Date.parse('2026-08-04T03:00:00') + i * 60_000,
        assumed: false,
      })),
    ]
    const stats = deriveStats(U, [overnight], sets, WEEKDAYS, '2026-08-04')
    // All 8 sets belong to the session: 50 + 2x8 + 25 full clear.
    expect(stats.totalXp).toBe(50 + 16 + 25)
  })

  it('a recovery day is not a workout day', () => {
    const stats = deriveStats(
      U,
      [session('2026-08-03', { mode: 'mobility' })],
      [],
      WEEKDAYS,
      '2026-08-03',
    )
    expect(stats.completedDates.has('2026-08-03')).toBe(true)
    expect(stats.workoutDates.has('2026-08-03')).toBe(false)
  })

  it('PRs add capped XP and unlock achievements', () => {
    // Two sessions; second improves e1rm on the same exercise (one PR).
    const sets = [...setsFor('2026-08-03', 3, 10, 10), ...setsFor('2026-08-04', 3, 12.5, 10, 10)]
    const sessions = [session('2026-08-03'), session('2026-08-04')]
    const stats = deriveStats(U, sessions, sets, ALL_DAYS, '2026-08-04')
    expect(stats.prCount).toBe(1)
    expect(stats.achievements.map((a) => a.id)).toContain('first_pr')
    // day2 XP includes +15 for the PR
    expect(stats.totalXp).toBe(50 + 6 + 25 + (50 + 6 + 25 + 15))
  })

  /**
   * The follow-along player logs sets nobody confirmed. Volume and XP are
   * honest for those — the app called the reps and they did them — but a
   * personal record has to be witnessed, or every hands-off session mints PRs
   * for weights that were never actually moved, forever ratcheting the target.
   *
   * MUTATION-CHECKED: dropping the `assumed` skip in the PR loop makes this
   * report 1 PR and pay the +15.
   */
  it('assumed sets earn XP and volume but can never set a PR', () => {
    const assume = (s: SetEvent): SetEvent => ({ ...s, assumed: true })
    const sets = [
      ...setsFor('2026-08-03', 3, 10, 10).map(assume),
      ...setsFor('2026-08-04', 3, 12.5, 10, 10).map(assume),
    ]
    const sessions = [session('2026-08-03'), session('2026-08-04')]
    const stats = deriveStats(U, sessions, sets, ALL_DAYS, '2026-08-04')
    expect(stats.prCount).toBe(0)
    expect(stats.achievements.map((a) => a.id)).not.toContain('first_pr')
    // Same two sessions as the PR test above, minus the +15.
    expect(stats.totalXp).toBe(50 + 6 + 25 + (50 + 6 + 25))
    expect(stats.totalVolumeKg).toBe(3 * 100 + 3 * 125)
  })

  it('corrected sets still set and beat records, assumed ones around them aside', () => {
    const sets = [
      // A witnessed 10 kg establishes the bar; the assumed sets beside it do not.
      ...setsFor('2026-08-03', 1, 10, 10),
      ...setsFor('2026-08-03', 2, 20, 10).map((s): SetEvent => ({ ...s, assumed: true })),
      // Someone tapped adjust the next day: this one was witnessed, and beats it.
      ...setsFor('2026-08-04', 1, 12.5, 10, 10),
    ]
    const stats = deriveStats(
      U,
      [session('2026-08-03'), session('2026-08-04')],
      sets,
      ALL_DAYS,
      '2026-08-04',
    )
    expect(stats.prCount).toBe(1)
  })

  it('a short session earns full streak credit at a smaller XP rate', () => {
    const short = deriveStats(
      U,
      [session('2026-08-03', { mode: 'short' })],
      setsFor('2026-08-03', 8),
      WEEKDAYS,
      '2026-08-03',
    )
    expect(short.totalXp).toBe(25 + 16 + 15)
    expect(short.streak).toBe(1)
    // It IS a workout — it counts for muscle-balance history and milestones,
    // which is exactly what separates it from a recovery session.
    expect(short.sessionsCompleted).toBe(1)
    expect(short.workoutDates.has('2026-08-03')).toBe(true)

    const full = deriveStats(
      U,
      [session('2026-08-03')],
      setsFor('2026-08-03', 8),
      WEEKDAYS,
      '2026-08-03',
    )
    expect(short.totalXp).toBeLessThan(full.totalXp)
  })

  it('perfect week and duo day unlock', () => {
    const days = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']
    const stats = deriveStats(
      U,
      days.map((d) => session(d, { duo: true })),
      [],
      WEEKDAYS,
      '2026-08-09',
    )
    const ids = stats.achievements.map((a) => a.id)
    expect(ids).toContain('perfect_week')
    expect(ids).toContain('duo_day')
  })

  it('early bird unlocks for pre-7am sessions', () => {
    const stats = deriveStats(U, [session('2026-08-03', { hour: 6 })], [], WEEKDAYS, '2026-08-03')
    expect(stats.achievements.map((a) => a.id)).toContain('early_bird')
  })

  it('comeback unlocks after a 7+ day gap', () => {
    const stats = deriveStats(
      U,
      [session('2026-08-03'), session('2026-08-14')],
      [],
      WEEKDAYS,
      '2026-08-14',
    )
    expect(stats.achievements.map((a) => a.id)).toContain('comeback')
  })
})

describe('deriveProgression', () => {
  const twoSessions = [session('2026-08-03'), session('2026-08-05')]

  it('captures last session targets, actuals, feedback, and best e1rm', () => {
    const sets: SetEvent[] = [
      ...setsFor('2026-08-03', 3, 10, 10),
      ...setsFor('2026-08-05', 3, 12.5, 8, 10),
    ]
    const prog = deriveProgression(U, twoSessions, sets, [
      { userId: U, exerciseId: 'db-squat', rating: 'too_hard', loggedAt: ms('2026-08-05') + 1 },
    ])
    const p = prog['db-squat']!
    expect(p.lastWeight).toBe(12.5)
    expect(p.lastTargetReps).toBe(10)
    expect(p.lastActualReps).toEqual([8, 8, 8])
    expect(p.lastFeedback).toBe('too_hard')
    expect(p.bestE1rm).toBeCloseTo(12.5 * (1 + 8 / 30))
  })

  it('ignores feedback from older sessions — no repeat-ratchet', () => {
    // 'too_easy' given in the 08-03 session; the 08-05 session got no feedback.
    const sets: SetEvent[] = [
      ...setsFor('2026-08-03', 3, 10, 10),
      ...setsFor('2026-08-05', 3, 12.5, 12, 12),
    ]
    const prog = deriveProgression(U, twoSessions, sets, [
      { userId: U, exerciseId: 'db-squat', rating: 'too_easy', loggedAt: ms('2026-08-03') + 1 },
    ])
    expect(prog['db-squat']!.lastFeedback).toBeNull()
  })

  it('attributes post-midnight sets to the session that started them', () => {
    const lateSession: SessionEvent = {
      dateISO: '2026-08-03',
      mode: 'full',
      completed: true,
      participantIds: [U],
      startedAt: ms('2026-08-03', 23),
    }
    const afterMidnight = Date.parse('2026-08-04T00:15:00')
    const sets: SetEvent[] = [
      {
        userId: U,
        exerciseId: 'db-squat',
        targetReps: 10,
        actualReps: 10,
        weight: 10,
        loggedAt: ms('2026-08-03', 23) + 60_000,
        assumed: false,
      },
      {
        userId: U,
        exerciseId: 'db-squat',
        targetReps: 10,
        actualReps: 10,
        weight: 10,
        loggedAt: afterMidnight,
        assumed: false,
      },
    ]
    const prog = deriveProgression(U, [lateSession], sets, [])
    // Both sets belong to the 08-03 session despite the date rollover.
    expect(prog['db-squat']!.lastActualReps).toEqual([10, 10])

    const stats = deriveStats(U, [lateSession], sets, ALL_DAYS, '2026-08-04')
    // Full session XP on 08-03 (50 + 2×2 + 25 full-clear); nothing stranded on 08-04.
    expect(stats.totalXp).toBe(50 + 4 + 25)
  })
})

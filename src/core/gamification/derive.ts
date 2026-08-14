import { addDays, daysBetween, localDateISO, weekdayIndex, type LocalDateISO } from '../dates'
import { epleyE1rm } from '../generator/progression'
import type { ExerciseProgress, FeedbackRating } from '../generator/types'

// ─── event-log input shapes (assembled by the app layer) ─────────────────────

export interface SessionEvent {
  dateISO: LocalDateISO
  completed: boolean // false = abandoned
  participantIds: string[]
  startedAt: number // epoch ms
}

export interface SetEvent {
  userId: string
  exerciseId: string
  targetReps: number
  actualReps: number
  weight: number
  loggedAt: number
}

export interface FeedbackEvent {
  userId: string
  exerciseId: string
  rating: FeedbackRating
  loggedAt: number
}

// ─── levels ──────────────────────────────────────────────────────────────────

export function totalXpForLevel(level: number): number {
  if (level <= 1) return 0
  return Math.round((250 * Math.pow(level - 1, 1.6)) / 10) * 10
}

export function levelFromXp(xp: number): number {
  let level = 1
  while (totalXpForLevel(level + 1) <= xp) level++
  return level
}

// ─── achievements ────────────────────────────────────────────────────────────

export interface Unlocked {
  id: string
  name: string
  emoji: string
  unlockedOn: LocalDateISO
}

export const ACHIEVEMENTS = [
  { id: 'first_workout', name: 'First Rep', emoji: '🌱' },
  { id: 'week_streak', name: 'On Fire', emoji: '🔥' },
  { id: 'month_streak', name: 'Unstoppable', emoji: '🚀' },
  { id: 'hundred_streak', name: 'Centurion', emoji: '🏛️' },
  { id: 'sessions_25', name: 'Regular', emoji: '📅' },
  { id: 'sessions_100', name: 'Veteran', emoji: '🎖️' },
  { id: 'first_pr', name: 'New Heights', emoji: '📈' },
  { id: 'pr_10', name: 'Record Breaker', emoji: '💥' },
  { id: 'volume_10t', name: 'Ten Tons', emoji: '🐘' },
  { id: 'early_bird', name: 'Early Bird', emoji: '🌅' },
  { id: 'perfect_week', name: 'Perfect Week', emoji: '✨' },
  { id: 'comeback', name: 'The Comeback', emoji: '💪' },
  { id: 'duo_day', name: 'Better Together', emoji: '❤️' },
] as const

// ─── derived stats ───────────────────────────────────────────────────────────

export interface PersonStats {
  userId: string
  totalXp: number
  level: number
  xpIntoLevel: number
  xpForNextLevel: number
  streak: number
  longestStreak: number
  sessionsCompleted: number
  totalVolumeKg: number
  prCount: number
  completedDates: Set<LocalDateISO>
  achievements: Unlocked[]
}

/** ISO-week key (Monday-anchored) for weekly streak-freeze accounting. */
function weekKey(dateISO: LocalDateISO): string {
  return addDays(dateISO, -weekdayIndex(dateISO))
}

/**
 * Everything is derived by replaying the event log — nothing is stored.
 * schedule: Mon..Sun booleans; rest days never break a streak; one automatic
 * streak-freeze absorbs the first missed scheduled day in each ISO week.
 */
export function deriveStats(
  userId: string,
  sessions: SessionEvent[],
  sets: SetEvent[],
  schedule: boolean[],
  todayISO: LocalDateISO,
): PersonStats {
  const mySessions = sessions
    .filter((s) => s.participantIds.includes(userId))
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1))
  const mySets = [...sets]
    .filter((s) => s.userId === userId)
    .sort((a, b) => a.loggedAt - b.loggedAt)

  const completedDates = new Set(mySessions.filter((s) => s.completed).map((s) => s.dateISO))
  const setsByDate = new Map<LocalDateISO, SetEvent[]>()
  for (const s of mySets) {
    const d = dateOfMs(s.loggedAt)
    const list = setsByDate.get(d) ?? []
    list.push(s)
    setsByDate.set(d, list)
  }

  // PRs: chronological best-e1rm improvements (weighted sets only).
  const bestE1rm = new Map<string, number>()
  const prDates: LocalDateISO[] = []
  for (const s of mySets) {
    const e = epleyE1rm(s.weight, s.actualReps)
    if (e > 0 && e > (bestE1rm.get(s.exerciseId) ?? 0) + 1e-9) {
      if (bestE1rm.has(s.exerciseId)) prDates.push(dateOfMs(s.loggedAt))
      bestE1rm.set(s.exerciseId, e)
    }
  }

  const unlocked = new Map<string, LocalDateISO>()
  const unlock = (id: string, date: LocalDateISO) => {
    if (!unlocked.has(id)) unlocked.set(id, date)
  }

  // Replay days from first activity to today: streak, XP, milestones.
  let totalXp = 0
  let streak = 0
  let longestStreak = 0
  let freezeUsedInWeek = ''
  let lastCompletedDate: LocalDateISO | null = null
  const firstDate = mySessions[0]?.dateISO ?? todayISO
  let sessionsCompleted = 0
  let totalVolumeKg = 0
  const prCountByDate = new Map<LocalDateISO, number>()
  for (const d of prDates) prCountByDate.set(d, (prCountByDate.get(d) ?? 0) + 1)

  for (let d = firstDate; d <= todayISO; d = addDays(d, 1)) {
    const scheduled = schedule[weekdayIndex(d)] ?? false
    const completed = completedDates.has(d)
    const daySets = setsByDate.get(d) ?? []
    const dayVolume = daySets.reduce((a, s) => a + s.weight * s.actualReps, 0)
    totalVolumeKg += dayVolume

    if (completed) {
      if (lastCompletedDate && daysGap(lastCompletedDate, d) >= 7) unlock('comeback', d)
      lastCompletedDate = d
      sessionsCompleted += 1
      streak += 1
      longestStreak = Math.max(longestStreak, streak)

      let xp = 50 + 2 * daySets.length
      const session = mySessions.find((s) => s.dateISO === d && s.completed)
      // Full-clear bonus can't be derived from sets alone (targets vary);
      // approximate: every logged set hit its target reps.
      const fullClear = daySets.length > 0 && daySets.every((s) => s.actualReps >= s.targetReps)
      if (fullClear) xp += 25
      xp += 15 * Math.min(prCountByDate.get(d) ?? 0, 2)
      if (streak === 7) xp += 50
      if (streak === 30) xp += 150
      if (streak === 100) xp += 500
      totalXp += xp

      unlock('first_workout', d)
      if (streak >= 7) unlock('week_streak', d)
      if (streak >= 30) unlock('month_streak', d)
      if (streak >= 100) unlock('hundred_streak', d)
      if (sessionsCompleted >= 25) unlock('sessions_25', d)
      if (sessionsCompleted >= 100) unlock('sessions_100', d)
      if (totalVolumeKg >= 10_000) unlock('volume_10t', d)
      if (session && new Date(session.startedAt).getHours() < 7) unlock('early_bird', d)
      if (session && session.participantIds.length >= 2) unlock('duo_day', d)
    } else if (daySets.length > 0) {
      totalXp += 2 * daySets.length // abandoned sessions keep per-set XP
    }

    if (!completed && scheduled && d < todayISO) {
      // Missed scheduled day: freeze absorbs the first miss each ISO week.
      const wk = weekKey(d)
      if (freezeUsedInWeek !== wk) freezeUsedInWeek = wk
      else streak = 0
    }

    // Perfect week: evaluated on Sundays for fully elapsed weeks.
    if (weekdayIndex(d) === 6) {
      const weekDates = Array.from({ length: 7 }, (_, i) => addDays(d, i - 6))
      const scheduledDays = weekDates.filter((wd) => schedule[weekdayIndex(wd)])
      if (scheduledDays.length > 0 && scheduledDays.every((wd) => completedDates.has(wd)))
        unlock('perfect_week', d)
    }
  }

  if (prDates.length >= 1) unlock('first_pr', prDates[0]!)
  if (prDates.length >= 10) unlock('pr_10', prDates[9]!)

  const level = levelFromXp(totalXp)
  const achievements = ACHIEVEMENTS.filter((a) => unlocked.has(a.id)).map((a) => ({
    ...a,
    unlockedOn: unlocked.get(a.id)!,
  }))

  return {
    userId,
    totalXp,
    level,
    xpIntoLevel: totalXp - totalXpForLevel(level),
    xpForNextLevel: totalXpForLevel(level + 1) - totalXpForLevel(level),
    streak,
    longestStreak,
    sessionsCompleted,
    totalVolumeKg: Math.round(totalVolumeKg),
    prCount: prDates.length,
    completedDates,
    achievements,
  }
}

/** Per-exercise progression state for the generator, derived from the log. */
export function deriveProgression(
  userId: string,
  sets: SetEvent[],
  feedback: FeedbackEvent[],
): Record<string, ExerciseProgress> {
  const out: Record<string, ExerciseProgress> = {}
  const mySets = sets.filter((s) => s.userId === userId).sort((a, b) => a.loggedAt - b.loggedAt)
  const myFeedback = feedback
    .filter((f) => f.userId === userId)
    .sort((a, b) => a.loggedAt - b.loggedAt)

  const setsByExercise = new Map<string, SetEvent[]>()
  for (const s of mySets) {
    const list = setsByExercise.get(s.exerciseId) ?? []
    list.push(s)
    setsByExercise.set(s.exerciseId, list)
  }

  for (const [exerciseId, all] of setsByExercise) {
    const lastDate = dateOfMs(all[all.length - 1]!.loggedAt)
    const lastSession = all.filter((s) => dateOfMs(s.loggedAt) === lastDate)
    const lastFeedback =
      [...myFeedback].reverse().find((f) => f.exerciseId === exerciseId)?.rating ?? null
    let best = 0
    for (const s of all) best = Math.max(best, epleyE1rm(s.weight, s.actualReps))
    out[exerciseId] = {
      lastWeight: lastSession[lastSession.length - 1]!.weight,
      lastTargetReps: lastSession[lastSession.length - 1]!.targetReps,
      lastActualReps: lastSession.map((s) => s.actualReps),
      lastFeedback,
      bestE1rm: best,
    }
  }
  return out
}

const dateOfMs = (ms: number): LocalDateISO => localDateISO(ms)
const daysGap = daysBetween

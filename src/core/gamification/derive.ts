import { addDays, daysBetween, localDateISO, weekdayIndex, type LocalDateISO } from '../dates'
import { epleyE1rm } from '../generator/progression'
import type { ExerciseProgress, FeedbackRating, SessionMode } from '../generator/types'

// ─── event-log input shapes (assembled by the app layer) ─────────────────────

export interface SessionEvent {
  dateISO: LocalDateISO
  /** When the session actually finished, if it did. Sessions can now be paused
   *  for hours, so a fixed window from the start is the wrong boundary. */
  endedAt?: number
  /** Recovery sessions keep the streak alive but are not strength days.
   *  A `short` session is a real strength day, worth proportionally less XP. */
  mode: SessionMode
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
  /**
   * The app called this set and nobody corrected it. It still counts as work —
   * volume, XP, progression — but never as a personal record: a number nobody
   * witnessed must not set the bar that future real sets have to clear.
   */
  assumed: boolean
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
  /** Dates with a completed STRENGTH session — recovery days are not workouts. */
  workoutDates: Set<LocalDateISO>
  achievements: Unlocked[]
}

/** ISO-week key (Monday-anchored) for weekly streak-freeze accounting. */
function weekKey(dateISO: LocalDateISO): string {
  return addDays(dateISO, -weekdayIndex(dateISO))
}

// A set logged within this window of a session's start belongs to that
// session's LOCAL DATE, even if the clock crossed midnight mid-workout.
const SESSION_WINDOW_MS = 6 * 3_600_000

/**
 * Owning-session lookup for set/feedback events.
 *
 * Everything downstream keys off the SESSION, not the calendar day: two
 * sessions can share a date (mobility in the morning, strength in the
 * evening — which the UI actively suggests), and a session can straddle
 * midnight. Date-keyed replay pays both of those wrong.
 */
function makeEventSessionAssigner(
  sessions: SessionEvent[],
): (loggedAt: number) => SessionEvent | null {
  const sorted = [...sessions].sort((a, b) => a.startedAt - b.startedAt)
  return (loggedAt) => {
    let owner: SessionEvent | null = null
    for (const s of sorted) {
      const until = s.endedAt ?? s.startedAt + SESSION_WINDOW_MS
      if (s.startedAt <= loggedAt && loggedAt <= until) owner = s
      if (s.startedAt > loggedAt) break
    }
    return owner
  }
}

/**
 * XP a single completed session is worth. One place, so modes cannot drift.
 *
 * Short sessions earn a smaller base and a smaller clear bonus — the per-set
 * term already scales itself. They keep FULL streak credit, deliberately: the
 * streak is what protects motivation, and a 20-minute session on a bad day is
 * exactly the behaviour worth protecting.
 */
const MODE_XP: Record<SessionMode, { base: number; fullClear: number }> = {
  full: { base: 50, fullClear: 25 },
  short: { base: 25, fullClear: 15 },
  mobility: { base: 20, fullClear: 0 },
}

/**
 * The most a quit relief session can pay — half of what finishing one pays.
 *
 * Every other mode gets this invariant for free: completing adds `base` on top
 * of the same per-set total abandoning earns, so completing always wins by
 * `base`. Relief is paid a FLAT rate for finishing, deliberately — it is not
 * measured in sets — and that flat rate had nothing to beat while relief logged
 * no sets at all. Activate logs them now, and twelve sets of cuff work paid 24
 * for pressing ✕ against 20 for pressing Continue (Grok, PR #41).
 *
 * A cap rather than a per-set rule for the completed side, because paying
 * relief by the set is the thing the flat rate exists to avoid.
 */
const ABANDONED_MOBILITY_XP_CAP = Math.floor(MODE_XP.mobility.base / 2)

function sessionXp(session: SessionEvent, sets: SetEvent[], prCount: number): number {
  // Recovery work counts for the streak but is not a strength session.
  if (session.mode === 'mobility') return MODE_XP.mobility.base
  const rule = MODE_XP[session.mode]
  let xp = rule.base + 2 * sets.length
  // Full-clear bonus: every set in THIS session hit its target reps.
  if (sets.length > 0 && sets.every((s) => s.actualReps >= s.targetReps)) xp += rule.fullClear
  return xp + 15 * Math.min(prCount, 2)
}

/** Total order: by date, then start time — same-date sessions sort stably. */
function bySessionOrder(a: SessionEvent, b: SessionEvent): number {
  if (a.dateISO !== b.dateISO) return a.dateISO < b.dateISO ? -1 : 1
  return a.startedAt - b.startedAt
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
  const mySessions = sessions.filter((s) => s.participantIds.includes(userId)).sort(bySessionOrder)
  const mySets = [...sets]
    .filter((s) => s.userId === userId)
    .sort((a, b) => a.loggedAt - b.loggedAt)
  const sessionOf = makeEventSessionAssigner(mySessions)

  const completedDates = new Set(mySessions.filter((s) => s.completed).map((s) => s.dateISO))
  const workoutDates = new Set(
    mySessions.filter((s) => s.completed && s.mode !== 'mobility').map((s) => s.dateISO),
  )
  // Keyed by startedAt: a session's identity, unique per person.
  const setsBySession = new Map<number, SetEvent[]>()
  const orphanSetsByDate = new Map<LocalDateISO, SetEvent[]>()
  for (const s of mySets) {
    const owner = sessionOf(s.loggedAt)
    if (owner) {
      const list = setsBySession.get(owner.startedAt) ?? []
      list.push(s)
      setsBySession.set(owner.startedAt, list)
    } else {
      const d = localDateISO(s.loggedAt)
      const list = orphanSetsByDate.get(d) ?? []
      list.push(s)
      orphanSetsByDate.set(d, list)
    }
  }

  // PRs: chronological best-e1rm improvements (weighted sets only), credited
  // to the session that produced them.
  const bestE1rm = new Map<string, number>()
  const prDates: LocalDateISO[] = []
  const prCountBySession = new Map<number, number>()
  for (const s of mySets) {
    if (s.assumed) continue
    // Cuff work at 2.5 kg is not a personal record, and the day it beats a row
    // is the day the record stops meaning anything. Same rule as
    // `sessionsCompleted` below: recovery work is real, and it is not strength
    // accounting.
    if (sessionOf(s.loggedAt)?.mode === 'mobility') continue
    const e = epleyE1rm(s.weight, s.actualReps)
    if (e > 0 && e > (bestE1rm.get(s.exerciseId) ?? 0) + 1e-9) {
      if (bestE1rm.has(s.exerciseId)) {
        const owner = sessionOf(s.loggedAt)
        prDates.push(owner?.dateISO ?? localDateISO(s.loggedAt))
        if (owner)
          prCountBySession.set(owner.startedAt, (prCountBySession.get(owner.startedAt) ?? 0) + 1)
      }
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
  for (let d = firstDate; d <= todayISO; d = addDays(d, 1)) {
    const scheduled = schedule[weekdayIndex(d)] ?? false
    const completed = completedDates.has(d)
    const daySessions = mySessions.filter((s) => s.dateISO === d)
    const setsOf = (s: SessionEvent) => setsBySession.get(s.startedAt) ?? []
    // Lifetime tonnage counts strength days only — the same line
    // `sessionsCompleted` draws, and for the same reason. A relief session
    // still reports its own volume on its own celebration card, which is a
    // true statement about that session; what it must not do is inflate the
    // number that unlocks `volume_10t`. Orphan sets predate the split and are
    // all strength work.
    const daySets = [
      ...daySessions.filter((s) => s.mode !== 'mobility').flatMap(setsOf),
      ...(orphanSetsByDate.get(d) ?? []),
    ]
    totalVolumeKg += daySets.reduce((a, s) => a + s.weight * s.actualReps, 0)

    // XP is per SESSION; streaks, freezes and achievements are per DAY.
    for (const session of daySessions) {
      if (session.completed) {
        // 'Regular'/'Veteran' are workout milestones — a stretch is not one.
        if (session.mode !== 'mobility') sessionsCompleted += 1
        totalXp += sessionXp(session, setsOf(session), prCountBySession.get(session.startedAt) ?? 0)
      } else {
        // Abandoned work still counts — but a relief session is paid a flat
        // rate for finishing, and per-set for quitting would now beat it.
        // Activate logs sets; a 30-minute posture session logs about twelve, so
        // hitting ✕ after the last one paid 24 against the 20 for pressing
        // Continue. Completing must never lose to quitting (Grok, PR #41).
        totalXp +=
          session.mode === 'mobility'
            ? Math.min(2 * setsOf(session).length, ABANDONED_MOBILITY_XP_CAP)
            : 2 * setsOf(session).length
      }
    }
    // Sets with no owning session still represent work done.
    totalXp += 2 * (orphanSetsByDate.get(d) ?? []).length

    if (completed) {
      if (lastCompletedDate && daysBetween(lastCompletedDate, d) >= 7) unlock('comeback', d)
      lastCompletedDate = d
      streak += 1
      longestStreak = Math.max(longestStreak, streak)
      if (streak === 7) totalXp += 50
      if (streak === 30) totalXp += 150
      if (streak === 100) totalXp += 500

      unlock('first_workout', d)
      if (streak >= 7) unlock('week_streak', d)
      if (streak >= 30) unlock('month_streak', d)
      if (streak >= 100) unlock('hundred_streak', d)
      if (sessionsCompleted >= 25) unlock('sessions_25', d)
      if (sessionsCompleted >= 100) unlock('sessions_100', d)
      if (totalVolumeKg >= 10_000) unlock('volume_10t', d)
      const done = daySessions.filter((s) => s.completed)
      if (done.some((s) => new Date(s.startedAt).getHours() < 7)) unlock('early_bird', d)
      if (done.some((s) => s.participantIds.length >= 2)) unlock('duo_day', d)
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
    workoutDates,
    achievements,
  }
}

/**
 * Which progression a set belongs to. Two tracks, never one.
 *
 * `db-reverse-fly` is both a `pull_h` main and an Activate movement, and it is
 * not the only one. Pooling them would let Sunday's 2 kg cuff work set Monday's
 * rear-delt prescription — the strength day would open at a rehab weight and
 * "progress" downwards, which is the opposite of what either session is for.
 *
 * This is also how `types.ts`'s rule that recovery days do not drive
 * progression stays literally true: they drive their own, and never strength's.
 */
export type ProgressionTrack = 'strength' | 'relief'

const trackOf = (mode: SessionMode): ProgressionTrack =>
  mode === 'mobility' ? 'relief' : 'strength'

/** Per-exercise progression state for the generator, derived from the log. */
export function deriveProgression(
  userId: string,
  sessions: SessionEvent[],
  sets: SetEvent[],
  feedback: FeedbackEvent[],
  track: ProgressionTrack = 'strength',
): Record<string, ExerciseProgress> {
  const out: Record<string, ExerciseProgress> = {}
  const mySessions = sessions.filter((s) => s.participantIds.includes(userId))
  const sessionOf = makeEventSessionAssigner(mySessions)
  // A set with no session to belong to is history from before this split, and
  // all of that history is strength work — assigning it there keeps every
  // existing prescription exactly where it was.
  const onTrack = (loggedAt: number) => {
    const s = sessionOf(loggedAt)
    return s ? trackOf(s.mode) === track : track === 'strength'
  }
  const mySets = sets
    .filter((s) => s.userId === userId && onTrack(s.loggedAt))
    .sort((a, b) => a.loggedAt - b.loggedAt)
  const myFeedback = feedback
    .filter((f) => f.userId === userId && onTrack(f.loggedAt))
    .sort((a, b) => a.loggedAt - b.loggedAt)
  const keyOf = (loggedAt: number) => sessionOf(loggedAt)?.startedAt ?? localDateISO(loggedAt)

  const setsByExercise = new Map<string, SetEvent[]>()
  for (const s of mySets) {
    const list = setsByExercise.get(s.exerciseId) ?? []
    list.push(s)
    setsByExercise.set(s.exerciseId, list)
  }

  for (const [exerciseId, all] of setsByExercise) {
    // Scoped to the exercise's most recent SESSION — two sessions in one day
    // are two different data points, and stale feedback must not ratchet.
    const lastKey = keyOf(all[all.length - 1]!.loggedAt)
    const lastSession = all.filter((s) => keyOf(s.loggedAt) === lastKey)
    // Feedback only applies to the exercise's LAST session — an old rating
    // must not keep ratcheting the weight on every later plan generation.
    const lastFeedback =
      [...myFeedback]
        .reverse()
        .find((f) => f.exerciseId === exerciseId && keyOf(f.loggedAt) === lastKey)?.rating ?? null
    // Same rule as PR detection: only witnessed sets set the bar.
    let best = 0
    // NOT the same rule: the deload baseline counts assumed sets too. A record
    // has to be witnessed; "how heavy do you normally go here" does not, and
    // insisting on it would return 0 for a hands-off session — which is every
    // session by default.
    let maxWeight = 0
    for (const s of all) {
      if (!s.assumed) best = Math.max(best, epleyE1rm(s.weight, s.actualReps))
      maxWeight = Math.max(maxWeight, s.weight)
    }
    out[exerciseId] = {
      lastWeight: lastSession[lastSession.length - 1]!.weight,
      lastTargetReps: lastSession[lastSession.length - 1]!.targetReps,
      lastActualReps: lastSession.map((s) => s.actualReps),
      lastFeedback,
      bestE1rm: best,
      maxWeight,
    }
  }
  return out
}

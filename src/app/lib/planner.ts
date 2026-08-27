import { catalog, exercisesById } from './catalog'
import { PROFILES, HOUSEHOLD_EQUIPMENT, HOUSEHOLD_SCHEDULE } from './profiles'
import { BAND_COLOURS } from '../../core/catalog/resistance'
import type { Pattern } from '../../core/catalog/types'
import { loadFeedback, loadSessions, loadSetLogs } from '../../infra/localstore'
import {
  deriveProgression,
  deriveStats,
  type PersonStats,
  type SessionEvent,
  type SetEvent,
} from '../../core/gamification/derive'
import { ThinKitError, generateWorkout } from '../../core/generator/generate'
import { generateMobilitySession, type MobilityFocus } from '../../core/generator/mobility'
import { localDateISO, type LocalDateISO } from '../../core/dates'
import type {
  DayHistory,
  DayType,
  GeneratorInput,
  ParticipantInput,
  WorkoutPlan,
} from '../../core/generator/types'

export const GENERATOR_VERSION = 1
export const HOUSEHOLD_ID = 'home'
// Household training days, from profiles.local.json (see profiles.ts).
// Editable via onboarding in M4.
export const DEFAULT_SCHEDULE = HOUSEHOLD_SCHEDULE

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  full_a: 'Full Body',
  full_b: 'Full Body',
  full_c: 'Full Body',
  upper: 'Upper Body',
  lower: 'Lower Body',
  push: 'Push Day',
  pull: 'Pull Day',
  legs: 'Leg Day',
}

export function sessionEvents(): SessionEvent[] {
  return loadSessions().map((s) => ({
    dateISO: s.dateISO,
    mode: s.mode ?? 'full',
    endedAt: s.endedAt,
    completed: !s.abandoned,
    participantIds: s.participantIds,
    startedAt: s.startedAt,
  }))
}

export function setEvents(): SetEvent[] {
  return loadSetLogs().map((l) => ({
    userId: l.userId,
    exerciseId: l.exerciseId,
    targetReps: l.targetReps,
    actualReps: l.actualReps,
    weight: l.weight,
    loggedAt: l.loggedAt,
    // Sets logged before R1 predate the follow-along player: every one of them
    // was a human tapping Done, which is exactly what `assumed: false` means.
    assumed: l.assumed ?? false,
  }))
}

/** Merged household history for the generator's variety rules. */
export function buildRecentHistory(todayISO: LocalDateISO): DayHistory[] {
  const sessions = loadSessions()
  const sets = loadSetLogs()
  const byDate = new Map<string, DayHistory>()
  for (const s of sessions) {
    if (s.dateISO >= todayISO) continue
    if ((s.mode ?? 'full') === 'mobility') continue // recovery is not a strength day
    byDate.set(s.dateISO, {
      dateISO: s.dateISO,
      dayType: (s.dayType as DayHistory['dayType']) ?? null,
      exerciseIds: [],
      muscleSetCounts: {},
    })
  }
  for (const log of sets) {
    const d = localDateISO(log.loggedAt)
    const day = byDate.get(d)
    if (!day) continue
    if (!day.exerciseIds.includes(log.exerciseId)) day.exerciseIds.push(log.exerciseId)
    const ex = exercisesById.get(log.exerciseId)
    for (const m of ex?.primaryMuscles ?? []) {
      day.muscleSetCounts[m] = (day.muscleSetCounts[m] ?? 0) + 1
    }
  }
  return [...byDate.values()].sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1)).slice(-14)
}

export function generatorInputFor(participantIds: string[], dateISO: LocalDateISO): GeneratorInput {
  const sessions = sessionEvents()
  const sets = setEvents()
  const feedback = loadFeedback()
  return {
    householdId: HOUSEHOLD_ID,
    dateISO,
    generatorVersion: GENERATOR_VERSION,
    catalog: catalog.exercises,
    scheduledDays: DEFAULT_SCHEDULE,
    participants: participantIds.map((id) => {
      const profile = PROFILES.find((p) => p.id === id)!
      return {
        userId: id,
        availableWeights: profile.availableWeights,
        availableBands: profile.availableBands,
        equipment: profile.equipment,
        maxTier: 2 as const,
        progression: deriveProgression(id, sessions, sets, feedback),
      }
    }),
    recentHistory: buildRecentHistory(dateISO),
  }
}

/**
 * Who a relief session is being generated for.
 *
 * One kit per participant, never merged into a single list: everyone does the
 * same movement at the same time, so the generator asks whether EACH kit can do
 * it (`allCanPerform`), and intersecting the lists first would lose movements
 * that one person does on a chair and the other on a step.
 *
 * The Activate phase prescribes real sets now, so it needs the same per-person
 * facts a strength day does. Progression comes from the RELIEF track: a cuff
 * movement climbs its own ladder, and never reads the weight a strength day set
 * for the same exercise (see `deriveProgression`).
 *
 * With nobody selected — the Today preview before a choice — one stand-in
 * carries the household union and no history: the same loosest honest guess the
 * preview always made about kit, now with targets attached.
 */
function reliefParticipants(participantIds: string[]): ParticipantInput[] {
  const sessions = sessionEvents()
  const sets = setEvents()
  const feedback = loadFeedback()
  if (participantIds.length === 0) {
    return [
      {
        userId: 'preview',
        availableWeights: [...new Set(PROFILES.flatMap((p) => p.availableWeights))].sort(
          (a, b) => a - b,
        ),
        // Ladder order, like every other `availableBands` — `PROFILES` already
        // sorts each person's, so a merge of sorted lists only needs deduping
        // once it is re-sorted by the ladder itself.
        availableBands: BAND_COLOURS.filter((c) =>
          PROFILES.some((p) => p.availableBands.includes(c)),
        ),
        equipment: HOUSEHOLD_EQUIPMENT,
        maxTier: 2,
        progression: {},
      },
    ]
  }
  return participantIds.map((id) => {
    const profile = PROFILES.find((p) => p.id === id)!
    return {
      userId: id,
      availableWeights: profile.availableWeights,
      availableBands: profile.availableBands,
      equipment: profile.equipment,
      maxTier: 2 as const,
      progression: deriveProgression(id, sessions, sets, feedback, 'relief'),
    }
  })
}

export function mobilityPlan(
  focus: MobilityFocus,
  participantIds: string[],
  minutes: number,
): WorkoutPlan {
  return generateMobilitySession({
    householdId: HOUSEHOLD_ID,
    dateISO: localDateISO(Date.now()),
    generatorVersion: GENERATOR_VERSION,
    catalog: catalog.exercises,
    focus,
    participants: reliefParticipants(participantIds),
    targetSeconds: minutes * 60,
  })
}

/** Session lengths offered on Today. The longest is a normal full session. */
export const STRENGTH_DURATIONS = [20, 35, 55] as const
export const DEFAULT_STRENGTH_MINUTES = 55

export function planForToday(participantIds: string[], minutes = DEFAULT_STRENGTH_MINUTES) {
  return generateWorkout({
    ...generatorInputFor(participantIds, localDateISO(Date.now())),
    targetSeconds: minutes * 60,
  })
}

/** Human names for the movement slots, so a failure can say what ran out. */
export const PATTERN_LABEL: Record<Pattern, string> = {
  push_h: 'horizontal push (chest)',
  push_v: 'overhead push (shoulders)',
  pull_h: 'horizontal pull (back, biceps)',
  pull_v: 'vertical pull (lats, traps)',
  squat: 'squat',
  hinge: 'hinge (hamstrings, glutes)',
  lunge: 'lunge',
  core: 'core',
  carry: 'carry',
  mobility: 'mobility',
}

export type PlanAttempt =
  | { ok: true; plan: WorkoutPlan }
  /** Which slot ran dry — the only fact that tells someone what to go and buy. */
  | { ok: false; thinPattern: Pattern }

/**
 * The UI's only door to strength generation. A kit too thin to fill every
 * movement pattern is a legitimate outcome, and every screen that generates
 * does so during render — so "throws" and "renders nothing" are the same event
 * unless the boundary is here rather than remembered at each call site.
 *
 * Only `ThinKitError` is converted; anything else is a real defect and still
 * throws, rather than being reported to the user as a missing dumbbell.
 */
export function tryPlanForToday(
  participantIds: string[],
  minutes = DEFAULT_STRENGTH_MINUTES,
): PlanAttempt {
  try {
    return { ok: true, plan: planForToday(participantIds, minutes) }
  } catch (err) {
    if (err instanceof ThinKitError) return { ok: false, thinPattern: err.pattern }
    throw err
  }
}

export function statsFor(userId: string): PersonStats {
  return deriveStats(
    userId,
    sessionEvents(),
    setEvents(),
    DEFAULT_SCHEDULE,
    localDateISO(Date.now()),
  )
}

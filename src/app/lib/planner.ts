import { catalog, exercisesById } from './catalog'
import { PROFILES, HOUSEHOLD_EQUIPMENT } from './profiles'
import { loadFeedback, loadSessions, loadSetLogs } from '../../infra/localstore'
import {
  deriveProgression,
  deriveStats,
  type PersonStats,
  type SessionEvent,
  type SetEvent,
} from '../../core/gamification/derive'
import { generateWorkout } from '../../core/generator/generate'
import { generateMobilitySession, type MobilityFocus } from '../../core/generator/mobility'
import { localDateISO, type LocalDateISO } from '../../core/dates'
import type { DayHistory, DayType, GeneratorInput, WorkoutPlan } from '../../core/generator/types'

export const GENERATOR_VERSION = 1
export const HOUSEHOLD_ID = 'home'
// Mon–Fri workout days; Sat/Sun rest. Editable via onboarding in M4.
export const DEFAULT_SCHEDULE = [true, true, true, true, true, false, false]

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
  }))
}

/** Merged household history for the generator's variety rules. */
export function buildRecentHistory(todayISO: LocalDateISO): DayHistory[] {
  const sessions = loadSessions()
  const sets = loadSetLogs()
  const byDate = new Map<string, DayHistory>()
  for (const s of sessions) {
    if (s.dateISO >= todayISO) continue
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
        maxTier: 2 as const,
        progression: deriveProgression(id, sessions, sets, feedback),
      }
    }),
    recentHistory: buildRecentHistory(dateISO),
  }
}

export function mobilityPlan(focus: MobilityFocus, participantIds: string[]): WorkoutPlan {
  return generateMobilitySession({
    householdId: HOUSEHOLD_ID,
    dateISO: localDateISO(Date.now()),
    generatorVersion: GENERATOR_VERSION,
    catalog: catalog.exercises,
    focus,
    participantIds,
    equipment: participantIds.length
      ? [
          ...new Set(
            participantIds.flatMap((id) => PROFILES.find((p) => p.id === id)?.equipment ?? []),
          ),
        ]
      : HOUSEHOLD_EQUIPMENT,
  })
}

export function planForToday(participantIds: string[]): WorkoutPlan {
  return generateWorkout(generatorInputFor(participantIds, localDateISO(Date.now())))
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

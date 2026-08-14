import type { Exercise, MuscleGroup } from '../catalog/types'

export type DayType = 'full_a' | 'full_b' | 'full_c' | 'upper' | 'lower' | 'push' | 'pull' | 'legs'

export type FeedbackRating = 'too_easy' | 'right' | 'too_hard'

/** Per-user progression state for one exercise. */
export interface ExerciseProgress {
  lastWeight: number // 0 = bodyweight
  lastTargetReps: number
  lastActualReps: number[] // per set, most recent session
  lastFeedback: FeedbackRating | null
  bestE1rm: number // Epley estimate, for PR detection
}

export interface DayHistory {
  dateISO: string // local 'YYYY-MM-DD'
  dayType: DayType | null // null = rest or missed
  exerciseIds: string[] // main-block exercises performed
  muscleSetCounts: Partial<Record<MuscleGroup, number>>
}

export interface ParticipantInput {
  userId: string
  availableWeights: number[] // per-dumbbell, sorted asc
  maxTier: 1 | 2 | 3
  progression: Record<string, ExerciseProgress> // keyed by exercise id
}

export interface GeneratorInput {
  householdId: string // seed component: selection is shared across participants
  dateISO: string
  generatorVersion: number
  catalog: Exercise[]
  scheduledDays: boolean[] // Mon..Sun (household schedule for day-type rotation)
  participants: ParticipantInput[] // 1 = solo, 2 = duo
  recentHistory: DayHistory[] // merged household history, last 14 days, oldest first
}

/** One person's target for one exercise (constant across rounds in v1). */
export interface PersonTarget {
  targetReps: number
  weight: number // 0 = bodyweight
}

export interface TimedItem {
  exerciseId: string
  seconds: number
}

export interface WorkItem {
  exerciseId: string
  perPerson: Record<string, PersonTarget> // userId -> target
}

export type Block =
  | { kind: 'warmup'; items: TimedItem[] }
  | { kind: 'mobility'; label: string; items: TimedItem[] }
  | {
      kind: 'superset'
      label: string
      rounds: number
      restSeconds: number
      items: WorkItem[] // 2 exercises, alternated A/B
    }
  | {
      kind: 'circuit'
      label: string
      rounds: number
      restSeconds: number
      items: WorkItem[] // 3 exercises, finisher
    }
  | { kind: 'cooldown'; items: TimedItem[] }

/** What kind of session this is. Strength days drive progression and
 *  muscle-balance history; recovery days deliberately do not. */
export type SessionMode = 'full' | 'mobility'

export interface WorkoutPlan {
  planVersion: 1
  seed: number
  dateISO: string
  mode: SessionMode
  dayType: DayType
  participantIds: string[]
  estimatedSeconds: number // invariant: 3000..3600
  blocks: Block[]
}

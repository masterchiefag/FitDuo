import type { Equipment, Exercise, MuscleGroup } from '../catalog/types'

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
  /** What this person owns. Per-person, like weights — see `allCanPerform`. */
  equipment: Equipment[]
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
  /**
   * How long they have. The generator fits the session to this, shrinking the
   * structure itself when the budget is short — the same input mobility
   * sessions already take, so "20 minutes today" is data, not a second mode.
   */
  targetSeconds?: number
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
  /**
   * How long this set runs, in seconds — the MAX across participants, since
   * they lift simultaneously with their own dumbbells (docs/DECISIONS.md).
   *
   * Carried on the plan rather than recomputed by the player: the reducer runs
   * work as a timed phase and never sees the catalog, and one number computed
   * once is one number the estimate and the countdown cannot disagree about.
   */
  workSeconds: number
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

/**
 * What kind of session this is. Strength days (full AND short) drive
 * progression and muscle-balance history; recovery days deliberately do not.
 *
 * `short` is the same engine at a smaller `targetSeconds` — not a second
 * generator — and earns full streak credit with proportionally less XP.
 */
export type SessionMode = 'full' | 'short' | 'mobility'

export interface WorkoutPlan {
  planVersion: 1
  seed: number
  dateISO: string
  mode: SessionMode
  dayType: DayType
  participantIds: string[]
  estimatedSeconds: number // invariant: inside durationBand(targetSeconds)
  blocks: Block[]
}

import type { BandColour } from '../catalog/resistance'
import type { BodyArea, Equipment, Exercise, MuscleGroup } from '../catalog/types'

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
  /** Theraband colours owned, in ladder order — the band-side `availableWeights`. */
  availableBands: BandColour[]
  /**
   * Areas this person has flagged as hurting. Per person and never shared: the
   * household trains the same movement, and only the affected person goes
   * lighter (PLAN §R5).
   */
  painAreas: BodyArea[]
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

/** What one person did the last time this movement came up. */
export interface LastPerformance {
  weight: number // 0 = bodyweight
  reps: number
}

export interface WorkItem {
  exerciseId: string
  perPerson: Record<string, PersonTarget> // userId -> target
  /**
   * Last time, per person — absent for a movement nobody has done yet.
   *
   * Frozen here at generate time, beside the targets, because the player must
   * NOT derive it: `deriveProgression` keys to the exercise's most recent
   * SESSION, so this session's first logged set makes today that session and
   * "last" becomes today — the fact would then be right for one set and gone
   * for the rest of the block. A plan-borne value also survives a killed tab,
   * which a snapshot taken at Start would not (persist-on-Start is M4).
   */
  lastTime?: Record<string, LastPerformance> // userId -> what they did
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
  /**
   * The Activate phase of a relief session, once its movements carry a load.
   *
   * Structurally a work block — sets, reps, a resistance, real progression —
   * because that is what strengthening a rotator cuff is, and reusing
   * `WorkItem` means the player logs it, `nextTarget` progresses it and history
   * remembers it without any of them learning a second vocabulary.
   *
   * Its own kind rather than a `circuit` for one blunt reason: the player calls
   * every circuit a finisher, and an Activate block is the opposite of a
   * finisher — it is the half of a recovery session that changes anything.
   */
  | {
      kind: 'activate'
      label: string
      rounds: number
      restSeconds: number
      items: WorkItem[]
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

import { z } from 'zod'

export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
] as const
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

export const PATTERNS = [
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
  'squat',
  'hinge',
  'lunge',
  'core',
  'carry',
  'mobility',
] as const
export type Pattern = (typeof PATTERNS)[number]

export type ExerciseRole = 'warmup' | 'main' | 'cooldown' | 'mobility'
export const EQUIPMENT = ['bodyweight', 'dumbbell', 'band', 'roller'] as const
export type Equipment = (typeof EQUIPMENT)[number]

/** Body areas an exercise loads — the single source for cautions, pain-flag
 *  load reduction, and substitution ranking (see PLAN A0). */
export const BODY_AREAS = [
  'shoulder',
  'lower_back',
  'knee',
  'wrist',
  'elbow',
  'neck',
  'hip',
] as const
export type BodyArea = (typeof BODY_AREAS)[number]

/** Regions a mobility movement addresses. */
export const MOBILITY_REGIONS = [
  'thoracic',
  'shoulders',
  'neck',
  'chest',
  'lower_back',
  'hips',
] as const
export type MobilityRegion = (typeof MOBILITY_REGIONS)[number]

/**
 * Mobility routines run mobilise → open → activate. Stretching alone does not
 * fix a slouched posture: the stiff segment has to move, the tight front has to
 * open, and the weak mid-back has to switch on.
 */
export const MOBILITY_PHASES = ['mobilise', 'open', 'activate'] as const
export type MobilityPhase = (typeof MOBILITY_PHASES)[number]

export const exerciseSchema = z.object({
  id: z.string().min(1), // stable slug, e.g. 'db-goblet-squat'
  name: z.string().min(1),
  role: z.enum(['warmup', 'main', 'cooldown', 'mobility']),
  equipment: z.enum(EQUIPMENT),
  pattern: z.enum(PATTERNS),
  primaryMuscles: z.array(z.enum(MUSCLE_GROUPS)).min(1),
  secondaryMuscles: z.array(z.enum(MUSCLE_GROUPS)),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  unilateral: z.boolean(),
  repRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  secondsPerRep: z.number().positive(),
  setupSeconds: z.number().nonnegative(),
  media: z.object({
    images: z.array(z.string()),
    instructions: z.array(z.string()),
  }),
  /** Areas this movement stresses. Drives cautions + pain-flag load reduction. */
  loads: z
    .array(z.object({ area: z.enum(BODY_AREAS), stress: z.enum(['high', 'moderate']) }))
    .default([]),
  /** Present when the movement can appear in a mobility/relief session. */
  mobility: z
    .object({
      phase: z.enum(MOBILITY_PHASES),
      regions: z.array(z.enum(MOBILITY_REGIONS)).min(1),
      seconds: z.number().int().positive(),
      /** Shown alongside the cue list during a mobility session. */
      focusCue: z.string().optional(),
      /** 2 = highest-value movement for its regions, selected ahead of the rest. */
      priority: z.union([z.literal(1), z.literal(2)]).default(1),
    })
    .optional(),
})
export type Exercise = z.infer<typeof exerciseSchema>

export const catalogSchema = z.object({
  version: z.number().int().positive(),
  exercises: z.array(exerciseSchema),
})
export type Catalog = z.infer<typeof catalogSchema>

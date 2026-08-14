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
/**
 * Everything a movement can need. Household fixtures (chair, wall, step) are
 * equipment too: a chair dip needs a chair exactly the way a curl needs a
 * dumbbell, and the only way the generator can respect that is if it is
 * declared like anything else.
 */
export const EQUIPMENT = [
  'bodyweight',
  'dumbbell',
  'band',
  'roller',
  'bench',
  'step',
  'chair',
  'wall',
  'pullup_bar',
] as const
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
  /**
   * Alternative kits. You can do this movement if you own **every** item of
   * **any one** kit — see `canPerform`. A list of lists rather than a flat list
   * because substitutes are the normal case: a chair dip wants a chair *or* a
   * step *or* a bench, and flattening that to one item would silently drop the
   * movement for anyone who happens to own a different one.
   */
  requires: z.array(z.array(z.enum(EQUIPMENT)).min(1)).min(1),
  /**
   * Reconciles the demo photo with our cues. The media comes from a public-domain
   * gym dataset, so a movement we cue for the floor is often *shown* on a bench;
   * without a line saying so, the picture silently contradicts the text.
   */
  setupNote: z.string().optional(),
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

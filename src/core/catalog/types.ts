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

export type ExerciseRole = 'warmup' | 'main' | 'cooldown'
export type Equipment = 'dumbbell' | 'bodyweight'

export const exerciseSchema = z.object({
  id: z.string().min(1), // stable slug, e.g. 'db-goblet-squat'
  name: z.string().min(1),
  role: z.enum(['warmup', 'main', 'cooldown']),
  equipment: z.enum(['dumbbell', 'bodyweight']),
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
})
export type Exercise = z.infer<typeof exerciseSchema>

export const catalogSchema = z.object({
  version: z.number().int().positive(),
  exercises: z.array(exerciseSchema),
})
export type Catalog = z.infer<typeof catalogSchema>

import exampleProfiles from '../../../content/profiles.example.json'

// Personal data (names, weights, pain areas) is NEVER committed AND never
// built into a production bundle. vite.config.ts injects profiles.local.json
// only in dev; production compiles this to `null` and will load real profiles
// at runtime from Supabase (M4). Anyone cloning the repo sees the example
// profiles, which is also what a production build currently gets.
declare const __LOCAL_PROFILES__: ProfilesFile | null

import type { BodyArea, Equipment } from '../../core/catalog/types'
export type { BodyArea, Equipment }

interface ProfilesFile {
  people: {
    id: string
    name: string
    accent: string
    availableWeights: number[]
    painAreas?: BodyArea[]
    equipment?: Equipment[]
    notes?: string
  }[]
  schedule: boolean[]
}

const ACCENTS: Record<string, { text: string; bg: string; ring: string }> = {
  amber: {
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500',
    ring: 'ring-amber-400',
  },
  teal: { text: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-500', ring: 'ring-teal-400' },
}

const source: ProfilesFile =
  (typeof __LOCAL_PROFILES__ !== 'undefined' && __LOCAL_PROFILES__) ||
  (exampleProfiles as unknown as ProfilesFile)

export interface LocalProfile {
  id: string
  name: string
  accent: { text: string; bg: string; ring: string }
  availableWeights: number[]
  painAreas: BodyArea[]
  equipment: Equipment[]
}

export const PROFILES: LocalProfile[] = source.people.map((p) => ({
  id: p.id,
  name: p.name,
  accent: ACCENTS[p.accent] ?? ACCENTS.amber!,
  availableWeights: [...p.availableWeights].sort((a, b) => a - b),
  painAreas: p.painAreas ?? [],
  equipment: p.equipment ?? ['bodyweight', 'dumbbell'],
}))

/** Union of what anyone in the household owns. */
export const HOUSEHOLD_EQUIPMENT: Equipment[] = [...new Set(PROFILES.flatMap((p) => p.equipment))]

export const HOUSEHOLD_SCHEDULE: boolean[] = source.schedule

/**
 * True when we are running on example data — i.e. a production build, which
 * deliberately contains no personal profiles until M4 moves them to Supabase.
 * The weights shown are NOT anyone's real weights, so the UI must say so
 * rather than quietly prescribing the wrong loads.
 */
export const USING_EXAMPLE_PROFILES =
  typeof __LOCAL_PROFILES__ === 'undefined' || __LOCAL_PROFILES__ === null

export const profileById = (id: string) => PROFILES.find((p) => p.id === id)

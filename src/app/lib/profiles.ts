import exampleProfiles from '../../../content/profiles.example.json'

// Personal data (names, weights, pain areas) is NEVER committed. Real values
// live in ./profiles.local.json (gitignored) until M4 moves them to Supabase.
// The glob resolves to {} when that file is absent, so the repo builds for
// anyone who clones it — they just see the generic example profiles.
const localModules = import.meta.glob('/profiles.local.json', { eager: true }) as Record<
  string,
  { default: ProfilesFile }
>

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
  Object.values(localModules)[0]?.default ?? (exampleProfiles as unknown as ProfilesFile)

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

export const profileById = (id: string) => PROFILES.find((p) => p.id === id)

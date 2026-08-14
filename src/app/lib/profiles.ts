// M2: two hardcoded local profiles. Real accounts + onboarding arrive in M4.
export interface LocalProfile {
  id: string
  name: string
  /** Tailwind-friendly accent classes, person A = amber, person B = teal. */
  accent: { text: string; bg: string; ring: string }
  availableWeights: number[]
}

export const PROFILES: LocalProfile[] = [
  {
    id: 'p1',
    name: 'Atul',
    accent: {
      text: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500',
      ring: 'ring-amber-400',
    },
    availableWeights: [2.5, 5, 7.5, 10],
  },
  {
    id: 'p2',
    name: 'Partner',
    accent: { text: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-500', ring: 'ring-teal-400' },
    availableWeights: [1, 2.5, 5],
  },
]

export const profileById = (id: string) => PROFILES.find((p) => p.id === id)

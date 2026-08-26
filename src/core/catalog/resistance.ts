import type { Exercise } from './types'

/**
 * What a movement is loaded with, and the ladder of resistances a person can
 * actually reach for it.
 *
 * Dumbbells were the only answer while every loaded movement took dumbbells,
 * and `isWeighted` said so with a boolean. Bands break that: a band external
 * rotation is unmistakably resistance work — it gets heavier, it progresses,
 * it is the whole point of the Activate phase — but its load is a colour, not
 * a number of kilos. So the question stops being "is this weighted" and
 * becomes "which ladder does this person climb here".
 */
export type ResistanceKind = 'dumbbell' | 'band' | 'none'

/**
 * Theraband's colour ladder, in the order the set is meant to be climbed, with
 * the manufacturer's published force at 100% elongation in kilograms.
 *
 * The numbers exist so the ladder is *ordinal and arithmetic at once*:
 * `nextTarget` steps through a `number[]` and snaps to the nearest owned rung,
 * and it has no idea whether those numbers came from dumbbells or latex. Only
 * the display converts back to a colour, because "red band" is what a person
 * can find in a drawer and "1.7 kg" is not.
 */
export const BAND_COLOURS = [
  'tan',
  'yellow',
  'red',
  'green',
  'blue',
  'black',
  'silver',
  'gold',
] as const
export type BandColour = (typeof BAND_COLOURS)[number]

export const BAND_FORCE_KG: Record<BandColour, number> = {
  tan: 1.1,
  yellow: 1.3,
  red: 1.7,
  green: 2.1,
  blue: 2.6,
  black: 3.3,
  silver: 4.5,
  gold: 6.4,
}

/**
 * The person's own resistances. Both lists are "what is in the house", not a
 * prescription — the generator never hands out a rung nobody owns.
 */
export interface ResistanceKit {
  availableWeights: number[]
  availableBands: BandColour[]
}

/**
 * Which ladder a movement loads from.
 *
 * Kit-uniform, and the invariant that keeps it honest is asserted in
 * tests/catalog.test.ts: no exercise offers alternative kits that disagree
 * about how it is loaded. The day one does — `[['dumbbell'], ['band']]` — this
 * has to become person-scoped, and that test failing is the signal.
 */
export function resistanceKind(ex: Exercise): ResistanceKind {
  if (ex.requires.every((kit) => kit.includes('dumbbell'))) return 'dumbbell'
  if (ex.requires.every((kit) => kit.includes('band'))) return 'band'
  return 'none'
}

/** Ascending rungs this person can reach for this movement; empty = unloaded. */
export function ladderFor(ex: Exercise, kit: ResistanceKit): number[] {
  switch (resistanceKind(ex)) {
    case 'dumbbell':
      return [...kit.availableWeights].sort((a, b) => a - b)
    case 'band':
      return kit.availableBands.map((c) => BAND_FORCE_KG[c]).sort((a, b) => a - b)
    case 'none':
      return []
  }
}

/**
 * The colour a band force belongs to, for display. Nearest rung rather than an
 * exact match: history can hold a force from a colour the person has since
 * given away, and showing the closest colour they might own beats showing kilos
 * of latex tension nobody can act on.
 */
export function bandColourFor(forceKg: number): BandColour | null {
  if (forceKg <= 0) return null
  let best: BandColour = BAND_COLOURS[0]
  for (const c of BAND_COLOURS) {
    if (Math.abs(BAND_FORCE_KG[c] - forceKg) < Math.abs(BAND_FORCE_KG[best] - forceKg)) best = c
  }
  return best
}

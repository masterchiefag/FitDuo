import { bandColourFor, resistanceKind } from '../../core/catalog/resistance'
import type { Exercise } from '../../core/catalog/types'
import type { LastPerformance } from '../../core/generator/types'

/**
 * How a prescribed resistance is said out loud.
 *
 * Bands are stored as the force their colour pulls, because that is the only
 * form `nextTarget` can climb — but "1.7 kg" is not a thing anyone can pick up.
 * The colour is, so every screen that shows a load asks here rather than
 * printing the number, and the conversion lives in exactly one place.
 */
export function loadLabel(ex: Exercise | undefined, weight: number): string {
  const banded = ex !== undefined && resistanceKind(ex) === 'band'
  // Order matters, and it used to be the other way round. Zero means "no rung
  // to step" — which for a band movement is a person who owns a band and has
  // not recorded its colour, not a person doing Band Pull-Apart with no band.
  // `availableBands` defaults to empty, so the very first Posture & Shoulders
  // after this ships would otherwise read "Bodyweight" on a movement whose name
  // begins with the word Band (Grok, PR #41).
  if (banded) {
    const colour = weight > 0 ? bandColourFor(weight) : null
    return colour ? `${colour} band` : 'your band'
  }
  if (weight === 0) return 'bodyweight'
  return `${weight} kg`
}

/** The one thing to do before a set starts: pick up the right bell, or band. */
export function grabLabel(ex: Exercise | undefined, weight: number): string {
  const label = loadLabel(ex, weight)
  if (label === 'bodyweight') return 'Bodyweight'
  if (label === 'your band') return 'Grab your band'
  return label.endsWith('band') ? `Grab the ${label}` : `Grab ${label}`
}

/** What they did last time, in the same vocabulary as the target. */
export function lastTimeLabel(ex: Exercise | undefined, last: LastPerformance): string {
  return last.weight === 0 ? `${last.reps} reps` : `${loadLabel(ex, last.weight)} × ${last.reps}`
}

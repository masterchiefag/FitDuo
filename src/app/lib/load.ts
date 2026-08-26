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
  if (weight === 0) return 'bodyweight'
  if (ex && resistanceKind(ex) === 'band') {
    const colour = bandColourFor(weight)
    if (colour) return `${colour} band`
  }
  return `${weight} kg`
}

/** The one thing to do before a set starts: pick up the right bell, or band. */
export function grabLabel(ex: Exercise | undefined, weight: number): string {
  if (weight === 0) return 'Bodyweight'
  const label = loadLabel(ex, weight)
  return label.endsWith('band') ? `Grab the ${label}` : `Grab ${label}`
}

/** What they did last time, in the same vocabulary as the target. */
export function lastTimeLabel(ex: Exercise | undefined, last: LastPerformance): string {
  return last.weight === 0 ? `${last.reps} reps` : `${loadLabel(ex, last.weight)} × ${last.reps}`
}

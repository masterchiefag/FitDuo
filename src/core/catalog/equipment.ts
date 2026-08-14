import type { Equipment, Exercise } from './types'

/**
 * Equipment eligibility. One predicate, used by every generator — a movement
 * that needs gear must be invisible to selection, not merely awkward to do.
 */

/** Everyone owns their own body; a profile never has to declare it. */
export function ownedEquipment(owned: readonly Equipment[]): Equipment[] {
  return owned.includes('bodyweight') ? [...owned] : ['bodyweight', ...owned]
}

/**
 * True when the person owns every item of at least one of the exercise's kits.
 *
 * The `some(every)` shape is the whole point: `requires` lists *alternatives*,
 * so `[['chair'], ['step'], ['bench']]` means "any one of these", while
 * `[['dumbbell', 'bench']]` means "both, together". A flat list could only
 * express the second.
 */
export function canPerform(ex: Exercise, owned: readonly Equipment[]): boolean {
  const have = ownedEquipment(owned)
  return ex.requires.some((kit) => kit.every((item) => have.includes(item)))
}

/**
 * Whether a weight target means anything for this movement. True only when
 * every way of performing it involves dumbbells — an exercise you *can* do
 * unloaded gets a bodyweight target.
 */
export function isWeighted(ex: Exercise): boolean {
  return ex.requires.every((kit) => kit.includes('dumbbell'))
}

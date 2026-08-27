import type { Equipment, Exercise } from './types'

/**
 * Equipment eligibility. One predicate, used by every generator — a movement
 * that needs gear must be invisible to selection, not merely awkward to do.
 */

/**
 * Fixtures every home already has, which nobody thinks of as equipment and so
 * never lists. Assumed present rather than required, because the alternative is
 * worse in both directions: gate on them and a real household silently loses
 * chair dips and wall stretches it can obviously do; leave them out of
 * `requires` entirely and the catalog goes back to not saying what a movement
 * needs.
 *
 * `step` and `bench` are NOT here. Stairs are common but not universal, and a
 * knee-height surface that takes your bodyweight is exactly the kind of thing
 * worth asking about.
 */
const ASSUMED: Equipment[] = ['bodyweight', 'chair', 'wall']

/** What a person can actually reach, given the fixtures nobody declares. */
export function ownedEquipment(owned: readonly Equipment[]): Equipment[] {
  return [...new Set<Equipment>([...ASSUMED, ...owned])]
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
 * Whether a shared session can include this movement: everyone performs it at
 * the same time, so every participant must be able to do it — each with their
 * OWN kit.
 *
 * NOT `canPerform(ex, A ∩ B)`. Intersecting the two lists was equivalent while
 * an exercise named one implement, and stops being equivalent the moment kits
 * are alternatives: for `[['chair'], ['step']]`, one person on a chair and the
 * other on a step both satisfy it, while the intersection of their lists
 * contains neither and the movement vanishes for a pair who can both do it.
 */
export function allCanPerform(ex: Exercise, kits: readonly (readonly Equipment[])[]): boolean {
  return kits.length > 0 && kits.every((kit) => canPerform(ex, kit))
}

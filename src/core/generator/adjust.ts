import type { BodyArea, Exercise } from '../catalog/types'
import type { PersonTarget } from './types'

/**
 * The ordered target-adjustment pipeline (PLAN §A0.2).
 *
 * A prescription is the base progression target passed through a list of small
 * pure adjusters, and the LAST two always run: a weight this person owns, and
 * reps inside the movement's own range. That ordering is the whole design —
 * however many rules get added above, none of them can emit something
 * unliftable or out of range, because they do not get the last word.
 *
 * Built now rather than earlier because R5 supplies the first adjuster after
 * `progression`. An interface wrapping a single entry is the shape of a
 * mechanism defending against nothing (CLAUDE.md, filter 3); an interface
 * wrapping two, one of which is already asked for by name in the plan
 * (`readiness`, `sessionMode`), is a list.
 */
export interface AdjustContext {
  exercise: Exercise
  /** Ascending rungs this person owns for this movement; empty = unloaded. */
  ladder: number[]
  /** Areas this person has flagged as hurting. */
  painAreas: readonly BodyArea[]
  /**
   * The heaviest this person has used for this movement, or 0 with no history.
   *
   * A deload has to be measured against a HEALTHY baseline, not against last
   * session — because last session's log IS the deloaded prescription. Stepping
   * down from it again each time turns "one rung lighter while it hurts" into a
   * progressive deload that walks the kit to its lightest bell in three
   * sessions and then cannot climb back (Grok, PR #43).
   */
  baselineWeight: number
}

export interface Adjuster {
  id: string
  apply(target: PersonTarget, context: AdjustContext): PersonTarget
}

/** The rung below `weight`, or `weight` itself at the bottom of the ladder. */
function oneStepDown(ladder: number[], weight: number): number {
  const below = [...ladder].sort((a, b) => a - b).filter((w) => w < weight)
  return below[below.length - 1] ?? weight
}

/**
 * A flagged area goes lighter on the movements that load it — for that person
 * only, without removing the movement from anyone's session, and by the SAME
 * one rung every session the flag stays live.
 *
 * Adapting rather than deleting is the constraint, not a compromise: the
 * household trains the same movement together, and one person's shoulder must
 * never take the other person's strength day away (PLAN §R5). The partner's
 * target is computed independently and never sees this.
 *
 * A `high` stress area takes the weight down a rung AND the reps to the bottom
 * of the range; `moderate` takes the reps only. Bodyweight movements have no
 * rung to drop, so they take the reps either way — which is the honest answer
 * for a push-up on a sore wrist.
 */
export const painLoad: Adjuster = {
  id: 'painLoad',
  apply(target, { exercise, ladder, painAreas, baselineWeight }) {
    if (painAreas.length === 0) return target
    const hits = exercise.loads.filter((l) => painAreas.includes(l.area))
    if (hits.length === 0) return target
    const [minReps] = exercise.repRange
    const high = hits.some((l) => l.stress === 'high')
    if (!high || target.weight === 0 || ladder.length === 0) {
      // `moderate` is a caution, not a deload: the reps come off, the bell does
      // not. Bodyweight has no rung to drop and takes the reps either way.
      return { targetReps: minReps, weight: target.weight }
    }
    // A CEILING, not a subtraction. One rung below the healthy baseline, and
    // never above what progression asked for — so a flag that stays on holds
    // the same rung, and `too_hard` on a flagged movement steps once rather
    // than twice.
    const ceiling = oneStepDown(ladder, baselineWeight || target.weight)
    return { targetReps: minReps, weight: Math.min(target.weight, ceiling) }
  },
}

/** Everything between `progression` and the terminal pair, in order. */
export const ADJUSTERS: Adjuster[] = [painLoad]

export function applyAdjusters(target: PersonTarget, context: AdjustContext): PersonTarget {
  return ADJUSTERS.reduce((t, a) => a.apply(t, context), target)
}

/**
 * Whether a movement is one this person should be careful with today — used to
 * surface their caution line during the set, beside the target that moved.
 */
export function flaggedAreas(exercise: Exercise, painAreas: readonly BodyArea[]): BodyArea[] {
  return exercise.loads.filter((l) => painAreas.includes(l.area)).map((l) => l.area)
}

import type { LastPerformance, PersonTarget } from '../generator/types'

/**
 * The rest screen's one earned fact — or nothing at all.
 *
 * "Last time 7.5 kg × 10" is only worth reading when today asks for something
 * else; a fact that repeats today's number is noise, and a rest screen that
 * carries noise stops being read. So it is news exactly when the prescription
 * moved.
 *
 * Both numbers are compared, not just the weight: bodyweight movements carry
 * `weight === 0` on either side, so weight alone would mean chair dips and
 * planks never have news, and on a weighted movement the extra rep IS the
 * progression that week (double progression tops out the rep range before it
 * steps the bell).
 */
export function lastTimeNews(
  target: PersonTarget,
  last: LastPerformance | undefined,
): LastPerformance | null {
  if (!last) return null
  if (last.weight === target.weight && last.reps === target.targetReps) return null
  return last
}

/**
 * Whether today's prescription is the harder one.
 *
 * The fact is worth saying either way — a lighter day is the app visibly
 * answering a "too hard" tap, and an answer nobody sees is why people stop
 * telling you things. But only the harder day is the prize for good work
 * (principle 2), so a step down must not borrow its styling: the same emerald
 * "last time 10 kg × 8" beside today's 7.5 kg would celebrate a deload.
 */
export function movedUp(target: PersonTarget, last: LastPerformance): boolean {
  if (target.weight !== last.weight) return target.weight > last.weight
  return target.targetReps > last.reps
}

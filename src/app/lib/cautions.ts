import type { BodyArea, Exercise } from '../../core/catalog/types'

/**
 * What to watch on a movement that loads a given area.
 *
 * Authored per AREA, not per exercise, because `loads` already says which areas
 * a movement stresses and PLAN §A0 is explicit that everything reads that one
 * field — a per-exercise caution table would be the pattern→pain lookup it
 * forbids, spelled differently.
 *
 * Shown to everyone, flag or no flag: "keep the ribs down, stop if it pinches"
 * is how the movement is done well, and a person who waits for a sore shoulder
 * to be told that has already had the set that caused it (PLAN §R5).
 */
const CAUTION: Record<BodyArea, string> = {
  shoulder: 'Keep the ribs down and the neck long — stop the rep if it pinches.',
  lower_back: 'Brace before you move, and keep the back flat — the hips hinge, not the spine.',
  knee: 'Track the knee over the middle of the foot; do not let it fall inward.',
  wrist:
    'Spread the fingers and press through the whole hand — make a fist on the floor if it aches.',
  elbow: 'Keep a soft elbow at lockout and do not snap it straight.',
  neck: 'Look at the floor, not forward — the neck follows the spine.',
  hip: 'Keep the movement inside the range the hip is comfortable in, not the range it can reach.',
}

export interface Caution {
  area: BodyArea
  line: string
  /** Whether this is an area the person has flagged — the reason to shout it. */
  flagged: boolean
}

/**
 * Cautions for one movement, most serious first, flagged areas ahead of the
 * rest. `high` stress leads because it is the one most worth reading before the
 * set rather than after it.
 */
export function cautionsFor(
  ex: Exercise | undefined,
  painAreas: readonly BodyArea[] = [],
): Caution[] {
  if (!ex) return []
  return [...ex.loads]
    .sort((a, b) => {
      const flagged = Number(painAreas.includes(b.area)) - Number(painAreas.includes(a.area))
      if (flagged !== 0) return flagged
      const stress = Number(b.stress === 'high') - Number(a.stress === 'high')
      return stress !== 0 ? stress : a.area < b.area ? -1 : 1
    })
    .map((l) => ({ area: l.area, line: CAUTION[l.area], flagged: painAreas.includes(l.area) }))
}

/** `shoulder` -> `shoulder`, `lower_back` -> `lower back`. */
export const areaLabel = (area: BodyArea): string => area.replace('_', ' ')

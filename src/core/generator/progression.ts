import type { Exercise } from '../catalog/types'
import type { ExerciseProgress, PersonTarget } from './types'

/** Epley estimated 1RM; reps at bodyweight (weight 0) contribute no e1rm. */
export function epleyE1rm(weight: number, reps: number): number {
  return weight <= 0 ? 0 : weight * (1 + reps / 30)
}

/**
 * The next rung up or down the ladder, staying put at either end.
 *
 * Exported because the player's ± buttons have to move along the SAME ladder
 * the generator prescribes from. They used to add and subtract 2.5, which was
 * merely sloppy for a household owning 2.5 kg steps and is wrong outright for a
 * band: 1.7 + 2.5 is 4.2, a tension no colour pulls and nobody owns.
 */
export function stepWeight(available: number[], current: number, direction: 1 | -1): number {
  const sorted = [...available].sort((a, b) => a - b)
  if (direction === 1) return sorted.find((w) => w > current) ?? current
  return [...sorted].reverse().find((w) => w < current) ?? current
}

/** Nearest owned rung (ties go lighter) — history may reference a dumbbell, or
 *  a band colour, the user no longer has. */
function snapToAvailable(available: number[], weight: number): number {
  if (weight === 0 || available.length === 0 || available.includes(weight)) return weight
  return available.reduce((best, w) => {
    const d = Math.abs(w - weight)
    const bestD = Math.abs(best - weight)
    return d < bestD || (d === bestD && w < best) ? w : best
  })
}

/** Starting target for an exercise with no history. */
function initialTarget(ex: Exercise, ladder: number[]): PersonTarget {
  const [minReps, maxReps] = ex.repRange
  const startReps = Math.min(minReps + 2, maxReps)
  // An empty ladder is the unloaded case, and it covers both of them: a
  // bodyweight movement, and a loaded one the person owns nothing for yet.
  if (ladder.length === 0) return { targetReps: startReps, weight: 0 }
  const sorted = [...ladder].sort((a, b) => a - b)
  // Conservative default: second-lightest rung; feedback moves it quickly.
  const weight = sorted[Math.min(1, sorted.length - 1)] ?? 0
  return { targetReps: startReps, weight }
}

/**
 * Double progression over the person's actual resistances — dumbbells for a
 * curl, Theraband colours for an external rotation. `ladder` is an ascending
 * list of rungs they own; where it came from is `ladderFor`'s problem, and the
 * arithmetic here is identical either way.
 *
 * too_hard steps weight down; too_easy steps weight up (or +2 reps at the top
 * weight); "right" with all sets hit adds a rep, rolling into a weight step
 * when the rep range tops out. Timed holds (repRange [1,1]) never progress.
 */
export function nextTarget(
  ex: Exercise,
  ladder: number[],
  progress: ExerciseProgress | undefined,
): PersonTarget {
  const t = nextTargetRaw(ex, ladder, progress)
  // The terminal pair (PLAN A0): whatever rule produced this target, and
  // however many adjusters get added above it later, the prescription that
  // leaves here is on a rung this person owns today — a dumbbell they have, a
  // band colour in their set — and inside the movement's own rep range.
  // Nothing upstream can violate that,
  // because these two run last.
  const [minReps, maxReps] = ex.repRange
  return {
    targetReps: Math.max(minReps, Math.min(maxReps, t.targetReps)),
    weight: t.weight === 0 ? 0 : snapToAvailable(ladder, t.weight),
  }
}

function nextTargetRaw(
  ex: Exercise,
  ladder: number[],
  progress: ExerciseProgress | undefined,
): PersonTarget {
  if (ex.repRange[0] === 1 && ex.repRange[1] === 1) return { targetReps: 1, weight: 0 }
  if (!progress) return initialTarget(ex, ladder)

  const [minReps, maxReps] = ex.repRange
  const { lastWeight, lastTargetReps, lastActualReps, lastFeedback } = progress
  const clampReps = (r: number) => Math.max(minReps, Math.min(maxReps, r))
  // Unloaded here means "no rung to step": a bodyweight movement, a kit that
  // owns no bands or dumbbells for it, or a history that recorded zero.
  const isBodyweight = ladder.length === 0 || lastWeight === 0

  if (lastFeedback === 'too_hard') {
    if (isBodyweight) return { targetReps: clampReps(lastTargetReps - 2), weight: 0 }
    const down = stepWeight(ladder, lastWeight, -1)
    return down < lastWeight
      ? { targetReps: minReps, weight: down }
      : { targetReps: clampReps(lastTargetReps - 2), weight: lastWeight }
  }

  if (lastFeedback === 'too_easy') {
    if (isBodyweight) return { targetReps: clampReps(lastTargetReps + 2), weight: 0 }
    const up = stepWeight(ladder, lastWeight, 1)
    return up > lastWeight
      ? { targetReps: minReps, weight: up }
      : { targetReps: clampReps(lastTargetReps + 2), weight: lastWeight }
  }

  // 'right' or no feedback: hold weight, nudge reps when all sets were hit.
  const allHit = lastActualReps.length > 0 && lastActualReps.every((r) => r >= lastTargetReps)
  if (!allHit) return { targetReps: lastTargetReps, weight: lastWeight }
  if (lastTargetReps + 1 <= maxReps) return { targetReps: lastTargetReps + 1, weight: lastWeight }
  if (!isBodyweight) {
    const up = stepWeight(ladder, lastWeight, 1)
    if (up > lastWeight) return { targetReps: minReps, weight: up }
  }
  return { targetReps: maxReps, weight: lastWeight }
}

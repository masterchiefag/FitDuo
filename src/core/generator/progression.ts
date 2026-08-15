import { isWeighted } from '../catalog/equipment'
import type { Exercise } from '../catalog/types'
import type { ExerciseProgress, PersonTarget } from './types'

/** Epley estimated 1RM; reps at bodyweight (weight 0) contribute no e1rm. */
export function epleyE1rm(weight: number, reps: number): number {
  return weight <= 0 ? 0 : weight * (1 + reps / 30)
}

function stepWeight(available: number[], current: number, direction: 1 | -1): number {
  const sorted = [...available].sort((a, b) => a - b)
  if (direction === 1) return sorted.find((w) => w > current) ?? current
  return [...sorted].reverse().find((w) => w < current) ?? current
}

/** Nearest owned dumbbell (ties go lighter) — history may reference weights the user no longer has. */
function snapToAvailable(available: number[], weight: number): number {
  if (weight === 0 || available.length === 0 || available.includes(weight)) return weight
  return available.reduce((best, w) => {
    const d = Math.abs(w - weight)
    const bestD = Math.abs(best - weight)
    return d < bestD || (d === bestD && w < best) ? w : best
  })
}

/** Starting target for an exercise with no history. */
function initialTarget(ex: Exercise, availableWeights: number[]): PersonTarget {
  const [minReps, maxReps] = ex.repRange
  const startReps = Math.min(minReps + 2, maxReps)
  if (!isWeighted(ex)) return { targetReps: startReps, weight: 0 }
  const sorted = [...availableWeights].sort((a, b) => a - b)
  // Conservative default: second-lightest dumbbell; feedback moves it quickly.
  const weight = sorted[Math.min(1, sorted.length - 1)] ?? 0
  return { targetReps: startReps, weight }
}

/**
 * Double progression over the person's actual dumbbells:
 * too_hard steps weight down; too_easy steps weight up (or +2 reps at the top
 * weight); "right" with all sets hit adds a rep, rolling into a weight step
 * when the rep range tops out. Timed holds (repRange [1,1]) never progress.
 */
export function nextTarget(
  ex: Exercise,
  availableWeights: number[],
  progress: ExerciseProgress | undefined,
): PersonTarget {
  const t = nextTargetRaw(ex, availableWeights, progress)
  // The terminal pair (PLAN A0): whatever rule produced this target, and
  // however many adjusters get added above it later, the prescription that
  // leaves here is liftable with the dumbbells this person owns today and
  // inside the movement's own rep range. Nothing upstream can violate that,
  // because these two run last.
  const [minReps, maxReps] = ex.repRange
  return {
    targetReps: Math.max(minReps, Math.min(maxReps, t.targetReps)),
    weight: t.weight === 0 ? 0 : snapToAvailable(availableWeights, t.weight),
  }
}

function nextTargetRaw(
  ex: Exercise,
  availableWeights: number[],
  progress: ExerciseProgress | undefined,
): PersonTarget {
  if (ex.repRange[0] === 1 && ex.repRange[1] === 1) return { targetReps: 1, weight: 0 }
  if (!progress) return initialTarget(ex, availableWeights)

  const [minReps, maxReps] = ex.repRange
  const { lastWeight, lastTargetReps, lastActualReps, lastFeedback } = progress
  const clampReps = (r: number) => Math.max(minReps, Math.min(maxReps, r))
  const isBodyweight = !isWeighted(ex) || lastWeight === 0

  if (lastFeedback === 'too_hard') {
    if (isBodyweight) return { targetReps: clampReps(lastTargetReps - 2), weight: 0 }
    const down = stepWeight(availableWeights, lastWeight, -1)
    return down < lastWeight
      ? { targetReps: minReps, weight: down }
      : { targetReps: clampReps(lastTargetReps - 2), weight: lastWeight }
  }

  if (lastFeedback === 'too_easy') {
    if (isBodyweight) return { targetReps: clampReps(lastTargetReps + 2), weight: 0 }
    const up = stepWeight(availableWeights, lastWeight, 1)
    return up > lastWeight
      ? { targetReps: minReps, weight: up }
      : { targetReps: clampReps(lastTargetReps + 2), weight: lastWeight }
  }

  // 'right' or no feedback: hold weight, nudge reps when all sets were hit.
  const allHit = lastActualReps.length > 0 && lastActualReps.every((r) => r >= lastTargetReps)
  if (!allHit) return { targetReps: lastTargetReps, weight: lastWeight }
  if (lastTargetReps + 1 <= maxReps) return { targetReps: lastTargetReps + 1, weight: lastWeight }
  if (!isBodyweight) {
    const up = stepWeight(availableWeights, lastWeight, 1)
    if (up > lastWeight) return { targetReps: minReps, weight: up }
  }
  return { targetReps: maxReps, weight: lastWeight }
}

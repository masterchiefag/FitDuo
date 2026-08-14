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

/** Starting target for an exercise with no history. */
function initialTarget(ex: Exercise, availableWeights: number[]): PersonTarget {
  const [minReps] = ex.repRange
  if (ex.equipment === 'bodyweight') return { targetReps: minReps + 2, weight: 0 }
  const sorted = [...availableWeights].sort((a, b) => a - b)
  // Conservative default: second-lightest dumbbell; feedback moves it quickly.
  const weight = sorted[Math.min(1, sorted.length - 1)] ?? 0
  return { targetReps: minReps + 2, weight }
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
  if (ex.repRange[0] === 1 && ex.repRange[1] === 1) return { targetReps: 1, weight: 0 }
  if (!progress) return initialTarget(ex, availableWeights)

  const [minReps, maxReps] = ex.repRange
  const { lastWeight, lastTargetReps, lastActualReps, lastFeedback } = progress
  const clampReps = (r: number) => Math.max(minReps, Math.min(maxReps, r))
  const isBodyweight = ex.equipment === 'bodyweight' || lastWeight === 0

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

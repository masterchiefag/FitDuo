import { blockPosition, muscleWords, workBlockName } from '../../core/player/blockName'
import { isWorkBlock } from '../../core/player/position'
import type { MuscleGroup } from '../../core/catalog/types'
import type { WorkoutPlan } from '../../core/generator/types'
import { exercisesById } from './catalog'

export interface BlockNames {
  /** Where it sits: `Block 2 of 4`, `Finisher`, `Warm-up`. */
  position: string
  /** What it works: `back & shoulders`. Null for a block with no movements. */
  words: string | null
  /** The whole name: `Block 2 of 4 — back & shoulders`. */
  full: string
}

/**
 * What to call the block at `blockIndex` on screen.
 *
 * The catalog lookup lives here rather than in core, which may not read it —
 * the naming rule itself is pure and tested in `core/player/blockName.ts`.
 * Returns null past the end of the plan, which is the caller's "Finish".
 */
export function blockNames(plan: WorkoutPlan, blockIndex: number): BlockNames | null {
  const block = plan.blocks[blockIndex]
  if (!block) return null
  if (!isWorkBlock(block)) {
    // Warm-up and cool-down have no label to leak; a mobility block's label is
    // authored ("Posture & Shoulders") and is already the human name.
    const name =
      block.kind === 'warmup'
        ? 'Warm-up'
        : block.kind === 'cooldown'
          ? 'Cool-down stretch'
          : block.label
    return { position: name, words: null, full: name }
  }

  const workBlocks = plan.blocks.filter(isWorkBlock)
  const at = plan.blocks.slice(0, blockIndex).filter(isWorkBlock).length
  const primaries: MuscleGroup[] = block.items.flatMap(
    (item) => exercisesById.get(item.exerciseId)?.primaryMuscles ?? [],
  )
  return {
    position: blockPosition(block.kind, at + 1, workBlocks.length),
    words: muscleWords(primaries),
    full: workBlockName({
      kind: block.kind,
      blockNumber: at + 1,
      blockCount: workBlocks.length,
      primaries,
    }),
  }
}

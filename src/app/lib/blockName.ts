import { blockPosition, muscleWords, regionWords, workBlockName } from '../../core/player/blockName'
import { isWorkBlock } from '../../core/player/position'
import type { MobilityRegion, MuscleGroup } from '../../core/catalog/types'
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

/** One line of the session's shape, in the order it will be run. */
export interface ShapeRow {
  /** `Warm-up`, `Block 2 of 4 — back & shoulders`, `Finisher — quads & core`. */
  name: string
  /** How much of it there is: `× 3 rounds`, `5 moves`. */
  meta: string
  /** The Finisher is the session's peak and the opening may say so. */
  finisher: boolean
}

/**
 * The whole session, block by block — the "shape" half of the opening ritual.
 *
 * Every block is listed, warm-up and stretch included: the shape is what the
 * next hour actually looks like, and a person deciding whether they have time
 * is counting the stretch too.
 *
 * The meta is structural (rounds, moves) rather than a per-block duration on
 * purpose. The plan already carries exactly one number for how long this takes
 * — `estimatedSeconds` — and per-block minutes would be a second set of
 * numbers rounding to something that does not add up to the first.
 */
export function sessionShape(plan: WorkoutPlan): ShapeRow[] {
  return plan.blocks.map((block, index) => {
    const names = blockNames(plan, index)
    const rounds = isWorkBlock(block) ? block.rounds : null
    return {
      name: names?.full ?? 'Block',
      meta:
        rounds === null
          ? `${block.items.length} move${block.items.length === 1 ? '' : 's'}`
          : `× ${rounds} round${rounds === 1 ? '' : 's'}`,
      finisher: block.kind === 'circuit',
    }
  })
}

/**
 * What a mobility session is working on, from the movements it actually chose.
 *
 * Read off the catalog rather than the focus that was picked, because the pick
 * is not on the plan and the budget can leave a region unspent — this way the
 * opening names the session that was generated, not the one that was asked for.
 */
export function mobilityRegions(plan: WorkoutPlan): string | null {
  const regions: MobilityRegion[] = plan.blocks.flatMap((block) =>
    block.kind === 'mobility'
      ? block.items.flatMap((item) => exercisesById.get(item.exerciseId)?.mobility?.regions ?? [])
      : [],
  )
  return regionWords(regions)
}

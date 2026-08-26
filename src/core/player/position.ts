import type { Block, WorkoutPlan } from '../generator/types'
import type { PlayerState } from './types'

/**
 * Where this session is, structurally.
 *
 * Derived from the plan and the player's own cursor — never from how many sets
 * have been logged. A SKIP advances without logging, and an adjusted set logs
 * one row per person, so a count of logs drifts from the shape of the session
 * within one block. The plan already knows exactly how much work is left.
 */
export interface SessionPosition {
  /** 1-based, among the session's WORK blocks — the warm-up is not "block 1". */
  blockNumber: number
  blockCount: number
  /** Sets not yet finished, including one currently under way. */
  setsToGo: number
}

type WorkBlock = Extract<Block, { kind: 'superset' | 'circuit' | 'activate' }>

export function isWorkBlock(block: Block): block is WorkBlock {
  return block.kind === 'superset' || block.kind === 'circuit' || block.kind === 'activate'
}

/** The next set to be performed (or the one in progress), as a plan cursor. */
interface Cursor {
  blockIndex: number
  round: number
  itemIndex: number
}

function firstSetAtOrAfter(plan: WorkoutPlan, blockIndex: number): Cursor | null {
  for (let i = blockIndex; i < plan.blocks.length; i++) {
    if (isWorkBlock(plan.blocks[i]!)) return { blockIndex: i, round: 0, itemIndex: 0 }
  }
  return null
}

function cursorFor(plan: WorkoutPlan, state: PlayerState): Cursor | null {
  switch (state.phase) {
    case 'work':
      return { blockIndex: state.blockIndex, round: state.round, itemIndex: state.itemIndex }
    // Rest and changeover both point at the set they are counting down to.
    case 'rest':
    case 'changeover':
      return { blockIndex: state.blockIndex, round: state.round, itemIndex: state.nextItemIndex }
    case 'block_gate':
      return firstSetAtOrAfter(plan, state.nextBlockIndex)
    case 'block_transition':
      return firstSetAtOrAfter(plan, state.nextBlockIndex)
    // Warm-up and cool-down: the work still ahead starts at the next block.
    case 'timed':
      return firstSetAtOrAfter(plan, state.blockIndex + 1)
    case 'idle':
      return firstSetAtOrAfter(plan, 0)
    default:
      return null
  }
}

export function sessionPosition(plan: WorkoutPlan, state: PlayerState): SessionPosition | null {
  const inner = state.phase === 'paused' ? state.resumeState : state
  const cursor = cursorFor(plan, inner)
  if (!cursor) return null

  const workBlocks = plan.blocks.flatMap((block, index) =>
    isWorkBlock(block) ? [{ block, index }] : [],
  )
  const at = workBlocks.findIndex((w) => w.index === cursor.blockIndex)
  if (at < 0) return null

  let setsToGo = 0
  for (const { block, index } of workBlocks.slice(at)) {
    setsToGo +=
      index === cursor.blockIndex
        ? (block.rounds - cursor.round) * block.items.length - cursor.itemIndex
        : block.rounds * block.items.length
  }

  return {
    blockNumber: at + 1,
    blockCount: workBlocks.length,
    setsToGo: Math.max(0, setsToGo),
  }
}

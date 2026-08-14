import type { Block, WorkoutPlan } from '../generator/types'
import type { Effect, PlayerEvent, PlayerState, SetLogDraft, Transition } from './types'

export const BLOCK_TRANSITION_SECONDS = 20

// ─── plan helpers ────────────────────────────────────────────────────────────

function blockAt(plan: WorkoutPlan, index: number): Block | undefined {
  return plan.blocks[index]
}

function firstWorkBlockIndex(plan: WorkoutPlan): number {
  return plan.blocks.findIndex((b) => b.kind === 'superset' || b.kind === 'circuit')
}

/** Entry state for a given block index (or complete when past the end). */
function enterBlock(plan: WorkoutPlan, blockIndex: number, now: number): Transition {
  const block = blockAt(plan, blockIndex)
  if (!block) {
    return {
      state: { phase: 'complete' },
      effects: [
        { type: 'CUE', sound: 'complete' },
        { type: 'SESSION_COMPLETE', abandoned: false },
        { type: 'PERSIST_SNAPSHOT' },
      ],
    }
  }
  switch (block.kind) {
    case 'warmup': {
      const item = block.items[0]
      if (!item) return enterBlock(plan, blockIndex + 1, now)
      return {
        state: { phase: 'warmup', itemIndex: 0, endsAt: now + item.seconds * 1000 },
        effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
      }
    }
    case 'cooldown': {
      const item = block.items[0]
      if (!item) return enterBlock(plan, blockIndex + 1, now)
      return {
        state: { phase: 'cooldown', itemIndex: 0, endsAt: now + item.seconds * 1000 },
        effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
      }
    }
    case 'superset':
    case 'circuit':
      return {
        state: { phase: 'work', blockIndex, round: 0, itemIndex: 0 },
        effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
      }
  }
}

// ─── timed-phase advancement ─────────────────────────────────────────────────

/** Advance a timed phase whose deadline has passed. */
function advanceTimed(plan: WorkoutPlan, state: PlayerState, now: number): Transition {
  switch (state.phase) {
    case 'warmup': {
      // Warmup is always the first block if present.
      const warmupIndex = plan.blocks.findIndex((b) => b.kind === 'warmup')
      const block = blockAt(plan, warmupIndex)
      if (!block || block.kind !== 'warmup') return enterBlock(plan, warmupIndex + 1, now)
      const next = state.itemIndex + 1
      const item = block.items[next]
      if (item) {
        return {
          state: { phase: 'warmup', itemIndex: next, endsAt: now + item.seconds * 1000 },
          effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
        }
      }
      const workIndex = firstWorkBlockIndex(plan)
      return {
        state: {
          phase: 'block_transition',
          nextBlockIndex: workIndex === -1 ? plan.blocks.length : workIndex,
          endsAt: now + BLOCK_TRANSITION_SECONDS * 1000,
        },
        effects: [{ type: 'CUE', sound: 'rest' }, { type: 'PERSIST_SNAPSHOT' }],
      }
    }
    case 'rest': {
      return {
        state: {
          phase: 'work',
          blockIndex: state.blockIndex,
          round: state.round,
          itemIndex: state.nextItemIndex,
        },
        effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
      }
    }
    case 'block_transition':
      return enterBlock(plan, state.nextBlockIndex, now)
    case 'cooldown': {
      const cooldownIndex = plan.blocks.findIndex((b) => b.kind === 'cooldown')
      const block = blockAt(plan, cooldownIndex)
      if (!block || block.kind !== 'cooldown') return enterBlock(plan, plan.blocks.length, now)
      const next = state.itemIndex + 1
      const item = block.items[next]
      if (item) {
        return {
          state: { phase: 'cooldown', itemIndex: next, endsAt: now + item.seconds * 1000 },
          effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
        }
      }
      return enterBlock(plan, plan.blocks.length, now)
    }
    default:
      return { state, effects: [] }
  }
}

function isTimedPhase(state: PlayerState): state is Extract<PlayerState, { endsAt: number }> {
  return (
    state.phase === 'warmup' ||
    state.phase === 'rest' ||
    state.phase === 'block_transition' ||
    state.phase === 'cooldown'
  )
}

// ─── the reducer ─────────────────────────────────────────────────────────────

export function reduce(plan: WorkoutPlan, state: PlayerState, event: PlayerEvent): Transition {
  switch (event.type) {
    case 'START': {
      if (state.phase !== 'idle') return { state, effects: [] }
      return enterBlock(plan, 0, event.now)
    }

    case 'TIMER_FIRED': {
      if (!isTimedPhase(state) || event.now < state.endsAt) return { state, effects: [] }
      // Fast-forward: chain through as many expired timed phases as needed
      // (e.g. the tab was backgrounded across several warmup items).
      let t = advanceTimed(plan, state, state.endsAt)
      const effects: Effect[] = [...t.effects]
      while (isTimedPhase(t.state) && t.state.endsAt <= event.now) {
        const next = advanceTimed(plan, t.state, t.state.endsAt)
        effects.push(...next.effects)
        t = next
      }
      return { state: t.state, effects }
    }

    case 'SET_DONE': {
      if (state.phase !== 'work') return { state, effects: [] }
      const block = blockAt(plan, state.blockIndex)
      if (!block || (block.kind !== 'superset' && block.kind !== 'circuit'))
        return { state, effects: [] }
      const item = block.items[state.itemIndex]
      if (!item) return { state, effects: [] }

      const effects: Effect[] = Object.entries(item.perPerson).map(([userId, target]) => {
        const override = event.overrides?.[userId]
        const log: SetLogDraft = {
          userId,
          exerciseId: item.exerciseId,
          blockIndex: state.blockIndex,
          setIndex: state.round,
          targetReps: target.targetReps,
          actualReps: override?.targetReps ?? target.targetReps,
          weight: override?.weight ?? target.weight,
          loggedAt: event.now,
        }
        return { type: 'LOG_SET', log }
      })

      const nextItem = state.itemIndex + 1
      if (nextItem < block.items.length) {
        // Superset/circuit: next exercise immediately, rest comes after the round.
        return {
          state: {
            phase: 'work',
            blockIndex: state.blockIndex,
            round: state.round,
            itemIndex: nextItem,
          },
          effects: [...effects, { type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
        }
      }
      const nextRound = state.round + 1
      if (nextRound < block.rounds) {
        return {
          state: {
            phase: 'rest',
            blockIndex: state.blockIndex,
            round: nextRound,
            nextItemIndex: 0,
            endsAt: event.now + block.restSeconds * 1000,
          },
          effects: [...effects, { type: 'CUE', sound: 'rest' }, { type: 'PERSIST_SNAPSHOT' }],
        }
      }
      const nextBlock = state.blockIndex + 1
      const upcoming = blockAt(plan, nextBlock)
      if (!upcoming) {
        const done = enterBlock(plan, plan.blocks.length, event.now)
        return { state: done.state, effects: [...effects, ...done.effects] }
      }
      return {
        state: {
          phase: 'block_transition',
          nextBlockIndex: nextBlock,
          endsAt: event.now + BLOCK_TRANSITION_SECONDS * 1000,
        },
        effects: [...effects, { type: 'CUE', sound: 'rest' }, { type: 'PERSIST_SNAPSHOT' }],
      }
    }

    case 'SKIP': {
      if (isTimedPhase(state))
        return reduce(
          plan,
          { ...state, endsAt: event.now },
          { type: 'TIMER_FIRED', now: event.now },
        )
      if (state.phase === 'work') {
        // Skipping work advances without logging sets.
        const noLog = reduce(plan, state, { type: 'SET_DONE', now: event.now })
        return { state: noLog.state, effects: noLog.effects.filter((e) => e.type !== 'LOG_SET') }
      }
      return { state, effects: [] }
    }

    case 'EXTEND_REST': {
      if (state.phase !== 'rest') return { state, effects: [] }
      return {
        state: { ...state, endsAt: state.endsAt + event.seconds * 1000 },
        effects: [{ type: 'PERSIST_SNAPSHOT' }],
      }
    }

    case 'FEEDBACK':
      return {
        state,
        effects: [
          {
            type: 'LOG_FEEDBACK',
            userId: event.userId,
            exerciseId: event.exerciseId,
            rating: event.rating,
            loggedAt: event.now,
          },
          { type: 'PERSIST_SNAPSHOT' },
        ],
      }

    case 'PAUSE': {
      if (state.phase === 'paused' || state.phase === 'idle' || state.phase === 'complete')
        return { state, effects: [] }
      return {
        state: { phase: 'paused', resumeState: state, pausedAt: event.now },
        effects: [{ type: 'PERSIST_SNAPSHOT' }],
      }
    }

    case 'RESUME': {
      if (state.phase !== 'paused') return { state, effects: [] }
      const inner = state.resumeState
      const resumed = isTimedPhase(inner)
        ? { ...inner, endsAt: event.now + Math.max(0, inner.endsAt - state.pausedAt) }
        : inner
      return { state: resumed, effects: [{ type: 'PERSIST_SNAPSHOT' }] }
    }

    case 'ABANDON': {
      if (state.phase === 'idle' || state.phase === 'complete') return { state, effects: [] }
      return {
        state: { phase: 'complete' },
        effects: [{ type: 'SESSION_COMPLETE', abandoned: true }, { type: 'PERSIST_SNAPSHOT' }],
      }
    }
  }
}

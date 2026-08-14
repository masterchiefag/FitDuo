import type { Block, WorkoutPlan } from '../generator/types'
import type { Effect, PlayerEvent, PlayerState, SetLogDraft, Transition } from './types'

export const BLOCK_TRANSITION_SECONDS = 20

/**
 * How far past a deadline still counts as "we were here".
 *
 * The live tick fires every 250ms, so a real session never exceeds this. A
 * bigger gap means the tab was hidden, the lid was closed, or the app was
 * killed and resumed — and in that case the app must NOT fast-forward through
 * the phases and bank a session nobody did. It pauses where it stood instead.
 */
export const LATE_TIMER_GRACE_MS = 15_000

// ─── plan helpers ────────────────────────────────────────────────────────────

function blockAt(plan: WorkoutPlan, index: number): Block | undefined {
  return plan.blocks[index]
}

type TimedBlock = Extract<Block, { kind: 'warmup' | 'mobility' | 'cooldown' }>

export function isTimedBlock(block: Block): block is TimedBlock {
  return block.kind === 'warmup' || block.kind === 'mobility' || block.kind === 'cooldown'
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
  if (isTimedBlock(block)) {
    const item = block.items[0]
    if (!item) return enterBlock(plan, blockIndex + 1, now)
    return {
      state: { phase: 'timed', blockIndex, itemIndex: 0, endsAt: now + item.seconds * 1000 },
      effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
    }
  }
  return {
    state: { phase: 'work', blockIndex, round: 0, itemIndex: 0 },
    effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
  }
}

// ─── timed-phase advancement ─────────────────────────────────────────────────

/** Advance a timed phase whose deadline has passed. */
function advanceTimed(plan: WorkoutPlan, state: PlayerState, now: number): Transition {
  switch (state.phase) {
    case 'timed': {
      const block = blockAt(plan, state.blockIndex)
      if (!block || !isTimedBlock(block)) return enterBlock(plan, state.blockIndex + 1, now)
      const next = state.itemIndex + 1
      const item = block.items[next]
      if (item) {
        return {
          state: {
            phase: 'timed',
            blockIndex: state.blockIndex,
            itemIndex: next,
            endsAt: now + item.seconds * 1000,
          },
          effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
        }
      }
      // Block finished. A following block always gets its transition pause;
      // the next block may be timed (mobility flow) or work.
      const nextBlockIndex = state.blockIndex + 1
      if (!blockAt(plan, nextBlockIndex)) return enterBlock(plan, nextBlockIndex, now)
      return {
        state: {
          phase: 'block_transition',
          nextBlockIndex,
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
    default:
      return { state, effects: [] }
  }
}

/** The phase's own full length, used to restart a phase that expired unattended. */
function fullDurationOf(
  plan: WorkoutPlan,
  state: Extract<PlayerState, { endsAt: number }>,
): number {
  if (state.phase === 'timed') {
    const block = blockAt(plan, state.blockIndex)
    const item = block && isTimedBlock(block) ? block.items[state.itemIndex] : undefined
    return (item?.seconds ?? 1) * 1000
  }
  if (state.phase === 'rest') {
    const block = blockAt(plan, state.blockIndex)
    const rest =
      block && (block.kind === 'superset' || block.kind === 'circuit') ? block.restSeconds : 1
    return rest * 1000
  }
  return BLOCK_TRANSITION_SECONDS * 1000
}

function isTimedPhase(state: PlayerState): state is Extract<PlayerState, { endsAt: number }> {
  return state.phase === 'timed' || state.phase === 'rest' || state.phase === 'block_transition'
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
      // Arrived late (backgrounded tab, closed lid, resume after kill): freeze
      // where we stood rather than crediting work that was never done.
      if (event.now - state.endsAt > LATE_TIMER_GRACE_MS) {
        return {
          state: { phase: 'paused', resumeState: state, pausedAt: event.now },
          effects: [{ type: 'PERSIST_SNAPSHOT' }],
        }
      }
      // On time: advance, chaining through any phases that elapsed within the
      // grace window.
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
      // A phase paused because it had ALREADY expired (the late-timer rule)
      // was never performed — restart it in full rather than resuming with
      // zero remaining, which would instantly advance past it.
      let resumed: PlayerState = inner
      if (isTimedPhase(inner)) {
        const remaining = inner.endsAt - state.pausedAt
        resumed = {
          ...inner,
          endsAt: event.now + (remaining > 0 ? remaining : fullDurationOf(plan, inner)),
        }
      }
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

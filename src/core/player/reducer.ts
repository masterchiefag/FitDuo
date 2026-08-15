import type { Block, WorkoutPlan } from '../generator/types'
import type { Effect, Overrides, PlayerEvent, PlayerState, SetLogDraft, Transition } from './types'

export const BLOCK_TRANSITION_SECONDS = 20

/**
 * Swapping dumbbells between two different exercises inside a round. Short on
 * purpose: it is a changeover, not a rest — the rest sits on the round
 * boundary, where the round actually ends.
 */
export const CHANGEOVER_SECONDS = 15

/**
 * How long a block gate waits for a human before concluding there isn't one.
 *
 * The gate is the session's only required interaction (~4 taps), so it is also
 * the only place that can tell "training" from "the laptop is alone in an empty
 * room". Generous, because putting the dumbbells away between blocks is normal.
 */
export const GATE_PAUSE_MS = 5 * 60_000

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

type WorkBlock = Extract<Block, { kind: 'superset' | 'circuit' }>
type TimedBlock = Extract<Block, { kind: 'warmup' | 'mobility' | 'cooldown' }>

function blockAt(plan: WorkoutPlan, index: number): Block | undefined {
  return plan.blocks[index]
}

export function isTimedBlock(block: Block): block is TimedBlock {
  return block.kind === 'warmup' || block.kind === 'mobility' || block.kind === 'cooldown'
}

function workBlockAt(plan: WorkoutPlan, index: number): WorkBlock | undefined {
  const b = blockAt(plan, index)
  return b && (b.kind === 'superset' || b.kind === 'circuit') ? b : undefined
}

const completed = (): Transition => ({
  state: { phase: 'complete' },
  effects: [
    { type: 'CUE', sound: 'complete' },
    { type: 'SESSION_COMPLETE', abandoned: false },
    { type: 'PERSIST_SNAPSHOT' },
  ],
})

/** Start one set on its own clock — the follow-along contract in one place. */
function enterWork(
  plan: WorkoutPlan,
  blockIndex: number,
  round: number,
  itemIndex: number,
  now: number,
): Transition {
  const block = workBlockAt(plan, blockIndex)
  const item = block?.items[itemIndex]
  if (!block || !item) return enterBlock(plan, blockIndex + 1, now)
  return {
    state: {
      phase: 'work',
      blockIndex,
      round,
      itemIndex,
      endsAt: now + item.workSeconds * 1000,
    },
    effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
  }
}

/** Entry state for a given block index (or complete when past the end). */
function enterBlock(plan: WorkoutPlan, blockIndex: number, now: number): Transition {
  const block = blockAt(plan, blockIndex)
  if (!block) return completed()
  if (isTimedBlock(block)) {
    const item = block.items[0]
    if (!item) return enterBlock(plan, blockIndex + 1, now)
    return {
      state: { phase: 'timed', blockIndex, itemIndex: 0, endsAt: now + item.seconds * 1000 },
      effects: [{ type: 'CUE', sound: 'go' }, { type: 'PERSIST_SNAPSHOT' }],
    }
  }
  return enterWork(plan, blockIndex, 0, 0, now)
}

function openGate(blockIndex: number, now: number): Transition {
  return {
    state: {
      phase: 'block_gate',
      blockIndex,
      nextBlockIndex: blockIndex + 1,
      pauseAt: now + GATE_PAUSE_MS,
      ratings: {},
    },
    effects: [{ type: 'CUE', sound: 'rest' }, { type: 'PERSIST_SNAPSHOT' }],
  }
}

// ─── logging a set ───────────────────────────────────────────────────────────

/**
 * Finish the current set and move on. The ONE path out of a work phase that
 * logs, shared by timer expiry and an early SET_DONE — so the pending ADJUST is
 * consumed exactly once, whichever way the set ends, and is gone afterwards
 * because it lived on the state we are leaving.
 */
function completeSet(
  plan: WorkoutPlan,
  state: Extract<PlayerState, { phase: 'work' }>,
  now: number,
  extra?: Overrides,
): Transition {
  const block = workBlockAt(plan, state.blockIndex)
  const item = block?.items[state.itemIndex]
  if (!block || !item) return { state, effects: [] }

  const overrides: Overrides = { ...state.overrides, ...extra }
  const effects: Effect[] = Object.entries(item.perPerson).map(([userId, target]) => {
    const override = overrides[userId]
    const log: SetLogDraft = {
      userId,
      exerciseId: item.exerciseId,
      blockIndex: state.blockIndex,
      setIndex: state.round,
      targetReps: target.targetReps,
      actualReps: override?.targetReps ?? target.targetReps,
      weight: override?.weight ?? target.weight,
      loggedAt: now,
      // Nobody corrected this one, so it is the app's word, not theirs.
      assumed: override === undefined,
    }
    return { type: 'LOG_SET', log }
  })

  const next = advancePastSet(plan, state, now)
  return { state: next.state, effects: [...effects, ...next.effects] }
}

/** Where the session goes after a set ends — logged or skipped, same edges. */
function advancePastSet(
  plan: WorkoutPlan,
  state: Extract<PlayerState, { phase: 'work' }>,
  now: number,
): Transition {
  const block = workBlockAt(plan, state.blockIndex)
  if (!block) return enterBlock(plan, state.blockIndex + 1, now)
  const nextIndex = state.itemIndex + 1
  const current = block.items[state.itemIndex]
  const next = block.items[nextIndex]
  if (next) {
    // Same movement twice in a row needs no changeover — nothing to swap.
    if (current && next.exerciseId === current.exerciseId)
      return enterWork(plan, state.blockIndex, state.round, nextIndex, now)
    return {
      state: {
        phase: 'changeover',
        blockIndex: state.blockIndex,
        round: state.round,
        nextItemIndex: nextIndex,
        endsAt: now + CHANGEOVER_SECONDS * 1000,
      },
      effects: [{ type: 'CUE', sound: 'rest' }, { type: 'PERSIST_SNAPSHOT' }],
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
        endsAt: now + block.restSeconds * 1000,
      },
      effects: [{ type: 'CUE', sound: 'rest' }, { type: 'PERSIST_SNAPSHOT' }],
    }
  }
  // The block is done. This edge — and only this one — is the presence check.
  return openGate(state.blockIndex, now)
}

// ─── timed-phase advancement ─────────────────────────────────────────────────

/** Advance a phase whose deadline has passed. */
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
    case 'work':
      // The set ran its course: log it and move on. Nobody had to touch anything.
      return completeSet(plan, state, now)
    case 'changeover':
      return enterWork(plan, state.blockIndex, state.round, state.nextItemIndex, now)
    case 'rest':
      return enterWork(plan, state.blockIndex, state.round, state.nextItemIndex, now)
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
  switch (state.phase) {
    case 'timed': {
      const block = blockAt(plan, state.blockIndex)
      const item = block && isTimedBlock(block) ? block.items[state.itemIndex] : undefined
      return (item?.seconds ?? 1) * 1000
    }
    case 'work': {
      const item = workBlockAt(plan, state.blockIndex)?.items[state.itemIndex]
      return (item?.workSeconds ?? 1) * 1000
    }
    case 'changeover':
      return CHANGEOVER_SECONDS * 1000
    case 'rest':
      return (workBlockAt(plan, state.blockIndex)?.restSeconds ?? 1) * 1000
    default:
      return BLOCK_TRANSITION_SECONDS * 1000
  }
}

function isTimedPhase(state: PlayerState): state is Extract<PlayerState, { endsAt: number }> {
  return (
    state.phase === 'timed' ||
    state.phase === 'work' ||
    state.phase === 'changeover' ||
    state.phase === 'rest' ||
    state.phase === 'block_transition'
  )
}

const pauseOn = (inner: PlayerState, now: number): Transition => ({
  state: { phase: 'paused', resumeState: inner, pausedAt: now },
  effects: [{ type: 'PERSIST_SNAPSHOT' }],
})

// ─── the reducer ─────────────────────────────────────────────────────────────

export function reduce(plan: WorkoutPlan, state: PlayerState, event: PlayerEvent): Transition {
  switch (event.type) {
    case 'START': {
      if (state.phase !== 'idle') return { state, effects: [] }
      return enterBlock(plan, 0, event.now)
    }

    case 'TIMER_FIRED': {
      // The gate waits for a person, it does not expire into the next block.
      // Long enough unanswered and the honest conclusion is that nobody is here.
      if (state.phase === 'block_gate') {
        if (event.now < state.pauseAt) return { state, effects: [] }
        return pauseOn(state, event.now)
      }
      if (!isTimedPhase(state) || event.now < state.endsAt) return { state, effects: [] }
      // Arrived late (backgrounded tab, closed lid, resume after kill): freeze
      // where we stood rather than crediting work that was never done.
      if (event.now - state.endsAt > LATE_TIMER_GRACE_MS) return pauseOn(state, event.now)
      // On time: advance, chaining through any phases that elapsed within the
      // grace window.
      let t = advanceTimed(plan, state, state.endsAt)
      const effects: Effect[] = [...t.effects]
      while (isTimedPhase(t.state) && t.state.endsAt <= event.now) {
        // A work phase is a set a human has to actually perform. Fast-forwarding
        // one would log reps nobody did — stop at the boundary and pause.
        if (t.state.phase === 'work') {
          const paused = pauseOn(t.state, event.now)
          return { state: paused.state, effects: [...effects, ...paused.effects] }
        }
        const next = advanceTimed(plan, t.state, t.state.endsAt)
        effects.push(...next.effects)
        t = next
      }
      return { state: t.state, effects }
    }

    case 'ADJUST': {
      if (state.phase !== 'work') return { state, effects: [] }
      const prev = state.overrides?.[event.userId]
      return {
        state: {
          ...state,
          overrides: { ...state.overrides, [event.userId]: { ...prev, ...event.target } },
        },
        effects: [{ type: 'PERSIST_SNAPSHOT' }],
      }
    }

    case 'SET_DONE': {
      if (state.phase !== 'work') return { state, effects: [] }
      return completeSet(plan, state, event.now, event.overrides)
    }

    case 'CONTINUE': {
      if (state.phase !== 'block_gate') return { state, effects: [] }
      const block = workBlockAt(plan, state.blockIndex)
      // Unrated + Continue records 'right': a human confirmed the block, and a
      // block that never produces feedback is a block progression cannot move.
      const assumedRatings: Effect[] = (block?.items ?? []).flatMap((item) =>
        Object.keys(item.perPerson)
          .filter((userId) => state.ratings[`${userId}:${item.exerciseId}`] === undefined)
          .map<Effect>((userId) => ({
            type: 'LOG_FEEDBACK',
            userId,
            exerciseId: item.exerciseId,
            rating: 'right',
            loggedAt: event.now,
          })),
      )
      const next = enterBlock(plan, state.nextBlockIndex, event.now)
      return { state: next.state, effects: [...assumedRatings, ...next.effects] }
    }

    case 'FINISH_EARLY': {
      // "Cut it short": an explicit completion at a block boundary, not an
      // abandon — everything past this block was simply never programmed.
      if (state.phase !== 'block_gate') return { state, effects: [] }
      return {
        state: { phase: 'complete' },
        effects: [
          { type: 'CUE', sound: 'complete' },
          {
            type: 'SESSION_COMPLETE',
            abandoned: false,
            plannedThroughBlockIndex: state.blockIndex,
          },
          { type: 'PERSIST_SNAPSHOT' },
        ],
      }
    }

    case 'SKIP': {
      // Checked before the timed-phase branch: work is timed now, and taking
      // the expiry path here would log a set that was explicitly skipped.
      if (state.phase === 'work') return advancePastSet(plan, state, event.now)
      if (isTimedPhase(state))
        return reduce(
          plan,
          { ...state, endsAt: event.now },
          { type: 'TIMER_FIRED', now: event.now },
        )
      return { state, effects: [] }
    }

    case 'EXTEND': {
      if (state.phase !== 'rest' && state.phase !== 'work') return { state, effects: [] }
      return {
        state: { ...state, endsAt: state.endsAt + event.seconds * 1000 },
        effects: [{ type: 'PERSIST_SNAPSHOT' }],
      }
    }

    case 'FEEDBACK': {
      const effects: Effect[] = [
        {
          type: 'LOG_FEEDBACK',
          userId: event.userId,
          exerciseId: event.exerciseId,
          rating: event.rating,
          loggedAt: event.now,
        },
        { type: 'PERSIST_SNAPSHOT' },
      ]
      // Remember it on the gate so Continue does not also assume 'right' here.
      if (state.phase === 'block_gate') {
        return {
          state: {
            ...state,
            ratings: { ...state.ratings, [`${event.userId}:${event.exerciseId}`]: event.rating },
          },
          effects,
        }
      }
      return { state, effects }
    }

    case 'PAUSE': {
      if (state.phase === 'paused' || state.phase === 'idle' || state.phase === 'complete')
        return { state, effects: [] }
      return pauseOn(state, event.now)
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
      } else if (inner.phase === 'block_gate') {
        resumed = { ...inner, pauseAt: event.now + GATE_PAUSE_MS }
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

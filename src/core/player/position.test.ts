import { describe, expect, it } from 'vitest'
import { reduce } from './reducer'
import { sessionPosition } from './position'
import type { PlayerEvent, PlayerState } from './types'
import type { WorkoutPlan } from '../generator/types'

const P1 = 'user-a'
const t = (reps: number, weight: number) => ({ targetReps: reps, weight })
const work = (exerciseId: string) => ({
  exerciseId,
  perPerson: { [P1]: t(10, 7.5) },
  workSeconds: 40,
})

/** 2 work blocks: 2 items × 2 rounds, then 3 items × 2 rounds = 10 sets. */
const plan: WorkoutPlan = {
  planVersion: 1,
  seed: 1,
  dateISO: '2026-08-16',
  mode: 'full',
  dayType: 'full_a',
  participantIds: [P1],
  estimatedSeconds: 1200,
  blocks: [
    { kind: 'warmup', items: [{ exerciseId: 'arm-circles', seconds: 40 }] },
    {
      kind: 'superset',
      label: 'Strength A',
      rounds: 2,
      restSeconds: 75,
      items: [work('db-squat'), work('db-row')],
    },
    {
      kind: 'circuit',
      label: 'Finisher',
      rounds: 2,
      restSeconds: 60,
      items: [work('db-lunge'), work('plank'), work('db-curl')],
    },
    { kind: 'cooldown', items: [{ exerciseId: 'childs-pose', seconds: 60 }] },
  ],
}

const TOTAL_SETS = 10

describe('sessionPosition', () => {
  it('counts work blocks only — the warm-up is not block 1', () => {
    const atFinisher = sessionPosition(plan, {
      phase: 'work',
      blockIndex: 2,
      round: 0,
      itemIndex: 0,
      endsAt: 0,
    })
    expect(atFinisher).toEqual({ blockNumber: 2, blockCount: 2, setsToGo: 6 })
  })

  it('knows the whole session before it starts, and during the warm-up', () => {
    const expected = { blockNumber: 1, blockCount: 2, setsToGo: TOTAL_SETS }
    expect(sessionPosition(plan, { phase: 'idle' })).toEqual(expected)
    expect(
      sessionPosition(plan, { phase: 'timed', blockIndex: 0, itemIndex: 0, endsAt: 0 }),
    ).toEqual(expected)
  })

  it('counts from the set a rest is counting down to', () => {
    // Round 1 of Strength A is done: 2 sets left there, plus all 6 finisher sets.
    expect(
      sessionPosition(plan, {
        phase: 'rest',
        blockIndex: 1,
        round: 1,
        nextItemIndex: 0,
        endsAt: 0,
      }),
    ).toEqual({ blockNumber: 1, blockCount: 2, setsToGo: 8 })
  })

  it('reads the block gate as standing at the start of the next block', () => {
    expect(
      sessionPosition(plan, {
        phase: 'block_gate',
        blockIndex: 1,
        nextBlockIndex: 2,
        pauseAt: 0,
        ratings: {},
      }),
    ).toEqual({ blockNumber: 2, blockCount: 2, setsToGo: 6 })
  })

  it('sees through a pause to the phase underneath', () => {
    const inner: PlayerState = {
      phase: 'rest',
      blockIndex: 1,
      round: 1,
      nextItemIndex: 1,
      endsAt: 0,
    }
    expect(sessionPosition(plan, { phase: 'paused', resumeState: inner, pausedAt: 0 })).toEqual(
      sessionPosition(plan, inner),
    )
  })

  /**
   * The reason this is structural and not a count of logged sets: SKIP advances
   * without logging anything. Driven through a whole session on skips alone,
   * the countdown still has to be 10, 9, 8 … 1 — while the log stays empty.
   */
  it('does not drift when sets are skipped rather than logged', () => {
    let state: PlayerState = { phase: 'idle' }
    let logs = 0
    const seen: number[] = []
    const step = (from: PlayerState, event: PlayerEvent): PlayerState => {
      const out = reduce(plan, from, event)
      logs += out.effects.filter((e) => e.type === 'LOG_SET').length
      return out.state
    }

    state = step(state, { type: 'START', now: 0 })
    for (let i = 0; i < 200 && state.phase !== 'complete'; i++) {
      if (state.phase === 'work') seen.push(sessionPosition(plan, state)!.setsToGo)
      state = step(
        state,
        state.phase === 'block_gate'
          ? { type: 'CONTINUE', now: i + 1 }
          : { type: 'SKIP', now: i + 1 },
      )
    }

    expect(state.phase).toBe('complete')
    expect(logs).toBe(0)
    expect(seen).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })
})

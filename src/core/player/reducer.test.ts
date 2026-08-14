import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { BLOCK_TRANSITION_SECONDS, reduce } from './reducer'
import type { PlayerEvent, PlayerState } from './types'
import type { WorkoutPlan } from '../generator/types'

const P1 = 'user-a'
const P2 = 'user-b'
const t = (reps: number, weight: number) => ({ targetReps: reps, weight })

const plan: WorkoutPlan = {
  planVersion: 1,
  seed: 42,
  dateISO: '2026-08-14',
  dayType: 'full_a',
  participantIds: [P1, P2],
  estimatedSeconds: 3300,
  blocks: [
    {
      kind: 'warmup',
      items: [
        { exerciseId: 'arm-circles', seconds: 40 },
        { exerciseId: 'inchworm', seconds: 40 },
      ],
    },
    {
      kind: 'superset',
      label: 'Strength A',
      rounds: 2,
      restSeconds: 75,
      items: [
        { exerciseId: 'db-squat', perPerson: { [P1]: t(10, 10), [P2]: t(12, 5) } },
        { exerciseId: 'db-bent-over-row', perPerson: { [P1]: t(10, 10), [P2]: t(12, 5) } },
      ],
    },
    {
      kind: 'circuit',
      label: 'Finisher',
      rounds: 2,
      restSeconds: 60,
      items: [
        { exerciseId: 'db-lunge', perPerson: { [P1]: t(8, 7.5), [P2]: t(10, 2.5) } },
        { exerciseId: 'plank', perPerson: { [P1]: t(1, 0), [P2]: t(1, 0) } },
      ],
    },
    { kind: 'cooldown', items: [{ exerciseId: 'childs-pose', seconds: 60 }] },
  ],
}

const idle: PlayerState = { phase: 'idle' }

function run(events: PlayerEvent[], from: PlayerState = idle) {
  let state = from
  const effects = []
  for (const ev of events) {
    const t = reduce(plan, state, ev)
    state = t.state
    effects.push(...t.effects)
  }
  return { state, effects }
}

describe('player reducer', () => {
  it('START enters warmup with a wall-clock deadline', () => {
    const { state } = run([{ type: 'START', now: 1000 }])
    expect(state).toEqual({ phase: 'timed', blockIndex: 0, itemIndex: 0, endsAt: 1000 + 40_000 })
  })

  it('TIMER_FIRED before the deadline is a no-op', () => {
    const { state } = run([
      { type: 'START', now: 0 },
      { type: 'TIMER_FIRED', now: 39_999 },
    ])
    expect(state).toEqual({ phase: 'timed', blockIndex: 0, itemIndex: 0, endsAt: 40_000 })
  })

  it('warmup items advance, then a block transition leads into work', () => {
    const { state } = run([
      { type: 'START', now: 0 },
      { type: 'TIMER_FIRED', now: 40_000 },
      { type: 'TIMER_FIRED', now: 80_000 },
      { type: 'TIMER_FIRED', now: 80_000 + BLOCK_TRANSITION_SECONDS * 1000 },
    ])
    expect(state).toEqual({ phase: 'work', blockIndex: 1, round: 0, itemIndex: 0 })
  })

  it('SET_DONE logs one set per participant at their own targets', () => {
    const workState: PlayerState = { phase: 'work', blockIndex: 1, round: 0, itemIndex: 0 }
    const { effects } = run([{ type: 'SET_DONE', now: 500 }], workState)
    const logs = effects.filter((e) => e.type === 'LOG_SET')
    expect(logs).toHaveLength(2)
    expect(logs[0]!.log).toMatchObject({
      userId: P1,
      exerciseId: 'db-squat',
      actualReps: 10,
      weight: 10,
    })
    expect(logs[1]!.log).toMatchObject({
      userId: P2,
      exerciseId: 'db-squat',
      actualReps: 12,
      weight: 5,
    })
  })

  it('SET_DONE applies per-person overrides', () => {
    const workState: PlayerState = { phase: 'work', blockIndex: 1, round: 0, itemIndex: 0 }
    const { effects } = run(
      [{ type: 'SET_DONE', now: 500, overrides: { [P2]: { targetReps: 8 } } }],
      workState,
    )
    const logs = effects.filter((e) => e.type === 'LOG_SET')
    expect(logs[1]!.log).toMatchObject({ userId: P2, actualReps: 8, targetReps: 12, weight: 5 })
  })

  it('superset: A -> B directly, then rest, then next round', () => {
    const a: PlayerState = { phase: 'work', blockIndex: 1, round: 0, itemIndex: 0 }
    const afterA = reduce(plan, a, { type: 'SET_DONE', now: 0 })
    expect(afterA.state).toEqual({ phase: 'work', blockIndex: 1, round: 0, itemIndex: 1 })
    const afterB = reduce(plan, afterA.state, { type: 'SET_DONE', now: 1000 })
    expect(afterB.state).toEqual({
      phase: 'rest',
      blockIndex: 1,
      round: 1,
      nextItemIndex: 0,
      endsAt: 1000 + 75_000,
    })
    const backToWork = reduce(plan, afterB.state, { type: 'TIMER_FIRED', now: 76_000 })
    expect(backToWork.state).toEqual({ phase: 'work', blockIndex: 1, round: 1, itemIndex: 0 })
  })

  it('finishing the last round of a block moves to the next block', () => {
    const lastSet: PlayerState = { phase: 'work', blockIndex: 1, round: 1, itemIndex: 1 }
    const { state } = run([{ type: 'SET_DONE', now: 0 }], lastSet)
    expect(state).toEqual({
      phase: 'block_transition',
      nextBlockIndex: 2,
      endsAt: BLOCK_TRANSITION_SECONDS * 1000,
    })
  })

  it('finishing the final cooldown item completes the session', () => {
    const lastStretch: PlayerState = { phase: 'timed', blockIndex: 3, itemIndex: 0, endsAt: 60_000 }
    const { state, effects } = run([{ type: 'TIMER_FIRED', now: 60_000 }], lastStretch)
    expect(state).toEqual({ phase: 'complete' })
    expect(effects.some((e) => e.type === 'SESSION_COMPLETE' && !e.abandoned)).toBe(true)
  })

  it('fast-forwards through several expired phases after backgrounding', () => {
    // Backgrounded from mid-warmup straight past both items + transition.
    const { state } = run([
      { type: 'START', now: 0 },
      { type: 'TIMER_FIRED', now: 500_000 },
    ])
    // Lands in untimed work (fast-forward cannot pass work — a human must tap).
    expect(state).toEqual({ phase: 'work', blockIndex: 1, round: 0, itemIndex: 0 })
  })

  it('pause/resume preserves remaining time', () => {
    const { state } = run([
      { type: 'START', now: 0 }, // warmup ends at 40s
      { type: 'PAUSE', now: 10_000 }, // 30s remaining
      { type: 'RESUME', now: 100_000 },
    ])
    expect(state).toEqual({ phase: 'timed', blockIndex: 0, itemIndex: 0, endsAt: 130_000 })
  })

  it('SKIP during rest starts work immediately', () => {
    const rest: PlayerState = {
      phase: 'rest',
      blockIndex: 1,
      round: 1,
      nextItemIndex: 0,
      endsAt: 99_000,
    }
    const { state } = run([{ type: 'SKIP', now: 50_000 }], rest)
    expect(state).toEqual({ phase: 'work', blockIndex: 1, round: 1, itemIndex: 0 })
  })

  it('SKIP during work advances without logging', () => {
    const work: PlayerState = { phase: 'work', blockIndex: 1, round: 0, itemIndex: 0 }
    const { state, effects } = run([{ type: 'SKIP', now: 0 }], work)
    expect(state).toEqual({ phase: 'work', blockIndex: 1, round: 0, itemIndex: 1 })
    expect(effects.filter((e) => e.type === 'LOG_SET')).toHaveLength(0)
  })

  it('EXTEND_REST pushes the deadline', () => {
    const rest: PlayerState = {
      phase: 'rest',
      blockIndex: 1,
      round: 1,
      nextItemIndex: 0,
      endsAt: 10_000,
    }
    const { state } = run([{ type: 'EXTEND_REST', now: 5000, seconds: 15 }], rest)
    expect(state).toMatchObject({ phase: 'rest', endsAt: 25_000 })
  })

  it('ABANDON completes with abandoned flag', () => {
    const work: PlayerState = { phase: 'work', blockIndex: 1, round: 0, itemIndex: 0 }
    const { state, effects } = run([{ type: 'ABANDON', now: 0 }], work)
    expect(state).toEqual({ phase: 'complete' })
    expect(effects.some((e) => e.type === 'SESSION_COMPLETE' && e.abandoned)).toBe(true)
  })

  it('fuzz: random event sequences never reach an invalid state or throw', () => {
    const eventArb: fc.Arbitrary<PlayerEvent> = fc.oneof(
      fc.record({ type: fc.constant('START' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('SET_DONE' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('TIMER_FIRED' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('SKIP' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('PAUSE' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('RESUME' as const), now: fc.nat() }),
      fc.record({
        type: fc.constant('EXTEND_REST' as const),
        now: fc.nat(),
        seconds: fc.integer({ min: 1, max: 60 }),
      }),
      fc.record({ type: fc.constant('ABANDON' as const), now: fc.nat() }),
    )
    const phases = new Set([
      'idle',
      'timed',
      'work',
      'rest',
      'block_transition',
      'paused',
      'complete',
    ])
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 60 }), (events) => {
        let state: PlayerState = idle
        for (const ev of events) {
          const t = reduce(plan, state, ev)
          state = t.state
          expect(phases.has(state.phase)).toBe(true)
          if (state.phase === 'work') {
            const block = plan.blocks[state.blockIndex]
            expect(block && (block.kind === 'superset' || block.kind === 'circuit')).toBe(true)
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  BLOCK_TRANSITION_SECONDS,
  CHANGEOVER_SECONDS,
  GATE_PAUSE_MS,
  LATE_TIMER_GRACE_MS,
  reduce,
} from './reducer'
import type { Effect, PlayerEvent, PlayerState } from './types'
import type { WorkoutPlan } from '../generator/types'

const P1 = 'user-a'
const P2 = 'user-b'
const t = (reps: number, weight: number) => ({ targetReps: reps, weight })

const WORK_S = 45

const plan: WorkoutPlan = {
  planVersion: 1,
  seed: 42,
  dateISO: '2026-08-14',
  mode: 'full',
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
        {
          exerciseId: 'db-squat',
          perPerson: { [P1]: t(10, 10), [P2]: t(12, 5) },
          workSeconds: WORK_S,
        },
        {
          exerciseId: 'db-bent-over-row',
          perPerson: { [P1]: t(10, 10), [P2]: t(12, 5) },
          workSeconds: WORK_S,
        },
      ],
    },
    {
      kind: 'circuit',
      label: 'Finisher',
      rounds: 2,
      restSeconds: 60,
      items: [
        {
          exerciseId: 'db-lunge',
          perPerson: { [P1]: t(8, 7.5), [P2]: t(10, 2.5) },
          workSeconds: WORK_S,
        },
        { exerciseId: 'plank', perPerson: { [P1]: t(1, 0), [P2]: t(1, 0) }, workSeconds: 40 },
      ],
    },
    { kind: 'cooldown', items: [{ exerciseId: 'childs-pose', seconds: 60 }] },
  ],
}

const idle: PlayerState = { phase: 'idle' }

/** Mid-block work state, on the clock. */
const workAt = (blockIndex: number, round: number, itemIndex: number, endsAt = 100_000) =>
  ({ phase: 'work', blockIndex, round, itemIndex, endsAt }) as PlayerState

function run(events: PlayerEvent[], from: PlayerState = idle) {
  let state = from
  const effects: Effect[] = []
  for (const ev of events) {
    const t = reduce(plan, state, ev)
    state = t.state
    effects.push(...t.effects)
  }
  return { state, effects }
}

const logs = (effects: Effect[]) => effects.flatMap((e) => (e.type === 'LOG_SET' ? [e.log] : []))

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
    // Work is a timed phase now: it starts its own clock, unprompted.
    expect(state).toEqual({
      phase: 'work',
      blockIndex: 1,
      round: 0,
      itemIndex: 0,
      endsAt: 100_000 + WORK_S * 1000,
    })
  })

  // ─── invariant 1: work is timed, changeovers sit between movements ─────────

  it('a work phase that expires logs the set and moves on with no interaction', () => {
    const { state, effects } = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 0, 0))
    expect(logs(effects)).toHaveLength(2)
    expect(state).toEqual({
      phase: 'changeover',
      blockIndex: 1,
      round: 0,
      nextItemIndex: 1,
      endsAt: 100_000 + CHANGEOVER_SECONDS * 1000,
    })
  })

  it('the changeover leads into the next exercise of the same round', () => {
    const co: PlayerState = {
      phase: 'changeover',
      blockIndex: 1,
      round: 0,
      nextItemIndex: 1,
      endsAt: 15_000,
    }
    const { state } = run([{ type: 'TIMER_FIRED', now: 15_000 }], co)
    expect(state).toEqual({
      phase: 'work',
      blockIndex: 1,
      round: 0,
      itemIndex: 1,
      endsAt: 15_000 + WORK_S * 1000,
    })
  })

  it('the round boundary gets rest, never a changeover', () => {
    // Last item of round 0 with a round still to come.
    const { state } = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 0, 1))
    expect(state).toEqual({
      phase: 'rest',
      blockIndex: 1,
      round: 1,
      nextItemIndex: 0,
      endsAt: 100_000 + 75_000,
    })
  })

  it('two identical consecutive movements need no changeover', () => {
    const doubled: WorkoutPlan = {
      ...plan,
      blocks: [
        {
          kind: 'circuit',
          label: 'Finisher',
          rounds: 1,
          restSeconds: 60,
          items: [
            { exerciseId: 'plank', perPerson: { [P1]: t(1, 0) }, workSeconds: 30 },
            { exerciseId: 'plank', perPerson: { [P1]: t(1, 0) }, workSeconds: 30 },
          ],
        },
      ],
    }
    const after = reduce(doubled, workAt(0, 0, 0, 5_000), { type: 'TIMER_FIRED', now: 5_000 })
    expect(after.state).toMatchObject({ phase: 'work', itemIndex: 1 })
  })

  // ─── invariant 2: late timers never cross a work phase ─────────────────────

  it('never banks a session nobody did: a late timer pauses instead of advancing', () => {
    // Backgrounded from mid-warmup and returning 8 minutes later.
    const { state, effects } = run([
      { type: 'START', now: 0 },
      { type: 'TIMER_FIRED', now: 500_000 },
    ])
    expect(state).toMatchObject({ phase: 'paused' })
    expect((state as { resumeState: PlayerState }).resumeState).toEqual({
      phase: 'timed',
      blockIndex: 0,
      itemIndex: 0,
      endsAt: 40_000,
    })
    // Critically: nothing was logged and the session did not complete.
    expect(logs(effects)).toHaveLength(0)
    expect(effects.filter((e) => e.type === 'SESSION_COMPLETE')).toHaveLength(0)
  })

  it('a late work timer never auto-logs the set', () => {
    const { state, effects } = run(
      [{ type: 'TIMER_FIRED', now: 100_000 + LATE_TIMER_GRACE_MS + 1 }],
      workAt(1, 0, 0),
    )
    expect(state).toMatchObject({ phase: 'paused' })
    expect(logs(effects)).toHaveLength(0)
  })

  it('a fast-forward stops at the first work phase rather than crossing it', () => {
    // The grace window chains through phases that elapsed while we were gone.
    // Short sets are the case where that chain can reach a work phase — and it
    // must stop there, because a set is something a human has to actually do.
    const quick: WorkoutPlan = {
      ...plan,
      blocks: [
        {
          kind: 'circuit',
          label: 'Finisher',
          rounds: 3,
          restSeconds: 5,
          items: [{ exerciseId: 'plank', perPerson: { [P1]: t(1, 0) }, workSeconds: 5 }],
        },
      ],
    }
    const rest: PlayerState = {
      phase: 'rest',
      blockIndex: 0,
      round: 1,
      nextItemIndex: 0,
      endsAt: 10_000,
    }
    // 12s late: inside the grace window, and long enough for the 5s set that
    // follows to have "expired" too.
    const { state, effects } = reduce(quick, rest, { type: 'TIMER_FIRED', now: 22_000 })
    expect(state).toMatchObject({ phase: 'paused' })
    expect((state as { resumeState: PlayerState }).resumeState).toMatchObject({ phase: 'work' })
    expect(logs(effects)).toHaveLength(0)
  })

  it('an all-timed plan cannot self-complete while the tab is away', () => {
    // Mobility sessions are entirely timed blocks — there is no work phase to
    // halt a fast-forward, so the late-timer rule is the only thing stopping a
    // fabricated completed session.
    const mobilityPlan: WorkoutPlan = {
      ...plan,
      blocks: [
        { kind: 'mobility', label: 'Mobilise', items: [{ exerciseId: 'cat-cow', seconds: 45 }] },
        { kind: 'mobility', label: 'Open', items: [{ exerciseId: 'childs-pose', seconds: 50 }] },
      ],
    }
    let state: PlayerState = { phase: 'idle' }
    const all: Effect[] = []
    for (const ev of [
      { type: 'START' as const, now: 0 },
      { type: 'TIMER_FIRED' as const, now: 600_000 },
    ]) {
      const t = reduce(mobilityPlan, state, ev)
      state = t.state
      all.push(...t.effects)
    }
    expect(state.phase).toBe('paused')
    expect(all.filter((e) => e.type === 'SESSION_COMPLETE')).toHaveLength(0)
  })

  it('still advances normally when the timer fires on time', () => {
    const { state } = run([
      { type: 'START', now: 0 },
      { type: 'TIMER_FIRED', now: 40_100 },
    ])
    // Anchored to the deadline (40s), not arrival (40.1s): drift never accumulates.
    expect(state).toEqual({ phase: 'timed', blockIndex: 0, itemIndex: 1, endsAt: 80_000 })
  })

  // ─── invariant 3: the block gate ───────────────────────────────────────────

  it('the last set of a block opens the gate, not a timed transition', () => {
    const { state } = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 1, 1))
    expect(state).toEqual({
      phase: 'block_gate',
      blockIndex: 1,
      nextBlockIndex: 2,
      pauseAt: 100_000 + GATE_PAUSE_MS,
      ratings: {},
    })
  })

  it('the gate holds: a timer inside the window does not advance it', () => {
    const gate = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 1, 1)).state
    const { state } = run([{ type: 'TIMER_FIRED', now: 100_000 + GATE_PAUSE_MS - 1 }], gate)
    expect(state).toEqual(gate)
  })

  it('an unanswered gate pauses after five minutes', () => {
    const gate = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 1, 1)).state
    const { state, effects } = run([{ type: 'TIMER_FIRED', now: 100_000 + GATE_PAUSE_MS }], gate)
    expect(state).toMatchObject({ phase: 'paused' })
    expect(effects.filter((e) => e.type === 'SESSION_COMPLETE')).toHaveLength(0)
  })

  it('Continue records "right" for everything left unrated — a human confirmed the block', () => {
    const gate = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 1, 1)).state
    const { state, effects } = run([{ type: 'CONTINUE', now: 200_000 }], gate)
    const feedback = effects.filter((e) => e.type === 'LOG_FEEDBACK')
    // 2 exercises × 2 people.
    expect(feedback).toHaveLength(4)
    expect(feedback.every((f) => f.rating === 'right')).toBe(true)
    expect(state).toMatchObject({ phase: 'work', blockIndex: 2, round: 0, itemIndex: 0 })
  })

  it('a rating tapped on the gate is kept, and Continue does not overwrite it', () => {
    const gate = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 1, 1)).state
    const rated = run(
      [
        {
          type: 'FEEDBACK',
          now: 150_000,
          userId: P1,
          exerciseId: 'db-squat',
          rating: 'too_hard',
        },
      ],
      gate,
    )
    expect(rated.state).toMatchObject({ ratings: { [`${P1}:db-squat`]: 'too_hard' } })
    const { effects } = run([{ type: 'CONTINUE', now: 200_000 }], rated.state)
    const assumedRight = effects.filter((e) => e.type === 'LOG_FEEDBACK')
    expect(assumedRight).toHaveLength(3)
    expect(assumedRight.some((f) => f.userId === P1 && f.exerciseId === 'db-squat')).toBe(false)
  })

  // ─── invariant 4: assumed sets and ADJUST scoping ──────────────────────────

  it('an uncorrected auto-log is assumed, at the prescribed target', () => {
    const { effects } = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 0, 0))
    expect(logs(effects)[0]).toMatchObject({
      userId: P1,
      exerciseId: 'db-squat',
      targetReps: 10,
      actualReps: 10,
      weight: 10,
      assumed: true,
    })
  })

  it('ADJUST is consumed by the expiry path: that log is not assumed', () => {
    const adjusted = run(
      [{ type: 'ADJUST', now: 50_000, userId: P2, target: { targetReps: 8 } }],
      workAt(1, 0, 0),
    )
    const { effects } = run([{ type: 'TIMER_FIRED', now: 100_000 }], adjusted.state)
    const [a, b] = logs(effects)
    expect(a).toMatchObject({ userId: P1, actualReps: 10, assumed: true })
    expect(b).toMatchObject({ userId: P2, targetReps: 12, actualReps: 8, assumed: false })
  })

  it('ADJUST is consumed by the finish-early path too', () => {
    const adjusted = run(
      [{ type: 'ADJUST', now: 50_000, userId: P2, target: { weight: 2.5 } }],
      workAt(1, 0, 0),
    )
    const { effects } = run([{ type: 'SET_DONE', now: 60_000 }], adjusted.state)
    expect(logs(effects)[1]).toMatchObject({ userId: P2, weight: 2.5, assumed: false })
  })

  it('an adjustment never leaks into the next exercise', () => {
    const adjusted = run(
      [{ type: 'ADJUST', now: 50_000, userId: P2, target: { targetReps: 8 } }],
      workAt(1, 0, 0),
    )
    // Set 1 ends (consuming it), changeover, set 2 runs to its own expiry.
    const afterSet1 = run([{ type: 'TIMER_FIRED', now: 100_000 }], adjusted.state)
    expect(afterSet1.state).toMatchObject({ phase: 'changeover' })
    const atSet2 = run([{ type: 'TIMER_FIRED', now: 115_000 }], afterSet1.state)
    expect(atSet2.state).toMatchObject({ phase: 'work', itemIndex: 1 })
    expect('overrides' in atSet2.state).toBe(false)
    const { effects } = run([{ type: 'TIMER_FIRED', now: 115_000 + WORK_S * 1000 }], atSet2.state)
    // Back at the prescribed 12 reps, and assumed again.
    expect(logs(effects)[1]).toMatchObject({ userId: P2, actualReps: 12, assumed: true })
  })

  it('SKIP clears a pending adjustment along with the set', () => {
    const adjusted = run(
      [{ type: 'ADJUST', now: 50_000, userId: P2, target: { targetReps: 8 } }],
      workAt(1, 0, 0),
    )
    const { state, effects } = run([{ type: 'SKIP', now: 60_000 }], adjusted.state)
    expect(logs(effects)).toHaveLength(0)
    expect(state).toMatchObject({ phase: 'changeover' })
  })

  it('SET_DONE logs one set per participant at their own targets', () => {
    const { effects } = run([{ type: 'SET_DONE', now: 500 }], workAt(1, 0, 0))
    expect(logs(effects)).toHaveLength(2)
    expect(logs(effects)[0]).toMatchObject({ userId: P1, actualReps: 10, weight: 10 })
    expect(logs(effects)[1]).toMatchObject({ userId: P2, actualReps: 12, weight: 5 })
  })

  it('SET_DONE applies per-person overrides carried on the event', () => {
    const { effects } = run(
      [{ type: 'SET_DONE', now: 500, overrides: { [P2]: { targetReps: 8 } } }],
      workAt(1, 0, 0),
    )
    expect(logs(effects)[1]).toMatchObject({
      userId: P2,
      actualReps: 8,
      targetReps: 12,
      weight: 5,
      assumed: false,
    })
  })

  // ─── invariant 5: SKIP during work still logs nothing ──────────────────────

  it('SKIP during work advances without logging', () => {
    const { state, effects } = run([{ type: 'SKIP', now: 0 }], workAt(1, 0, 0))
    expect(state).toMatchObject({ phase: 'changeover', nextItemIndex: 1 })
    expect(logs(effects)).toHaveLength(0)
  })

  it('SKIP on the last set of a block opens the gate without logging', () => {
    const { state, effects } = run([{ type: 'SKIP', now: 0 }], workAt(1, 1, 1))
    expect(state).toMatchObject({ phase: 'block_gate' })
    expect(logs(effects)).toHaveLength(0)
  })

  // ─── invariant 6: cut it short ─────────────────────────────────────────────

  it('finishing early at the gate completes the session, not abandons it', () => {
    const gate = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 1, 1)).state
    const { state, effects } = run([{ type: 'FINISH_EARLY', now: 200_000 }], gate)
    expect(state).toEqual({ phase: 'complete' })
    const done = effects.find((e) => e.type === 'SESSION_COMPLETE')!
    expect(done).toMatchObject({ abandoned: false, plannedThroughBlockIndex: 1 })
  })

  it('finishing early is only offered at a block boundary', () => {
    const { state } = run([{ type: 'FINISH_EARLY', now: 0 }], workAt(1, 0, 0))
    expect(state).toMatchObject({ phase: 'work' })
  })

  // ─── the rest of the flow ──────────────────────────────────────────────────

  it('finishing the final cooldown item completes the session', () => {
    const lastStretch: PlayerState = { phase: 'timed', blockIndex: 3, itemIndex: 0, endsAt: 60_000 }
    const { state, effects } = run([{ type: 'TIMER_FIRED', now: 60_000 }], lastStretch)
    expect(state).toEqual({ phase: 'complete' })
    expect(effects.some((e) => e.type === 'SESSION_COMPLETE' && !e.abandoned)).toBe(true)
  })

  it('pause/resume preserves remaining time', () => {
    const { state } = run([
      { type: 'START', now: 0 }, // warmup ends at 40s
      { type: 'PAUSE', now: 10_000 }, // 30s remaining
      { type: 'RESUME', now: 100_000 },
    ])
    expect(state).toEqual({ phase: 'timed', blockIndex: 0, itemIndex: 0, endsAt: 130_000 })
  })

  it('resuming a phase that expired unattended restarts it, not skips it', () => {
    const away = run([
      { type: 'START', now: 0 },
      { type: 'TIMER_FIRED', now: 600_000 },
    ])
    expect(away.state.phase).toBe('paused')
    const resumed = reduce(plan, away.state, { type: 'RESUME', now: 700_000 })
    expect(resumed.state).toEqual({
      phase: 'timed',
      blockIndex: 0,
      itemIndex: 0,
      endsAt: 700_000 + 40_000,
    })
  })

  it('resuming a set gives the whole set back', () => {
    const away = run(
      [{ type: 'TIMER_FIRED', now: 100_000 + LATE_TIMER_GRACE_MS + 1 }],
      workAt(1, 0, 0),
    )
    const resumed = reduce(plan, away.state, { type: 'RESUME', now: 900_000 })
    expect(resumed.state).toEqual({
      phase: 'work',
      blockIndex: 1,
      round: 0,
      itemIndex: 0,
      endsAt: 900_000 + WORK_S * 1000,
    })
  })

  it('resuming a paused gate gives the full five minutes back', () => {
    const gate = run([{ type: 'TIMER_FIRED', now: 100_000 }], workAt(1, 1, 1)).state
    const paused = run([{ type: 'TIMER_FIRED', now: 100_000 + GATE_PAUSE_MS }], gate).state
    const { state } = run([{ type: 'RESUME', now: 900_000 }], paused)
    expect(state).toMatchObject({ phase: 'block_gate', pauseAt: 900_000 + GATE_PAUSE_MS })
  })

  it('SKIP during rest starts the next set immediately', () => {
    const rest: PlayerState = {
      phase: 'rest',
      blockIndex: 1,
      round: 1,
      nextItemIndex: 0,
      endsAt: 99_000,
    }
    const { state } = run([{ type: 'SKIP', now: 50_000 }], rest)
    expect(state).toEqual({
      phase: 'work',
      blockIndex: 1,
      round: 1,
      itemIndex: 0,
      endsAt: 50_000 + WORK_S * 1000,
    })
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
    const { state, effects } = run([{ type: 'ABANDON', now: 0 }], workAt(1, 0, 0))
    expect(state).toEqual({ phase: 'complete' })
    expect(effects.some((e) => e.type === 'SESSION_COMPLETE' && e.abandoned)).toBe(true)
  })

  it('a hands-off session reaches the celebration on Continue alone', () => {
    // The done-criterion, as a test: only CONTINUE is ever dispatched by a
    // human; every other transition is the clock running out.
    const all: Effect[] = []
    const step = (from: PlayerState, ev: PlayerEvent): PlayerState => {
      const t = reduce(plan, from, ev)
      all.push(...t.effects)
      return t.state
    }
    let now = 0
    let state = step(idle, { type: 'START', now })
    for (let i = 0; i < 200 && state.phase !== 'complete'; i++) {
      if (state.phase === 'block_gate') {
        state = step(state, { type: 'CONTINUE', now })
        continue
      }
      if (!('endsAt' in state)) throw new Error(`stuck in ${state.phase}`)
      now = state.endsAt
      state = step(state, { type: 'TIMER_FIRED', now })
    }
    expect(state).toEqual({ phase: 'complete' })
    // 2 blocks × 2 rounds × 2 items × 2 people.
    expect(logs(all)).toHaveLength(16)
    expect(logs(all).every((l) => l.assumed)).toBe(true)
    expect(all.some((e) => e.type === 'SESSION_COMPLETE' && !e.abandoned)).toBe(true)
  })

  it('fuzz: random event sequences never reach an invalid state or throw', () => {
    const eventArb: fc.Arbitrary<PlayerEvent> = fc.oneof(
      fc.record({ type: fc.constant('START' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('SET_DONE' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('TIMER_FIRED' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('SKIP' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('PAUSE' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('RESUME' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('CONTINUE' as const), now: fc.nat() }),
      fc.record({ type: fc.constant('FINISH_EARLY' as const), now: fc.nat() }),
      fc.record({
        type: fc.constant('ADJUST' as const),
        now: fc.nat(),
        userId: fc.constantFrom(P1, P2, 'ghost'),
        target: fc.record({ targetReps: fc.integer({ min: 1, max: 30 }) }),
      }),
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
      'changeover',
      'rest',
      'block_transition',
      'block_gate',
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
          if (state.phase === 'work' || state.phase === 'changeover' || state.phase === 'rest') {
            const block = plan.blocks[state.blockIndex]
            expect(block && (block.kind === 'superset' || block.kind === 'circuit')).toBe(true)
          }
          // A log can only ever be produced with a set behind it: no phase may
          // carry a stale correction from an exercise already finished.
          if (state.phase === 'work' && state.overrides) {
            expect(Object.keys(state.overrides).length).toBeGreaterThan(0)
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})

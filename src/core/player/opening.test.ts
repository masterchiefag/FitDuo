import { describe, expect, it } from 'vitest'
import { openingLine, personLoads, sessionSummary } from './opening'
import type { WorkoutPlan } from '../generator/types'

const P1 = 'user-a'
const P2 = 'user-b'
const t = (targetReps: number, weight: number) => ({ targetReps, weight })

const plan = (over: Partial<WorkoutPlan> = {}): WorkoutPlan => ({
  planVersion: 1,
  seed: 42,
  dateISO: '2026-08-26',
  mode: 'full',
  dayType: 'full_a',
  participantIds: [P1, P2],
  estimatedSeconds: 3300,
  blocks: [
    { kind: 'warmup', items: [{ exerciseId: 'arm-circles', seconds: 40 }] },
    {
      kind: 'superset',
      label: 'Strength A',
      rounds: 3,
      restSeconds: 75,
      items: [
        { exerciseId: 'db-squat', perPerson: { [P1]: t(10, 10), [P2]: t(12, 5) }, workSeconds: 45 },
        { exerciseId: 'db-row', perPerson: { [P1]: t(10, 12.5), [P2]: t(12, 5) }, workSeconds: 45 },
      ],
    },
    {
      kind: 'circuit',
      label: 'Finisher',
      rounds: 2,
      restSeconds: 60,
      items: [
        { exerciseId: 'plank', perPerson: { [P1]: t(1, 0), [P2]: t(1, 0) }, workSeconds: 40 },
      ],
    },
    { kind: 'cooldown', items: [{ exerciseId: 'childs-pose', seconds: 45 }] },
  ],
  ...over,
})

describe('sessionSummary', () => {
  it('counts the work blocks, never the warm-up or the stretch', () => {
    expect(sessionSummary(plan()).blockCount).toBe(2)
  })

  it('counts one person’s sets — a duo set is one set each, not two', () => {
    // 3 rounds × 2 movements, then 2 rounds × 1.
    expect(sessionSummary(plan()).setsPerPerson).toBe(8)
  })

  /** The plan's own estimate. A second computation is a second answer. */
  it('reports the plan’s minutes', () => {
    expect(sessionSummary(plan({ estimatedSeconds: 3300 })).minutes).toBe(55)
    expect(sessionSummary(plan({ estimatedSeconds: 1170 })).minutes).toBe(20)
  })

  it('says nothing structural about a session with no work blocks', () => {
    const mobility = plan({
      mode: 'mobility',
      blocks: [{ kind: 'mobility', label: 'Open', items: [{ exerciseId: 'doorway', seconds: 45 }] }],
    })
    expect(sessionSummary(mobility)).toMatchObject({ blockCount: 0, setsPerPerson: 0 })
  })
})

describe('personLoads', () => {
  it('is the kit each person gets out, ascending and deduplicated', () => {
    expect(personLoads(plan())).toEqual([
      { userId: P1, weights: [10, 12.5] },
      { userId: P2, weights: [5] },
    ])
  })

  /** Solo is one panel — the list follows the plan's participants. */
  it('follows participantIds, so solo has exactly one', () => {
    const solo = plan({ participantIds: [P2] })
    expect(personLoads(solo)).toEqual([{ userId: P2, weights: [5] }])
  })

  it('leaves a bodyweight-only session with nothing to pick up', () => {
    const bodyweight = plan({
      blocks: [
        {
          kind: 'circuit',
          label: 'Finisher',
          rounds: 2,
          restSeconds: 60,
          items: [
            { exerciseId: 'plank', perPerson: { [P1]: t(1, 0), [P2]: t(1, 0) }, workSeconds: 40 },
          ],
        },
      ],
    })
    expect(personLoads(bodyweight).map((p) => p.weights)).toEqual([[], []])
  })
})

describe('openingLine', () => {
  it('never talks about load on a mobility session', () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(openingLine(seed, 'mobility')).not.toMatch(/kg|set|block|lift/i)
    }
  })

  it('treats a short session as strength — it is the same session, smaller', () => {
    expect(openingLine(7, 'short')).toBe(openingLine(7, 'full'))
  })

  /** Same plan, same line: the opening cannot change under a resumed session. */
  it('is a function of the seed alone', () => {
    expect(openingLine(12345, 'full')).toBe(openingLine(12345, 'full'))
  })

  it('moves with the seed, which carries the date', () => {
    const lines = new Set([0, 1, 2].map((s) => openingLine(s, 'full')))
    expect(lines.size).toBe(3)
  })

  /** A seed is an fnv1a32 hash and may arrive negative after coercion. */
  it('never indexes off the end', () => {
    expect(openingLine(-7, 'full')).toBeTruthy()
    expect(openingLine(0, 'mobility')).toBeTruthy()
  })
})

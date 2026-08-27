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
  const weightsOf = (p: WorkoutPlan) => personLoads(p).map((x) => x.loads.map((l) => l.weight))

  it('lists every load each person is prescribed, ascending', () => {
    // P1 planks at 0, squats at 10, rows at 12.5. P2 does both lifts at 5 —
    // two entries, because two movements sharing a weight is one dumbbell to
    // fetch only once the edge has said them both as "5 kg".
    expect(weightsOf(plan())).toEqual([
      [0, 10, 12.5],
      [0, 5, 5],
    ])
  })

  /** Solo is one panel — the list follows the plan's participants. */
  it('follows participantIds, so solo has exactly one', () => {
    expect(personLoads(plan({ participantIds: [P2] })).map((x) => x.userId)).toEqual([P2])
  })

  /**
   * The movement travels with the number because the number alone cannot be
   * said out loud: 1.7 is "the red band" on a band movement and a nonsense
   * dumbbell everywhere else (PR #41). Zero rides along for the same reason —
   * a band whose colour nobody has recorded is still kit to fetch, and only
   * the catalog knows which zero is which.
   */
  it('carries the movement, so the edge can say what the number is', () => {
    expect(personLoads(plan())[0]!.loads).toEqual([
      { exerciseId: 'plank', weight: 0 },
      { exerciseId: 'db-squat', weight: 10 },
      { exerciseId: 'db-row', weight: 12.5 },
    ])
  })

  it('breaks a shared weight by id, so the same plan lists the same kit twice over', () => {
    const [, p2] = personLoads(plan())
    expect(p2!.loads.map((l) => l.exerciseId)).toEqual(['plank', 'db-row', 'db-squat'])
  })

  it('keeps a bodyweight session\'s zeroes — "nothing to pick up" is the edge\'s call', () => {
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
    expect(weightsOf(bodyweight)).toEqual([[0], [0]])
  })
})

describe('openingLine', () => {
  it('never talks about load on a mobility session', () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(openingLine(seed, 'mobility')).not.toMatch(/kg|set|block|lift/i)
    }
  })

  /**
   * Not talking about load is not the same as denying it. Relief sessions
   * prescribe band work and progress it (PR #41), so an opening that says "no
   * loads today" is describing a session this app stopped generating — the
   * same fault as the tap promise below, one mode over.
   */
  it('never claims a mobility session has nothing to pick up', () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(openingLine(seed, 'mobility')).not.toMatch(
        /no (load|weight|resistance)|nothing to (lift|hit|pick|carry)/i,
      )
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
    const strength = new Set([0, 1, 2, 3].map((s) => openingLine(s, 'full')))
    const mobility = new Set([0, 1, 2, 3].map((s) => openingLine(s, 'mobility')))
    expect(strength.size).toBeGreaterThan(1)
    expect(mobility.size).toBeGreaterThan(1)
  })

  /**
   * The opening claims nothing the session will not keep. "The only tap is
   * between blocks" was true of no player this app has ever shipped.
   */
  it('never promises how few taps the session takes', () => {
    for (let seed = 0; seed < 12; seed++) {
      expect(openingLine(seed, 'full')).not.toMatch(/only tap|no tap|hands.free/i)
      expect(openingLine(seed, 'mobility')).not.toMatch(/only tap|no tap|hands.free/i)
    }
  })

  /** A seed is an fnv1a32 hash and may arrive negative after coercion. */
  it('never indexes off the end', () => {
    expect(openingLine(-7, 'full')).toBeTruthy()
    expect(openingLine(0, 'mobility')).toBeTruthy()
  })
})

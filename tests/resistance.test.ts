import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BAND_COLOURS,
  BAND_FORCE_KG,
  bandColourFor,
  ladderFor,
  resistanceKind,
} from '../src/core/catalog/resistance'
import { catalogSchema, type Exercise } from '../src/core/catalog/types'
import { deriveProgression } from '../src/core/gamification/derive'
import { nextTarget } from '../src/core/generator/progression'

const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'content', 'catalog.json'), 'utf8')),
).exercises
const byId = new Map(catalog.map((e) => [e.id, e]))
const ex = (id: string): Exercise => byId.get(id)!

const KIT = { availableWeights: [2.5, 5, 7.5, 10], availableBands: [...BAND_COLOURS].slice(1, 6) }

describe('resistance ladders', () => {
  it('reads the ladder off the kit a movement needs', () => {
    expect(resistanceKind(ex('db-chest-press'))).toBe('dumbbell')
    expect(resistanceKind(ex('band-external-rotation'))).toBe('band')
    expect(resistanceKind(ex('push-up'))).toBe('none')
  })

  it('the band ladder is ordered by force, not by the order colours were typed', () => {
    const kit = { availableWeights: [], availableBands: ['black', 'yellow', 'red'] as const }
    expect(
      ladderFor(ex('band-external-rotation'), { ...kit, availableBands: [...kit.availableBands] }),
    ).toEqual([BAND_FORCE_KG.yellow, BAND_FORCE_KG.red, BAND_FORCE_KG.black])
  })

  it('every colour round-trips through the force it stands for', () => {
    for (const c of BAND_COLOURS) expect(bandColourFor(BAND_FORCE_KG[c])).toBe(c)
  })

  /**
   * The whole reason bands are stored as a number. `nextTarget` is the same
   * double progression a dumbbell gets — the point is that it needs no branch.
   */
  it('progresses a band up its colours the way it progresses a dumbbell up its kilos', () => {
    const rotation = ex('band-external-rotation')
    const [, maxReps] = rotation.repRange
    const topOfRange = nextTarget(rotation, ladderFor(rotation, KIT), {
      lastWeight: BAND_FORCE_KG.red,
      lastTargetReps: maxReps,
      lastActualReps: [maxReps, maxReps],
      lastFeedback: 'right',
      bestE1rm: 0,
    })
    expect(bandColourFor(topOfRange.weight)).toBe('green')
    expect(topOfRange.targetReps).toBe(rotation.repRange[0])
  })

  it('never prescribes a colour the person does not own', () => {
    const rotation = ex('band-external-rotation')
    const sparse = { availableWeights: [], availableBands: ['yellow', 'black'] as const }
    const kit = { ...sparse, availableBands: [...sparse.availableBands] }
    const [, maxReps] = rotation.repRange
    const up = nextTarget(rotation, ladderFor(rotation, kit), {
      lastWeight: BAND_FORCE_KG.yellow,
      lastTargetReps: maxReps,
      lastActualReps: [maxReps, maxReps],
      lastFeedback: 'right',
      bestE1rm: 0,
    })
    expect(bandColourFor(up.weight)).toBe('black')
  })

  /**
   * A person who owns a band but has not said which one still gets the movement
   * — unloaded rather than dropped. Prescribing nothing is worse than
   * prescribing a rotation with whatever band is in the drawer.
   */
  it('falls back to reps alone when no colours are recorded', () => {
    const rotation = ex('band-external-rotation')
    const t = nextTarget(
      rotation,
      ladderFor(rotation, { availableWeights: [], availableBands: [] }),
      undefined,
    )
    expect(t.weight).toBe(0)
    expect(t.targetReps).toBeGreaterThan(1)
  })
})

/**
 * `db-reverse-fly` is a `pull_h` main AND an Activate movement, and it is not
 * the only one. Pooling both into one progression lets Sunday's 2.5 kg cuff
 * work set Monday's rear-delt prescription: the strength day opens at a rehab
 * weight and "progresses" downwards from there.
 *
 * This is also what keeps `generator/types.ts` literally true when it says
 * recovery days do not drive progression — they drive their own, never
 * strength's.
 */
describe('relief work and strength work progress on separate tracks', () => {
  const SHARED = 'db-reverse-fly'
  const strengthSession = {
    dateISO: '2026-08-24' as const,
    mode: 'full' as const,
    completed: true,
    participantIds: ['p1'],
    startedAt: Date.UTC(2026, 7, 24, 9, 0),
    endedAt: Date.UTC(2026, 7, 24, 10, 0),
  }
  const reliefSession = {
    dateISO: '2026-08-25' as const,
    mode: 'mobility' as const,
    completed: true,
    participantIds: ['p1'],
    startedAt: Date.UTC(2026, 7, 25, 9, 0),
    endedAt: Date.UTC(2026, 7, 25, 9, 20),
  }
  const set = (at: number, weight: number, reps: number) => ({
    userId: 'p1',
    exerciseId: SHARED,
    targetReps: reps,
    actualReps: reps,
    weight,
    loggedAt: at,
  })
  const sessions = [strengthSession, reliefSession]
  const sets = [
    set(Date.UTC(2026, 7, 24, 9, 30), 10, 12),
    set(Date.UTC(2026, 7, 25, 9, 10), 2.5, 15),
  ]

  it('the strength track never reads a set logged in a relief session', () => {
    const strength = deriveProgression('p1', sessions, sets, [], 'strength')
    expect(strength[SHARED]?.lastWeight).toBe(10)
  })

  it('the relief track never reads a set logged in a strength session', () => {
    const relief = deriveProgression('p1', sessions, sets, [], 'relief')
    expect(relief[SHARED]?.lastWeight).toBe(2.5)
  })

  /** History from before the split is strength work, and stays where it was. */
  it('keeps unassigned history on the strength track', () => {
    const orphan = [set(Date.UTC(2026, 6, 1, 9, 0), 7.5, 10)]
    expect(deriveProgression('p1', sessions, orphan, [], 'strength')[SHARED]?.lastWeight).toBe(7.5)
    expect(deriveProgression('p1', sessions, orphan, [], 'relief')[SHARED]).toBeUndefined()
  })
})

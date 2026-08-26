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

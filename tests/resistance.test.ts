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
import { nextTarget, stepWeight } from '../src/core/generator/progression'
import { grabLabel, loadLabel } from '../src/app/lib/load'

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
 * The ± buttons beside a target move along the SAME ladder the generator
 * prescribed from.
 *
 * They used to add and subtract a literal 2.5. For a household owning 2.5 kg
 * steps that was merely sloppy; for a band it is wrong outright, because the
 * number the buttons operate on is never the number on screen. Red pulls
 * 1.7 kg, 1.7 + 2.5 is 4.2, and 4.2 is not a colour — the panel would name the
 * nearest one and log a tension nobody owns.
 */
describe('the load adjuster steps the ladder, not a fixed amount', () => {
  const ex = (id: string) => byId.get(id)!

  it('a band steps to the next colour the person owns', () => {
    const ladder = ladderFor(ex('band-external-rotation'), KIT)
    expect(bandColourFor(stepWeight(ladder, BAND_FORCE_KG.red, 1))).toBe('green')
    expect(bandColourFor(stepWeight(ladder, BAND_FORCE_KG.red, -1))).toBe('yellow')
  })

  it('skips colours the person does not own', () => {
    const kit = { availableWeights: [], availableBands: ['yellow', 'black'] as const }
    const ladder = ladderFor(ex('band-external-rotation'), {
      ...kit,
      availableBands: [...kit.availableBands],
    })
    expect(bandColourFor(stepWeight(ladder, BAND_FORCE_KG.yellow, 1))).toBe('black')
  })

  it('stays put at the ends rather than inventing a rung', () => {
    const ladder = ladderFor(ex('db-chest-press'), KIT)
    expect(stepWeight(ladder, 10, 1)).toBe(10)
    expect(stepWeight(ladder, 2.5, -1)).toBe(2.5)
  })
})

/**
 * `availableBands` defaults to empty, and eligibility keys off `equipment`.
 * Someone who owns a band and has not recorded its colour is still prescribed
 * Band Pull-Apart — correctly — with no rung to stand on.
 *
 * What they must not be told is "Bodyweight", on a movement whose name begins
 * with the word Band (Grok, PR #41).
 */
describe('a band with no colour recorded is still a band', () => {
  const rotation = byId.get('band-external-rotation')!
  const pushup = byId.get('push-up')!

  it('names the band rather than calling it bodyweight', () => {
    expect(loadLabel(rotation, 0)).toBe('your band')
    expect(grabLabel(rotation, 0)).toBe('Grab your band')
  })

  it('still calls a bodyweight movement bodyweight', () => {
    expect(loadLabel(pushup, 0)).toBe('bodyweight')
    expect(grabLabel(pushup, 0)).toBe('Bodyweight')
  })

  it('names the colour once there is one', () => {
    expect(loadLabel(rotation, BAND_FORCE_KG.red)).toBe('red band')
    expect(grabLabel(rotation, BAND_FORCE_KG.red)).toBe('Grab the red band')
  })
})

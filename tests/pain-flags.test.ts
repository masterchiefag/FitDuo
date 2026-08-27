import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BAND_COLOURS, ladderFor } from '../src/core/catalog/resistance'
import { BODY_AREAS, catalogSchema, type BodyArea, type Exercise } from '../src/core/catalog/types'
import { nextTarget } from '../src/core/generator/progression'
import { cautionsFor } from '../src/app/lib/cautions'

const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'content', 'catalog.json'), 'utf8')),
).exercises
const byId = new Map(catalog.map((e) => [e.id, e]))
const ex = (id: string): Exercise => byId.get(id)!
const KIT = { availableWeights: [2.5, 5, 7.5, 10], availableBands: [...BAND_COLOURS].slice(1, 4) }
const target = (e: Exercise, pain: BodyArea[] = []) =>
  nextTarget(e, ladderFor(e, KIT), undefined, pain)

describe('a flagged area goes lighter, and nothing else changes', () => {
  it('drops a rung and the reps on a high-stress movement', () => {
    const press = ex('db-shoulder-press')
    const before = target(press)
    const after = target(press, ['shoulder'])
    expect(after.weight).toBeLessThan(before.weight)
    expect(after.targetReps).toBe(press.repRange[0])
  })

  /** `moderate` is a caution, not a deload — reps come back, the weight stays. */
  it('takes only the reps on a moderate-stress movement', () => {
    const fly = ex('db-chest-fly')
    expect(fly.loads.find((l) => l.area === 'shoulder')?.stress).toBe('moderate')
    expect(target(fly, ['shoulder']).weight).toBe(target(fly).weight)
    expect(target(fly, ['shoulder']).targetReps).toBe(fly.repRange[0])
  })

  it('leaves a movement that does not load the flagged area alone', () => {
    const row = ex('db-bent-over-row')
    expect(row.loads.some((l) => l.area === 'shoulder')).toBe(false)
    expect(target(row, ['shoulder'])).toEqual(target(row))
  })

  /**
   * The point of adding scaption in #42, asserted rather than asserted-about:
   * a shoulder flag must leave the vertical-push slot with something to fill it
   * that is not a deloaded press.
   */
  it('leaves the push_v slot a movement that is not high-stress', () => {
    const verticals = catalog.filter((e) => e.role === 'main' && e.pattern === 'push_v')
    const safe = verticals.filter(
      (e) => !e.loads.some((l) => l.area === 'shoulder' && l.stress === 'high'),
    )
    expect(safe.map((e) => e.id)).toContain('db-scaption')
    expect(safe.length).toBeGreaterThan(0)
  })
})

/**
 * PLAN §A0.2: `weightSnap` and `repClamp` always run last, so no adjuster can
 * emit a prescription that is unliftable or outside the movement's range —
 * "that invariant is a property test, not a convention".
 */
describe('no adjuster can outrun the terminal pair', () => {
  it('holds for every exercise, every flag combination, every kit', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...catalog.map((e) => e.id)),
        fc.uniqueArray(fc.constantFrom(...BODY_AREAS)),
        fc.uniqueArray(fc.constantFrom(2.5, 5, 7.5, 10, 12.5)),
        fc.uniqueArray(fc.constantFrom(...BAND_COLOURS)),
        (id, pain, weights, bands) => {
          const e = ex(id)
          const ladder = ladderFor(e, { availableWeights: weights, availableBands: bands })
          const t = nextTarget(e, ladder, undefined, pain)
          const [min, max] = e.repRange
          expect(t.targetReps).toBeGreaterThanOrEqual(min)
          expect(t.targetReps).toBeLessThanOrEqual(max)
          if (t.weight !== 0) expect(ladder).toContain(t.weight)
        },
      ),
      { numRuns: 400 },
    )
  })
})

describe('cautions', () => {
  it('are shown on a loaded movement whether or not anything is flagged', () => {
    expect(cautionsFor(ex('db-shoulder-press')).length).toBeGreaterThan(0)
    expect(cautionsFor(ex('db-shoulder-press'))[0]!.flagged).toBe(false)
  })

  it('put the flagged area first and mark it', () => {
    const lead = cautionsFor(ex('push-up'), ['wrist'])[0]!
    expect(lead.area).toBe('wrist')
    expect(lead.flagged).toBe(true)
  })

  it('every body area has a line, so no load can be silent', () => {
    for (const area of BODY_AREAS) {
      const loaded = catalog.find((e) => e.loads.some((l) => l.area === area))
      if (!loaded) continue
      expect(cautionsFor(loaded, [area])[0]!.line, area).toBeTruthy()
    }
  })
})

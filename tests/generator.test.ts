import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allCanPerform, canPerform } from '../src/core/catalog/equipment'
import { catalogSchema, type Equipment, type Exercise } from '../src/core/catalog/types'
import { DURATION_MAX_S, DURATION_MIN_S, generateWorkout } from '../src/core/generator/generate'
import { addDays } from '../src/core/dates'
import type { DayHistory, GeneratorInput, ParticipantInput } from '../src/core/generator/types'

const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'content', 'catalog.json'), 'utf8')),
).exercises

const weightsArb = fc
  .uniqueArray(fc.constantFrom(1, 2.5, 5, 7.5, 10, 12.5, 15, 20), {
    minLength: 1,
    maxLength: 6,
  })
  .map((w) => [...w].sort((a, b) => a - b))

/** The kits a real household actually has, leanest first. */
const MINIMAL_KIT: Equipment[] = ['bodyweight', 'dumbbell']
const HOME_KIT: Equipment[] = ['bodyweight', 'dumbbell', 'band', 'roller', 'chair', 'wall', 'step']
const GYM_KIT: Equipment[] = [...HOME_KIT, 'bench', 'pullup_bar']
const equipmentArb = fc.constantFrom(MINIMAL_KIT, HOME_KIT, GYM_KIT)

const participantArb = (userId: string): fc.Arbitrary<ParticipantInput> =>
  fc.record({
    userId: fc.constant(userId),
    availableWeights: weightsArb,
    equipment: equipmentArb.map((k) => [...k]),
    maxTier: fc.constantFrom(1 as const, 2 as const, 3 as const),
    progression: fc.constant({}),
  })

const scheduleArb = fc
  .array(fc.boolean(), { minLength: 7, maxLength: 7 })
  .filter((days) => days.some(Boolean))

const dateArb = fc
  .date({
    min: new Date('2026-01-01'),
    max: new Date('2027-12-31'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10))

const inputArb: fc.Arbitrary<GeneratorInput> = fc
  .record({
    dateISO: dateArb,
    scheduledDays: scheduleArb,
    p1: participantArb('p1'),
    p2: participantArb('p2'),
    duo: fc.boolean(),
  })
  .map(({ dateISO, scheduledDays, p1, p2, duo }) => ({
    householdId: 'home',
    dateISO,
    generatorVersion: 1,
    catalog,
    scheduledDays,
    participants: duo ? [p1, p2] : [p1],
    recentHistory: [],
  }))

describe('generateWorkout properties', () => {
  it('duration is always within 50–60 minutes', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generateWorkout(input)
        expect(plan.estimatedSeconds).toBeGreaterThanOrEqual(DURATION_MIN_S)
        expect(plan.estimatedSeconds).toBeLessThanOrEqual(DURATION_MAX_S)
      }),
      { numRuns: 200 },
    )
  })

  it('is deterministic: same input produces an identical plan', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(generateWorkout(input)).toEqual(generateWorkout(structuredClone(input)))
      }),
      { numRuns: 50 },
    )
  })

  it('every referenced exercise exists, with the right role', () => {
    const byId = new Map(catalog.map((e) => [e.id, e]))
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generateWorkout(input)
        for (const b of plan.blocks) {
          for (const item of b.items) {
            const ex = byId.get(item.exerciseId)
            expect(ex, item.exerciseId).toBeDefined()
            if (b.kind === 'warmup') expect(ex!.role).toBe('warmup')
            if (b.kind === 'cooldown') expect(ex!.role).toBe('cooldown')
            if (b.kind === 'superset' || b.kind === 'circuit') expect(ex!.role).toBe('main')
          }
        }
      }),
      { numRuns: 100 },
    )
  })

  it('prescribed weights come from each person’s dumbbells (or bodyweight)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generateWorkout(input)
        for (const b of plan.blocks) {
          if (b.kind !== 'superset' && b.kind !== 'circuit') continue
          for (const item of b.items) {
            for (const p of input.participants) {
              const t = item.perPerson[p.userId]
              expect(t).toBeDefined()
              if (t!.weight !== 0) expect(p.availableWeights).toContain(t!.weight)
            }
          }
        }
      }),
      { numRuns: 100 },
    )
  })

  it('no main exercise repeats within the same plan', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generateWorkout(input)
        const mains = plan.blocks
          .filter((b) => b.kind === 'superset' || b.kind === 'circuit')
          .flatMap((b) => b.items.map((i) => i.exerciseId))
        expect(new Set(mains).size).toBe(mains.length)
      }),
      { numRuns: 100 },
    )
  })

  it('never prescribes a movement the household cannot perform', () => {
    const byId = new Map(catalog.map((e) => [e.id, e]))
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generateWorkout(input)
        for (const b of plan.blocks) {
          for (const item of b.items) {
            const ex = byId.get(item.exerciseId)!
            // Checked against the raw `requires` data, NOT via canPerform:
            // calling the same predicate the generator used would make this
            // assertion agree with any bug it contains.
            const usableBy = (owned: Equipment[]) =>
              ex.requires.some((kit) =>
                kit.every((need) => need === 'bodyweight' || owned.includes(need)),
              )
            expect(
              input.participants.every((p) => usableBy(p.equipment)),
              `${ex.id} needs ${JSON.stringify(ex.requires)}`,
            ).toBe(true)
          }
        }
      }),
      { numRuns: 150 },
    )
  })

  it('honors the 3-day no-repeat window when simulating consecutive days', () => {
    const base: GeneratorInput = {
      householdId: 'home',
      dateISO: '2026-08-10',
      generatorVersion: 1,
      catalog,
      scheduledDays: [true, true, true, true, true, true, true],
      participants: [
        {
          userId: 'p1',
          availableWeights: [5, 10],
          equipment: [...HOME_KIT],
          maxTier: 2,
          progression: {},
        },
      ],
      recentHistory: [],
    }
    const history: DayHistory[] = []
    const seen = new Map<string, string>() // exerciseId -> last date used
    let date = base.dateISO
    for (let day = 0; day < 14; day++) {
      const plan = generateWorkout({ ...base, dateISO: date, recentHistory: [...history] })
      const mains = plan.blocks
        .filter((b) => b.kind === 'superset' || b.kind === 'circuit')
        .flatMap((b) => b.items.map((i) => i.exerciseId))
      for (const id of mains) {
        const last = seen.get(id)
        if (last) {
          const gap = (Date.parse(date) - Date.parse(last)) / 86_400_000
          // Relaxation may shrink the window when pools run dry, but with our
          // catalog a full-week schedule must keep at least a 2-day gap.
          expect(gap, `${id} reused after ${gap} days`).toBeGreaterThan(2)
        }
        seen.set(id, date)
      }
      history.push({
        dateISO: date,
        dayType: plan.dayType,
        exerciseIds: mains,
        muscleSetCounts: {},
      })
      if (history.length > 14) history.shift()
      date = addDays(date, 1)
    }
  })
})

/**
 * Multi-item requirements are the case a single-equipment field could not
 * express, and the reason "Dumbbell Bench Press" used to look like a movement
 * you could do with dumbbells alone.
 *
 * MUTATION-CHECKED (see docs/DECISIONS.md): reverting `canPerform` to the old
 * single-value match — e.g. `owned.includes(ex.requires[0][0])` — makes the
 * first two cases below fail, because a dumbbell-only household then passes the
 * check on the dumbbell alone and gets prescribed a bench press.
 */
describe('equipment eligibility', () => {
  const exercise = (id: string, requires: Equipment[][]): Exercise =>
    ({
      id,
      name: id,
      role: 'main',
      requires,
      pattern: 'push_h',
      primaryMuscles: ['chest'],
      secondaryMuscles: [],
      tier: 1,
      unilateral: false,
      repRange: [8, 12],
      secondsPerRep: 3,
      setupSeconds: 10,
      media: { images: [], instructions: [] },
      loads: [],
    }) as Exercise

  const DUMBBELL_ONLY: Equipment[] = ['bodyweight', 'dumbbell']

  it('excludes a movement needing dumbbell AND bench from a dumbbell-only kit', () => {
    expect(canPerform(exercise('bench-press', [['dumbbell', 'bench']]), DUMBBELL_ONLY)).toBe(false)
  })

  it('excludes it whichever order the kit lists the items in', () => {
    expect(canPerform(exercise('bench-press', [['bench', 'dumbbell']]), DUMBBELL_ONLY)).toBe(false)
    expect(canPerform(exercise('bench-press', [['dumbbell', 'bench']]), ['bench'])).toBe(false)
  })

  it('includes it once the missing item is owned', () => {
    expect(
      canPerform(exercise('bench-press', [['dumbbell', 'bench']]), [...DUMBBELL_ONLY, 'bench']),
    ).toBe(true)
  })

  it('accepts any ONE of the alternative kits', () => {
    const dips = exercise('chair-dips', [['chair'], ['bench'], ['step']])
    expect(canPerform(dips, ['bodyweight', 'step'])).toBe(true)
    expect(canPerform(dips, ['bodyweight', 'chair'])).toBe(true)
    expect(canPerform(dips, DUMBBELL_ONLY)).toBe(false)
  })

  /**
   * The bug alternative kits introduced, and the reason `allCanPerform` is not
   * `canPerform(ex, A ∩ B)`.
   *
   * MUTATION-CHECKED: reverting the app + generator to "intersect the two
   * equipment lists, then check that" fails the first case — A on a chair and
   * B on a step can both do a chair dip, but their intersected list holds
   * neither, so the movement silently disappears for a pair who can do it.
   */
  it('a shared session keeps what each person can do with their OWN kit', () => {
    const dips = exercise('chair-dips', [['chair'], ['bench'], ['step']])
    const withChair: Equipment[] = ['bodyweight', 'dumbbell', 'chair']
    const withStep: Equipment[] = ['bodyweight', 'dumbbell', 'step']

    expect(allCanPerform(dips, [withChair, withStep])).toBe(true)
    // ...and the intersection, which is what a merged list would have produced:
    const intersection = withChair.filter((e) => withStep.includes(e))
    expect(canPerform(dips, intersection)).toBe(false)
  })

  it('a shared session still drops what only ONE person can do', () => {
    const bandPull = exercise('band-pull-apart', [['band']])
    expect(allCanPerform(bandPull, [['bodyweight', 'band'], ['bodyweight']])).toBe(false)
    expect(allCanPerform(bandPull, [['bodyweight', 'band']])).toBe(true)
  })

  it('treats bodyweight as owned even when a profile forgets to list it', () => {
    expect(canPerform(exercise('push-up', [['bodyweight']]), ['dumbbell'])).toBe(true)
  })

  it('keeps the real catalog free of bench-only movements for a home kit', () => {
    const HOME: Equipment[] = ['bodyweight', 'dumbbell', 'band', 'roller', 'chair', 'wall', 'step']
    const unreachable = catalog.filter((ex) => !canPerform(ex, HOME))
    expect(unreachable.map((e) => e.id)).toEqual([])
  })
})

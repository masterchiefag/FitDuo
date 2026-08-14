import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogSchema } from '../src/core/catalog/types'
import {
  DURATION_MAX_S,
  DURATION_MIN_S,
  generateWorkout,
} from '../src/core/generator/generate'
import { addDays } from '../src/core/dates'
import type {
  DayHistory,
  GeneratorInput,
  ParticipantInput,
} from '../src/core/generator/types'

const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'content', 'catalog.json'), 'utf8')),
).exercises

const weightsArb = fc
  .uniqueArray(fc.constantFrom(1, 2.5, 5, 7.5, 10, 12.5, 15, 20), {
    minLength: 1,
    maxLength: 6,
  })
  .map((w) => [...w].sort((a, b) => a - b))

const participantArb = (userId: string): fc.Arbitrary<ParticipantInput> =>
  fc.record({
    userId: fc.constant(userId),
    availableWeights: weightsArb,
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

  it('honors the 3-day no-repeat window when simulating consecutive days', () => {
    const base: GeneratorInput = {
      householdId: 'home',
      dateISO: '2026-08-10',
      generatorVersion: 1,
      catalog,
      scheduledDays: [true, true, true, true, true, true, true],
      participants: [
        { userId: 'p1', availableWeights: [5, 10], maxTier: 2, progression: {} },
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
          const gap =
            (Date.parse(date) - Date.parse(last)) / 86_400_000
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

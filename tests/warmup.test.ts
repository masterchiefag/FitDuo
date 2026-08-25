import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  catalogSchema,
  type Equipment,
  type Exercise,
  type WarmupPhase,
} from '../src/core/catalog/types'
import { generateWorkout } from '../src/core/generator/generate'
import { phaseQuotas, selectWarmup } from '../src/core/generator/warmup'
import { mulberry32 } from '../src/core/generator/prng'
import type { Block, GeneratorInput, ParticipantInput } from '../src/core/generator/types'

/**
 * The warm-up rule: RAMP order (raise → mobilise → rehearse), with the day
 * breaking ties inside a phase.
 *
 * Two things have to hold at once and they pull against each other — the order
 * is fixed and the content moves with the day, while the item count and the
 * seconds are inputs the rule must never touch, or it would quietly relocate a
 * session's duration out from under `fitToBudget`.
 */

const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'content', 'catalog.json'), 'utf8')),
).exercises
const byId = new Map(catalog.map((e) => [e.id, e]))
const warmupPool = catalog.filter((e) => e.role === 'warmup')

const HOME_KIT: Equipment[] = ['bodyweight', 'dumbbell', 'band', 'roller', 'chair', 'wall', 'step']
const MINIMAL_KIT: Equipment[] = ['bodyweight', 'dumbbell']

const person = (userId: string, equipment: Equipment[]): ParticipantInput => ({
  userId,
  availableWeights: [2.5, 5, 7.5, 10, 12.5, 15],
  equipment,
  maxTier: 3,
  progression: {},
})

const input = (over: Partial<GeneratorInput> = {}): GeneratorInput => ({
  householdId: 'home',
  dateISO: '2026-08-25',
  generatorVersion: 1,
  catalog,
  scheduledDays: [true, true, true, true, true, false, false],
  participants: [person('p1', HOME_KIT)],
  recentHistory: [],
  ...over,
})

const warmupOf = (plan: { blocks: Block[] }) =>
  plan.blocks.find((b): b is Extract<Block, { kind: 'warmup' }> => b.kind === 'warmup')!

const phasesOf = (block: Extract<Block, { kind: 'warmup' }>): WarmupPhase[] =>
  block.items.map((i) => byId.get(i.exerciseId)!.warmupPhase!)

const RANK: Record<WarmupPhase, number> = { raise: 0, mobilise: 1, rehearse: 2 }

/** The item count the old shuffle produced — the budget this rule must not move. */
const expectedCount = (targetSeconds: number) =>
  Math.max(3, Math.min(7, Math.round(7 * (targetSeconds / 3300))))

// A spread of real schedules, chosen to reach every day type in TEMPLATES.
const SCHEDULES: boolean[][] = [
  [true, true, true, true, true, false, false], // 5/wk: push pull legs upper full_a
  [true, false, true, false, true, false, false], // 3/wk: full_a full_b full_c
  [true, true, false, true, true, false, false], // 4/wk: upper lower
]
const DATES = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
const DURATIONS = [1200, 1800, 2400, 3300, 3600]

/** Every (schedule, date, duration) plan, so coverage is a fact, not a hope. */
const everyDay = (over: Partial<GeneratorInput> = {}) =>
  SCHEDULES.flatMap((scheduledDays) =>
    DATES.flatMap((dateISO) =>
      DURATIONS.map((targetSeconds) =>
        generateWorkout(input({ scheduledDays, dateISO, targetSeconds, ...over })),
      ),
    ),
  )

describe('phaseQuotas', () => {
  const ALL = { raise: 2, mobilise: 8, rehearse: 4 }

  it('always sums to exactly the count it was given', () => {
    for (let count = 0; count <= 14; count++) {
      const q = phaseQuotas(count, ALL)
      expect(q.raise + q.mobilise + q.rehearse, `count ${count}`).toBe(count)
    }
  })

  it('keeps the whole shape at the three-item floor', () => {
    expect(phaseQuotas(3, ALL)).toEqual({ raise: 1, mobilise: 1, rehearse: 1 })
  })

  it('spends a full warm-up on one raise, a rehearsal pair, and mobility', () => {
    expect(phaseQuotas(7, ALL)).toEqual({ raise: 1, mobilise: 4, rehearse: 2 })
  })

  it('never asks a phase for more than it has, and re-spends the shortfall', () => {
    // No rehearsal movement is relevant today: those slots mobilise instead.
    const q = phaseQuotas(7, { raise: 2, mobilise: 8, rehearse: 0 })
    expect(q).toEqual({ raise: 1, mobilise: 6, rehearse: 0 })
    // A pool too shallow to fill the count at all still returns what exists.
    const thin = phaseQuotas(7, { raise: 1, mobilise: 2, rehearse: 1 })
    expect(thin.raise + thin.mobilise + thin.rehearse).toBe(4)
  })
})

describe('selectWarmup', () => {
  const legDay: Block[] = [
    {
      kind: 'superset',
      label: 'Strength A',
      rounds: 3,
      restSeconds: 75,
      items: [
        { exerciseId: 'db-squat', perPerson: {}, workSeconds: 40 },
        { exerciseId: 'db-romanian-deadlift', perPerson: {}, workSeconds: 40 },
      ],
    },
  ]

  const select = (blocks: Block[], count: number, seed = 1) =>
    selectWarmup({
      blocks,
      pool: warmupPool,
      byId,
      count,
      seconds: 40,
      rng: mulberry32(seed),
    }).map((i) => i.exerciseId)

  it('returns exactly the count it was asked for, at every size', () => {
    for (let count = 0; count <= 10; count++) {
      expect(select(legDay, count).length, `count ${count}`).toBe(
        Math.min(count, warmupPool.length),
      )
    }
  })

  it('carries the seconds it was given, untouched', () => {
    const items = selectWarmup({
      blocks: legDay,
      pool: warmupPool,
      byId,
      count: 7,
      seconds: 40,
      rng: mulberry32(1),
    })
    expect(items.every((i) => i.seconds === 40)).toBe(true)
  })

  it('never repeats a movement inside one warm-up', () => {
    const ids = select(legDay, 7)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rehearses the day when the day has patterns it can rehearse', () => {
    const ids = select(legDay, 7)
    const rehearsals = ids.filter((id) => byId.get(id)!.warmupPhase === 'rehearse')
    expect(rehearsals.length).toBeGreaterThan(0)
  })

  it('is stable for a given seed and moves with a different one', () => {
    expect(select(legDay, 7, 1)).toEqual(select(legDay, 7, 1))
    const seeds = new Set([1, 2, 3, 4, 5].map((s) => select(legDay, 7, s).join(',')))
    expect(seeds.size, 'every seed produced the same warm-up').toBeGreaterThan(1)
  })
})

describe('the generated warm-up', () => {
  /**
   * The finding this rule answers. Before it, a real 55-minute leg day opened
   * `hip-circles → groiners → arm-circles → star-jumps → …` and *ended* on
   * butt-kicks — jumping as the last thing before picking up dumbbells.
   */
  it('always runs raise → mobilise → rehearse', () => {
    for (const plan of everyDay()) {
      const phases = phasesOf(warmupOf(plan))
      const ranks = phases.map((p) => RANK[p])
      expect(
        [...ranks].sort((a, b) => a - b),
        `${plan.dayType}: ${phases.join(' → ')}`,
      ).toEqual(ranks)
    }
  })

  it('opens every session by raising the pulse', () => {
    for (const plan of everyDay()) {
      expect(phasesOf(warmupOf(plan))[0], plan.dayType).toBe('raise')
    }
  })

  /**
   * The short-session gap the blind shuffle left: at the three-item floor, 13
   * of 84 measured days trained the upper body and warmed up nothing above the
   * waist. Stated over every generated day, both directions.
   */
  it('warms up both halves of what the day trains', () => {
    // `core` is deliberately not in either set: every template's circuit trains
    // it, so counting it would turn this into "every warm-up needs a trunk
    // movement" — a stronger claim than the finding, and not one a four-item
    // leg-day warm-up should have to satisfy.
    const UPPER = new Set(['shoulders', 'chest', 'back', 'biceps', 'triceps'])
    const LOWER = new Set(['quads', 'hamstrings', 'glutes', 'calves'])
    const touches = (ex: Exercise[], set: Set<string>) =>
      ex.some((e) => e.primaryMuscles.some((m) => set.has(m)))

    for (const plan of everyDay()) {
      const warmup = warmupOf(plan).items.map((i) => byId.get(i.exerciseId)!)
      const worked = plan.blocks
        .filter(
          (b): b is Extract<Block, { kind: 'superset' | 'circuit' }> =>
            b.kind === 'superset' || b.kind === 'circuit',
        )
        .flatMap((b) => b.items.map((i) => byId.get(i.exerciseId)!))
      const where = `${plan.dayType}: ${warmup.map((e) => e.id).join(' → ')}`
      if (touches(worked, UPPER)) expect(touches(warmup, UPPER), `${where} (no upper)`).toBe(true)
      if (touches(worked, LOWER)) expect(touches(warmup, LOWER), `${where} (no lower)`).toBe(true)
    }
  })

  /**
   * A rehearsal that rehearses nothing you are about to do is not a rehearsal.
   * The catalog's rehearsal movements are all lower-body patterns, so an upper
   * day must spend those slots on mobility instead of closing the warm-up with
   * bodyweight squats before a bench press.
   */
  it('never rehearses a pattern the day does not train', () => {
    const LOWER = new Set(['quads', 'hamstrings', 'glutes', 'calves'])
    for (const plan of everyDay()) {
      const rehearsals = warmupOf(plan)
        .items.map((i) => byId.get(i.exerciseId)!)
        .filter((e) => e.warmupPhase === 'rehearse')
      if (rehearsals.length === 0) continue
      const worked = plan.blocks
        .filter(
          (b): b is Extract<Block, { kind: 'superset' | 'circuit' }> =>
            b.kind === 'superset' || b.kind === 'circuit',
        )
        .flatMap((b) => b.items.map((i) => byId.get(i.exerciseId)!))
      expect(
        worked.some((e) => e.primaryMuscles.some((m) => LOWER.has(m))),
        `${plan.dayType} rehearsed ${rehearsals.map((e) => e.id).join(', ')} without training legs`,
      ).toBe(true)
    }
  })

  /** The rule chooses movements. It must not choose how long the session is. */
  it('spends exactly the item count the budget allowed', () => {
    for (const targetSeconds of DURATIONS) {
      const plan = generateWorkout(input({ targetSeconds }))
      expect(warmupOf(plan).items.length, `${targetSeconds}s`).toBe(expectedCount(targetSeconds))
      expect(warmupOf(plan).items.every((i) => i.seconds === 40)).toBe(true)
    }
  })

  it('is byte-deterministic for the same household, date and duration', () => {
    for (const targetSeconds of DURATIONS) {
      const a = warmupOf(generateWorkout(input({ targetSeconds })))
      const b = warmupOf(generateWorkout(input({ targetSeconds })))
      expect(a.items).toEqual(b.items)
    }
  })

  /** A fixed order must not collapse into a fixed warm-up — this is a daily app. */
  it('still varies day to day', () => {
    const seen = new Set(
      everyDay().map((p) =>
        warmupOf(p)
          .items.map((i) => i.exerciseId)
          .join(','),
      ),
    )
    expect(seen.size).toBeGreaterThan(20)
  })

  it('only ever picks warm-ups the household can actually perform', () => {
    for (const plan of everyDay({ participants: [person('p1', MINIMAL_KIT)] })) {
      for (const item of warmupOf(plan).items) {
        const ex = byId.get(item.exerciseId)!
        expect(ex.role).toBe('warmup')
        expect(ex.requires.some((kit) => kit.every((r) => MINIMAL_KIT.includes(r)))).toBe(true)
      }
    }
  })
})

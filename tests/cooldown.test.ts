import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogSchema, type Equipment, type Exercise } from '../src/core/catalog/types'
import {
  COOLDOWN_CORE_CHAIN,
  MUSCLE_REGIONS,
  selectCooldown,
  workedRegions,
} from '../src/core/generator/cooldown'
import { generateWorkout } from '../src/core/generator/generate'
import { generateMobilitySession, MOBILITY_FOCUS } from '../src/core/generator/mobility'
import { mulberry32 } from '../src/core/generator/prng'
import type { Block, DayType, GeneratorInput, ParticipantInput } from '../src/core/generator/types'

/**
 * The cool-down relevance rule (docs/SESSIONS.md finding 6): a fixed ending
 * chain, preceded by stretches for what the day actually worked.
 *
 * Two things have to hold at once and they pull against each other — the
 * prelude must move with the day, and the time budget must not move at all.
 */

const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'content', 'catalog.json'), 'utf8')),
).exercises
const byId = new Map(catalog.map((e) => [e.id, e]))
const cooldownPool = catalog.filter((e) => e.role === 'cooldown')

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

const cooldownOf = (plan: { blocks: Block[] }) =>
  plan.blocks.find((b): b is Extract<Block, { kind: 'cooldown' }> => b.kind === 'cooldown')!

/** The item count the old shuffle produced — the budget this rule must not move. */
const expectedCount = (targetSeconds: number) =>
  Math.max(2, Math.min(5, Math.round(5 * (targetSeconds / 3300))))

// A spread of real schedules, chosen to reach every day type in TEMPLATES.
const SCHEDULES: boolean[][] = [
  [true, true, true, true, true, false, false], // 5/wk: push pull legs upper full_a
  [true, false, true, false, true, false, false], // 3/wk: full_a full_b full_c
  [true, true, false, true, true, false, false], // 4/wk: upper lower
]
const DATES = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']

/** Every (schedule, date) plan, so day-type coverage is a fact, not a hope. */
const everyDay = () =>
  SCHEDULES.flatMap((scheduledDays) =>
    DATES.map((dateISO) => generateWorkout(input({ scheduledDays, dateISO }))),
  )

describe('workedRegions', () => {
  it('ranks by sets, counting a movement into every region it loads', () => {
    const squat = catalog.find((e) => e.primaryMuscles.includes('quads'))!
    const blocks: Block[] = [
      {
        kind: 'superset',
        label: 'Strength A',
        rounds: 3,
        restSeconds: 75,
        items: [{ exerciseId: squat.id, perPerson: {}, workSeconds: 40 }],
      },
    ]
    expect(workedRegions(blocks, byId)).toEqual(
      // quads → quads + hips, three rounds each; ties break on region name.
      expect.arrayContaining([
        { region: 'hips', sets: 3 },
        { region: 'quads', sets: 3 },
      ]),
    )
  })

  it('ignores warm-up and cool-down blocks — only work counts as worked', () => {
    const blocks: Block[] = [
      { kind: 'warmup', items: [{ exerciseId: 'childs-pose', seconds: 40 }] },
      { kind: 'cooldown', items: [{ exerciseId: 'childs-pose', seconds: 60 }] },
    ]
    expect(workedRegions(blocks, byId)).toEqual([])
  })

  it('maps every muscle group to at least one region', () => {
    for (const [muscle, regions] of Object.entries(MUSCLE_REGIONS)) {
      expect(regions.length, muscle).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('selectCooldown', () => {
  const legDay: Block[] = [
    {
      kind: 'superset',
      label: 'Strength A',
      rounds: 3,
      restSeconds: 75,
      items: [
        { exerciseId: 'db-romanian-deadlift', perPerson: {}, workSeconds: 40 },
        { exerciseId: 'db-squat', perPerson: {}, workSeconds: 40 },
      ],
    },
  ]

  const select = (blocks: Block[], count: number, pool: Exercise[] = cooldownPool) =>
    selectCooldown({ blocks, pool, byId, count, seconds: 60, rng: mulberry32(1) }).map(
      (i) => i.exerciseId,
    )

  it('ends with the core chain, in order', () => {
    expect(select(legDay, 5).slice(-3)).toEqual([...COOLDOWN_CORE_CHAIN])
  })

  it('opens with stretches for what the day worked', () => {
    const ids = select(legDay, 5).slice(0, 2)
    const worked = new Set(workedRegions(legDay, byId).map((r) => r.region))
    for (const id of ids) {
      expect(byId.get(id)!.mobility!.regions.some((r) => worked.has(r)), id).toBe(true)
    }
  })

  it('spends a short budget from the end of the chain, keeping one targeted stretch', () => {
    const ids = select(legDay, 2)
    const worked = new Set(workedRegions(legDay, byId).map((r) => r.region))
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(COOLDOWN_CORE_CHAIN[COOLDOWN_CORE_CHAIN.length - 1])
    expect(byId.get(ids[0]!)!.mobility!.regions.some((r) => worked.has(r))).toBe(true)
  })

  it('fills the requested count even when the pool has nothing relevant', () => {
    // Chain present, but every other stretch is for regions this day never
    // touched: the count still has to hold, or the session gets shorter.
    const pool = cooldownPool.filter(
      (e) =>
        (COOLDOWN_CORE_CHAIN as readonly string[]).includes(e.id) ||
        e.mobility!.regions.every((r) => ['neck', 'shoulders', 'chest'].includes(r)),
    )
    const ids = select(legDay, 5, pool)
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    expect(ids.slice(-3)).toEqual([...COOLDOWN_CORE_CHAIN])
  })

  it('never repeats a stretch', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const ids = select(legDay, count)
      expect(new Set(ids).size, `count ${count}`).toBe(ids.length)
    }
  })
})

describe('the generated cool-down', () => {
  it('contributes exactly the time the old rule did', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(1200, 1800, 2400, 3000, 3300, 3600),
        fc.constantFrom(...SCHEDULES),
        fc.constantFrom(...DATES),
        fc.boolean(),
        (targetSeconds, scheduledDays, dateISO, duo) => {
          const plan = generateWorkout(
            input({
              targetSeconds,
              scheduledDays,
              dateISO,
              participants: duo
                ? [person('p1', HOME_KIT), person('p2', MINIMAL_KIT)]
                : [person('p1', HOME_KIT)],
            }),
          )
          const cooldown = cooldownOf(plan)
          expect(cooldown.items).toHaveLength(expectedCount(targetSeconds))
          for (const item of cooldown.items) expect(item.seconds).toBe(60)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('resolves: every id is a real cool-down movement with region tags, listed once', () => {
    for (const plan of everyDay()) {
      const ids = cooldownOf(plan).items.map((i) => i.exerciseId)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) {
        const ex = byId.get(id)
        expect(ex, id).toBeDefined()
        expect(ex!.role).toBe('cooldown')
        expect(ex!.mobility?.regions.length, id).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('always ends the same way, on every day type', () => {
    const seen = new Set<DayType>()
    for (const plan of everyDay()) {
      seen.add(plan.dayType)
      expect(cooldownOf(plan).items.map((i) => i.exerciseId).slice(-3)).toEqual([
        ...COOLDOWN_CORE_CHAIN,
      ])
    }
    // The promise is "every day type", so the loop has to have visited them.
    expect(seen.size).toBe(8)
  })

  it('opens with stretches for regions the session actually worked', () => {
    for (const plan of everyDay()) {
      const worked = new Set(workedRegions(plan.blocks, byId).map((r) => r.region))
      const prelude = cooldownOf(plan)
        .items.map((i) => i.exerciseId)
        .slice(0, -COOLDOWN_CORE_CHAIN.length)
      expect(prelude.length, plan.dayType).toBeGreaterThanOrEqual(1)
      for (const id of prelude) {
        const regions = byId.get(id)!.mobility!.regions
        expect(regions.some((r) => worked.has(r)), `${plan.dayType}: ${id} vs ${[...worked]}`).toBe(
          true,
        )
      }
    }
  })

  it('follows the plan that survived fitting, not the draft', () => {
    // A 20-minute request drops work blocks outright. Whatever remains is what
    // the cool-down must answer — a prelude for a block nobody ran is the same
    // complaint by another route.
    for (const dateISO of DATES) {
      const plan = generateWorkout(input({ dateISO, targetSeconds: 1200 }))
      const worked = new Set(workedRegions(plan.blocks, byId).map((r) => r.region))
      const prelude = cooldownOf(plan)
        .items.map((i) => i.exerciseId)
        .filter((id) => !(COOLDOWN_CORE_CHAIN as readonly string[]).includes(id))
      for (const id of prelude) {
        expect(byId.get(id)!.mobility!.regions.some((r) => worked.has(r)), id).toBe(true)
      }
    }
  })

  it('a leg day gets leg stretches, an upper day gets none of them', () => {
    const legRegions = new Set(['hamstrings', 'quads', 'glutes', 'calves'])
    const legStretches = (plan: { blocks: Block[] }) =>
      cooldownOf(plan)
        .items.map((i) => byId.get(i.exerciseId)!)
        .filter((e) => e.mobility!.regions.some((r) => legRegions.has(r)))

    const legs = generateWorkout(input({ dateISO: '2026-08-26' })) // legs in the 5/wk rotation
    const upper = generateWorkout(input({ dateISO: '2026-08-27' })) // upper
    expect(legs.dayType).toBe('legs')
    expect(upper.dayType).toBe('upper')
    expect(legStretches(legs).length).toBeGreaterThanOrEqual(1)
    expect(legStretches(upper)).toEqual([])
  })
})

describe('the boundary with mobility sessions', () => {
  /**
   * The lower-body regions were added for cool-downs. Mobility sessions choose
   * from their own focus lists, and this rule was not allowed to disturb them —
   * so the leg stretches must stay invisible there until someone decides
   * otherwise on purpose.
   */
  it('leaves mobility session selection alone', () => {
    const legOnly = cooldownPool
      .filter((e) => e.mobility!.regions.every((r) => ['hamstrings', 'quads', 'calves'].includes(r)))
      .map((e) => e.id)
    expect(legOnly.length).toBeGreaterThanOrEqual(2)

    for (const focus of Object.keys(MOBILITY_FOCUS) as (keyof typeof MOBILITY_FOCUS)[]) {
      const plan = generateMobilitySession({
        householdId: 'home',
        dateISO: '2026-08-25',
        generatorVersion: 1,
        catalog,
        focus,
        participantIds: ['p1'],
        kits: [HOME_KIT],
      })
      const ids = plan.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))
      for (const id of legOnly) expect(ids, focus).not.toContain(id)
    }
  })
})

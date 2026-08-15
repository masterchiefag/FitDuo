import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allCanPerform, canPerform } from '../src/core/catalog/equipment'
import { catalogSchema, type Equipment, type Exercise } from '../src/core/catalog/types'
import {
  DURATION_MAX_S,
  DURATION_MIN_S,
  ThinKitError,
  durationBand,
  estimatePlanSeconds,
  generateWorkout,
} from '../src/core/generator/generate'
import { CHANGEOVER_SECONDS } from '../src/core/player/reducer'
import { addDays } from '../src/core/dates'
import { nextTarget } from '../src/core/generator/progression'
import type {
  DayHistory,
  ExerciseProgress,
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
            // assertion agree with any bug it contains. The assumed-fixture
            // list is restated here for the same reason.
            const ASSUMED = ['bodyweight', 'chair', 'wall']
            const usableBy = (owned: Equipment[]) =>
              ex.requires.some((kit) =>
                kit.every((need) => ASSUMED.includes(need) || owned.includes(need)),
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

  it('every work item carries the max set length across participants', () => {
    const byId = new Map(catalog.map((e) => [e.id, e]))
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generateWorkout(input)
        for (const b of plan.blocks) {
          if (b.kind !== 'superset' && b.kind !== 'circuit') continue
          for (const item of b.items) {
            const ex = byId.get(item.exerciseId)!
            const each = Object.values(item.perPerson).map(
              (t) =>
                ex.setupSeconds +
                (ex.repRange[0] === 1 && ex.repRange[1] === 1 ? 1 : t.targetReps) *
                  ex.secondsPerRep *
                  (ex.unilateral ? 2 : 1),
            )
            expect(item.workSeconds).toBe(Math.max(...each))
          }
        }
      }),
      { numRuns: 60 },
    )
  })

  /**
   * The estimate is what `fitToBudget` optimises against, so anything it forgets
   * becomes overrun in the real session. Changeovers are ~3 minutes a session:
   * dropping them from the estimate plans a session that always runs long.
   *
   * MUTATION-CHECKED: removing the changeover term from `estimatePlanSeconds`
   * fails this — the recomputed total exceeds the reported one by 3×2×15s+.
   */
  it('the estimate counts the changeovers the player will actually insert', () => {
    const plan = generateWorkout({
      householdId: 'home',
      dateISO: '2026-08-14',
      generatorVersion: 1,
      catalog,
      scheduledDays: [true, true, true, true, true, false, false],
      participants: [
        { userId: 'p1', availableWeights: [5, 10], equipment: [...HOME_KIT], maxTier: 2, progression: {} },
      ],
      recentHistory: [],
    })
    let changeovers = 0
    let byHand = 0
    plan.blocks.forEach((b, i) => {
      if (i > 0) byHand += 20 // BLOCK_TRANSITION_SECONDS
      if (b.kind === 'superset' || b.kind === 'circuit') {
        const perRound = b.items.reduce((a, it) => a + it.workSeconds, 0)
        const co = b.items.length - 1 // all distinct within a block
        changeovers += b.rounds * co
        byHand += b.rounds * (perRound + co * CHANGEOVER_SECONDS) + (b.rounds - 1) * b.restSeconds
      } else {
        byHand += b.items.reduce((a, it) => a + it.seconds, 0)
      }
    })
    expect(changeovers).toBeGreaterThan(0)
    expect(estimatePlanSeconds(plan.blocks)).toBe(byHand)
    expect(plan.estimatedSeconds).toBe(byHand)
  })

  it('fits whatever duration it is asked for, and names short sessions short', () => {
    fc.assert(
      fc.property(inputArb, fc.constantFrom(1200, 2100, 3300), (input, targetSeconds) => {
        const plan = generateWorkout({ ...input, targetSeconds })
        const [min, max] = durationBand(targetSeconds)
        expect(plan.estimatedSeconds).toBeGreaterThanOrEqual(min)
        expect(plan.estimatedSeconds).toBeLessThanOrEqual(max)
        expect(plan.mode).toBe(targetSeconds <= 2700 ? 'short' : 'full')
        // Still a real session: warm-up, at least one work block, cool-down.
        expect(plan.blocks.some((b) => b.kind === 'warmup')).toBe(true)
        expect(plan.blocks.some((b) => b.kind === 'cooldown')).toBe(true)
        expect(
          plan.blocks.filter((b) => b.kind === 'superset' || b.kind === 'circuit').length,
        ).toBeGreaterThanOrEqual(1)
      }),
      { numRuns: 120 },
    )
  })

  it('a 20-minute session is the same engine, not a truncated one', () => {
    const base: GeneratorInput = {
      householdId: 'home',
      dateISO: '2026-08-14',
      generatorVersion: 1,
      catalog,
      scheduledDays: [true, true, true, true, true, false, false],
      participants: [
        { userId: 'p1', availableWeights: [5, 10], equipment: [...HOME_KIT], maxTier: 2, progression: {} },
      ],
      recentHistory: [],
    }
    const short = generateWorkout({ ...base, targetSeconds: 1200 })
    const full = generateWorkout(base)
    expect(short.estimatedSeconds).toBeLessThan(full.estimatedSeconds)
    // Fewer blocks and a shorter warm-up — not the same plan cut off midway.
    expect(short.blocks.length).toBeLessThan(full.blocks.length)
    const warmupItems = (p: typeof short) =>
      p.blocks.find((b) => b.kind === 'warmup')!.items.length
    expect(warmupItems(short)).toBeLessThan(warmupItems(full))
    // Deterministic, like every other plan.
    expect(generateWorkout({ ...base, targetSeconds: 1200 })).toEqual(short)
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
 * The terminal invariant of the target pipeline (PLAN A0): `weightSnap` and
 * `repClamp` run last, so no rule above them — today's progression, tomorrow's
 * readiness and pain adjusters — can emit a prescription that cannot be lifted
 * or is outside the movement's rep range.
 *
 * It lands with R1 because R1 is where targets start being prescribed with
 * nobody confirming them: an unliftable number used to be caught by a human
 * looking at the screen before tapping Done.
 *
 * MUTATION-CHECKED: dropping either clamp from `nextTarget` fails this — a
 * stale 17.5 kg in history survives into a plan for someone who owns 5s and
 * 10s, and a 40-rep history entry survives into a 8–12 rep movement.
 */
describe('no rule can emit an unliftable or out-of-range prescription', () => {
  const progressArb = (repCeiling: number): fc.Arbitrary<ExerciseProgress> =>
    fc.record({
      lastWeight: fc.constantFrom(0, 1, 3, 5, 12.5, 17.5, 40),
      lastTargetReps: fc.integer({ min: 1, max: repCeiling }),
      lastActualReps: fc.array(fc.integer({ min: 0, max: repCeiling }), { maxLength: 5 }),
      lastFeedback: fc.constantFrom('too_easy' as const, 'right' as const, 'too_hard' as const, null),
      bestE1rm: fc.nat(),
    })

  it('holds for every exercise, kit and history the log can produce', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...catalog),
        weightsArb,
        fc.option(progressArb(50), { nil: undefined }),
        (ex, weights, progress) => {
          const target = nextTarget(ex, weights, progress)
          if (target.weight !== 0) expect(weights).toContain(target.weight)
          expect(target.targetReps).toBeGreaterThanOrEqual(ex.repRange[0])
          expect(target.targetReps).toBeLessThanOrEqual(ex.repRange[1])
        },
      ),
      { numRuns: 500 },
    )
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
    const stepUp = exercise('db-step-up', [
      ['dumbbell', 'step'],
      ['dumbbell', 'bench'],
    ])
    expect(canPerform(stepUp, ['bodyweight', 'dumbbell', 'step'])).toBe(true)
    expect(canPerform(stepUp, ['bodyweight', 'dumbbell', 'bench'])).toBe(true)
    expect(canPerform(stepUp, DUMBBELL_ONLY)).toBe(false)
  })

  it('assumes the fixtures every home has, and only those', () => {
    // chair/wall are assumed present — nobody lists furniture as equipment, and
    // gating on it silently deletes chair dips from a household with chairs.
    expect(canPerform(exercise('dips', [['chair']]), ['dumbbell'])).toBe(true)
    expect(canPerform(exercise('lat-stretch', [['wall']]), ['dumbbell'])).toBe(true)
    // A step and a bench are not furniture everyone has. Still declared.
    expect(canPerform(exercise('step-up', [['step']]), ['dumbbell'])).toBe(false)
    expect(canPerform(exercise('press', [['bench']]), ['dumbbell'])).toBe(false)
  })

  /**
   * The bug alternative kits introduced, and the reason `allCanPerform` is not
   * `canPerform(ex, A ∩ B)`.
   *
   * Uses step vs bench deliberately: chair and wall are assumed present for
   * everyone, so a chair/step pair would pass under either rule and the test
   * would not bite.
   *
   * MUTATION-CHECKED: reverting the app + generator to "intersect the two
   * equipment lists, then check that" fails the first case — one person on a
   * step and the other on a bench can both do the movement, but their
   * intersected list holds neither, so it vanishes for a pair who can do it.
   */
  it('a shared session keeps what each person can do with their OWN kit', () => {
    const stepUp = exercise('db-step-up', [
      ['dumbbell', 'step'],
      ['dumbbell', 'bench'],
    ])
    const withStep: Equipment[] = ['bodyweight', 'dumbbell', 'step']
    const withBench: Equipment[] = ['bodyweight', 'dumbbell', 'bench']

    expect(allCanPerform(stepUp, [withStep, withBench])).toBe(true)
    // ...and the intersection, which is what a merged list would have produced:
    const intersection = withStep.filter((e) => withBench.includes(e))
    expect(canPerform(stepUp, intersection)).toBe(false)
  })

  it('a shared session still drops what only ONE person can do', () => {
    const bandPull = exercise('band-pull-apart', [['band']])
    expect(allCanPerform(bandPull, [['bodyweight', 'band'], ['bodyweight']])).toBe(false)
    expect(allCanPerform(bandPull, [['bodyweight', 'band']])).toBe(true)
  })

  it('treats bodyweight as owned even when a profile forgets to list it', () => {
    expect(canPerform(exercise('push-up', [['bodyweight']]), ['dumbbell'])).toBe(true)
  })

  /**
   * The regression this PR exists to prevent, stated as the specific movements
   * it re-cued rather than as "nothing may need a bench". A blanket rule would
   * also forbid ever curating a genuine bench press or pull-up, quietly turning
   * a bug fix into a permanent content ceiling; pool depth per kit is asserted
   * in tests/catalog.test.ts and is what actually protects the sessions.
   */
  /**
   * The blank home screen, locked at the type level.
   *
   * `tryPlanForToday` turns exactly `ThinKitError` into `null` and rethrows the
   * rest — so if this throw degrades to a plain `Error`, Today white-screens
   * again and every other test still passes. That regression has now happened
   * twice in this PR's history (docs/DECISIONS.md), hence a test on the class
   * rather than on the message.
   *
   * MUTATION-CHECKED: `throw new Error(...)` in selectForSlot fails this.
   */
  it('a kit too thin to fill a pattern throws ThinKitError, naming the pattern', () => {
    const thin = () =>
      generateWorkout({
        householdId: 'home',
        dateISO: '2026-08-14',
        generatorVersion: 1,
        catalog,
        scheduledDays: [true, true, true, true, true, false, false],
        participants: [
          {
            userId: 'p1',
            availableWeights: [],
            equipment: ['bodyweight'],
            maxTier: 2,
            progression: {},
          },
        ],
        recentHistory: [],
      })
    expect(thin).toThrow(ThinKitError)
    let caught: unknown
    try {
      thin()
    } catch (err) {
      caught = err
    }
    // PreviewScreen renders this field, so it has to survive.
    expect((caught as ThinKitError).pattern).toBe('pull_h')
  })

  it('the movements re-cued for the floor need nothing beyond dumbbells', () => {
    const RECUED_FOR_THE_FLOOR = [
      'db-chest-press',
      'db-chest-fly',
      'db-skullcrusher',
      'db-pullover',
      'db-arnold-press',
      'db-reverse-fly',
      'db-one-arm-row',
      'scap-retraction',
      'shoulder-external-rotation',
      'prone-rear-delt-raise',
      // Found only by looking at the frames: the source text for these never
      // says "bench", so the grep-based audit missed both. See the setupNote
      // doc-comment in content/scripts/selection.ts.
      'db-split-squat',
      'db-triceps-kickback',
    ]
    for (const id of RECUED_FOR_THE_FLOOR) {
      const ex = catalog.find((e) => e.id === id)
      expect(ex, `${id} missing from the catalog`).toBeDefined()
      expect(canPerform(ex!, ['bodyweight', 'dumbbell']), id).toBe(true)
    }
  })
})

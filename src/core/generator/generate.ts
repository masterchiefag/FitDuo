import { allCanPerform } from '../catalog/equipment'
import { ladderFor } from '../catalog/resistance'
import type { Exercise, Pattern } from '../catalog/types'
import { daysBetween, weekdayIndex } from '../dates'
import { BLOCK_TRANSITION_SECONDS, CHANGEOVER_SECONDS } from '../player/reducer'
import { selectCooldown } from './cooldown'
import { fnv1a32, mulberry32, pick } from './prng'
import { nextTarget } from './progression'
import { selectWarmup } from './warmup'
import { isWorkBlock } from '../player/position'
import type {
  Block,
  DayType,
  ParticipantInput,
  GeneratorInput,
  LastPerformance,
  PersonTarget,
  WorkItem,
  WorkoutPlan,
} from './types'

/** A normal session: 55 minutes. Everything else is this, scaled. */
export const DEFAULT_TARGET_SECONDS = 3300

/** Anything under this is a `short` session — its own mode and XP rule. */
export const SHORT_SESSION_MAX_S = 2700 // 45 min

/**
 * How close to the requested length a plan has to land. Duration is an input
 * now, so the band has to be a function of it: a fixed 50–60 min window would
 * make every 20-minute request unsatisfiable by construction.
 */
const BAND_TOLERANCE = 0.09

export function durationBand(targetSeconds: number): [min: number, max: number] {
  return [
    Math.round(targetSeconds * (1 - BAND_TOLERANCE)),
    Math.round(targetSeconds * (1 + BAND_TOLERANCE)),
  ]
}

export const [DURATION_MIN_S, DURATION_MAX_S] = durationBand(DEFAULT_TARGET_SECONDS)

const WARMUP_ITEMS = 7
const WARMUP_SECONDS = 40
const COOLDOWN_ITEMS = 5
const COOLDOWN_SECONDS = 60
// The player's own pauses — shared so estimates match real sessions.
const TRANSITION_S = BLOCK_TRANSITION_SECONDS
const NO_REPEAT_DAYS = 3
const WEEKLY_TARGET_SETS = 10

// ─── day-type rotation ───────────────────────────────────────────────────────

function rotationFor(daysPerWeek: number): DayType[] {
  if (daysPerWeek <= 2) return ['full_a', 'full_b']
  if (daysPerWeek === 3) return ['full_a', 'full_b', 'full_c']
  if (daysPerWeek === 4) return ['upper', 'lower', 'upper', 'lower']
  if (daysPerWeek === 5) return ['push', 'pull', 'legs', 'upper', 'full_a']
  const week: DayType[] = ['push', 'pull', 'legs', 'push', 'pull', 'legs', 'full_a']
  return week.slice(0, daysPerWeek)
}

export function dayTypeFor(scheduledDays: boolean[], dateISO: string): DayType {
  const scheduled = scheduledDays.filter(Boolean).length || 5
  const rotation = rotationFor(scheduled)
  const today = weekdayIndex(dateISO)
  const scheduledIdx: number[] = []
  for (let d = 0; d < 7; d++) if (scheduledDays[d]) scheduledIdx.push(d)
  // No configured schedule: rotate by weekday so variety still happens.
  if (scheduledIdx.length === 0) return rotation[today % rotation.length]!
  const pos = scheduledIdx.indexOf(today)
  if (pos >= 0) return rotation[pos % rotation.length]!
  // Bonus workout on a rest day: the NEXT rotation slot (wraps), never a
  // back-to-back repeat of the week's last scheduled day type.
  const before = scheduledIdx.filter((d) => d < today).length
  return rotation[before % rotation.length]!
}

/**
 * Slot templates: 3 superset pairs + 1 circuit triple per day type.
 *
 * Exported because it defines how many DISTINCT movements a day consumes per
 * pattern (a pull day wants five different `pull_h`), which is the real floor
 * for catalog pool depth — see tests/catalog.test.ts. PLAN A0 moves this to
 * content/day-templates.json.
 */
export const TEMPLATES: Record<DayType, { supersets: [Pattern, Pattern][]; circuit: Pattern[] }> = {
  full_a: {
    supersets: [
      ['squat', 'pull_h'],
      ['push_h', 'hinge'],
      ['push_v', 'pull_v'],
    ],
    circuit: ['lunge', 'core', 'core'],
  },
  full_b: {
    supersets: [
      ['hinge', 'push_h'],
      ['pull_h', 'lunge'],
      ['push_v', 'core'],
    ],
    circuit: ['squat', 'core', 'pull_v'],
  },
  full_c: {
    supersets: [
      ['lunge', 'pull_v'],
      ['push_v', 'squat'],
      ['pull_h', 'hinge'],
    ],
    circuit: ['hinge', 'core', 'push_h'],
  },
  upper: {
    supersets: [
      ['push_h', 'pull_h'],
      ['push_v', 'pull_v'],
      ['push_h', 'pull_h'],
    ],
    circuit: ['push_v', 'core', 'pull_h'],
  },
  lower: {
    supersets: [
      ['squat', 'hinge'],
      ['lunge', 'hinge'],
      ['squat', 'lunge'],
    ],
    circuit: ['hinge', 'core', 'squat'],
  },
  push: {
    supersets: [
      ['push_h', 'push_v'],
      ['push_h', 'core'],
      ['push_v', 'push_h'],
    ],
    circuit: ['push_h', 'core', 'push_v'],
  },
  pull: {
    supersets: [
      ['pull_h', 'pull_v'],
      ['pull_h', 'core'],
      ['pull_v', 'pull_h'],
    ],
    circuit: ['pull_h', 'core', 'pull_h'],
  },
  legs: {
    supersets: [
      ['squat', 'hinge'],
      ['lunge', 'squat'],
      ['hinge', 'lunge'],
    ],
    circuit: ['squat', 'core', 'lunge'],
  },
}

/**
 * No movement in the catalog fits a slot with the kit everyone in this session
 * owns. A real answer, not a defect — but a distinct one, so a caller can tell
 * "this household needs more gear" from "the generator is broken" instead of
 * catching everything and calling it the former.
 */
export class ThinKitError extends Error {
  readonly pattern: Pattern
  constructor(pattern: Pattern) {
    super(`no candidates for pattern ${pattern}`)
    this.name = 'ThinKitError'
    this.pattern = pattern
  }
}

// ─── selection ───────────────────────────────────────────────────────────────

interface SelectionCtx {
  rng: () => number
  mains: Exercise[]
  maxTier: 1 | 2 | 3
  usedToday: Set<string>
  lastUsed: Map<string, number> // exerciseId -> days since last use
  muscleSets7d: Map<string, number>
}

// Primary muscles each slot pattern is "really for" — keeps accessory moves
// (calf raises, side bends) from claiming a big compound slot.
const SLOT_MUSCLES: Record<Pattern, string[]> = {
  squat: ['quads', 'glutes'],
  hinge: ['hamstrings', 'glutes'],
  lunge: ['quads', 'glutes'],
  push_h: ['chest', 'triceps'],
  push_v: ['shoulders'],
  pull_h: ['back', 'biceps'],
  pull_v: ['back'],
  core: ['core'],
  carry: ['core'],
  mobility: [],
}

function scoreOf(ex: Exercise, pattern: Pattern, ctx: SelectionCtx): number {
  const daysSince = ctx.lastUsed.get(ex.id) ?? 99
  const novelty = Math.min(daysSince, 14) / 14
  const need =
    ex.primaryMuscles.reduce(
      (acc, m) => acc + Math.max(0, 1 - (ctx.muscleSets7d.get(m) ?? 0) / WEEKLY_TARGET_SETS),
      0,
    ) / ex.primaryMuscles.length
  const muscleFit = ex.primaryMuscles.some((m) => SLOT_MUSCLES[pattern].includes(m)) ? 1 : 0
  return 3 * novelty + 2 * need + 1.5 * muscleFit
}

function selectForSlot(pattern: Pattern, ctx: SelectionCtx): Exercise {
  // Relaxation ladder keeps selection total: no-repeat 3 -> 2 -> 0 days, then tier.
  for (const relax of [
    { window: NO_REPEAT_DAYS, tier: ctx.maxTier },
    { window: 2, tier: ctx.maxTier },
    { window: 0, tier: ctx.maxTier },
    { window: 0, tier: 3 as const },
  ]) {
    const pool = ctx.mains.filter(
      (ex) =>
        ex.pattern === pattern &&
        ex.tier <= relax.tier &&
        !ctx.usedToday.has(ex.id) &&
        (ctx.lastUsed.get(ex.id) ?? 99) > relax.window,
    )
    if (pool.length > 0) {
      const ranked = pool
        .map((ex) => ({ ex, score: scoreOf(ex, pattern, ctx) }))
        .sort((a, b) => b.score - a.score || (a.ex.id < b.ex.id ? -1 : 1))
      const top = ranked.slice(0, 3).map((r) => r.ex)
      const chosen = pick(ctx.rng, top)
      ctx.usedToday.add(chosen.id)
      return chosen
    }
  }
  throw new ThinKitError(pattern)
}

// ─── time budgeting ──────────────────────────────────────────────────────────

function setSeconds(ex: Exercise, target: PersonTarget): number {
  const sides = ex.unilateral ? 2 : 1
  if (ex.repRange[0] === 1 && ex.repRange[1] === 1)
    return ex.setupSeconds + ex.secondsPerRep * sides
  return ex.setupSeconds + target.targetReps * ex.secondsPerRep * sides
}

/**
 * One prescribed movement, targeted for everyone in the session.
 *
 * Shared with the relief generator rather than duplicated there: an Activate
 * set is a set, and the moment the two builders drift is the moment a band
 * external rotation stops progressing the way a curl does for no reason anyone
 * could state. The ladder each person climbs comes from `ladderFor`, so this
 * never has to know whether the load is kilos or latex.
 */
export function buildWorkItem(ex: Exercise, participants: ParticipantInput[]): WorkItem {
  const perPerson: Record<string, PersonTarget> = {}
  const lastTime: Record<string, LastPerformance> = {}
  for (const p of participants) {
    const progress = p.progression[ex.id]
    perPerson[p.userId] = nextTarget(ex, ladderFor(ex, p), progress)
    // The set the progression state was read from: same set for both numbers,
    // so "7.5 kg × 10" is one performance and not two halves of different ones.
    if (progress) {
      lastTime[p.userId] = {
        weight: progress.lastWeight,
        reps:
          progress.lastActualReps[progress.lastActualReps.length - 1] ?? progress.lastTargetReps,
      }
    }
  }
  const item: WorkItem = {
    exerciseId: ex.id,
    perPerson,
    workSeconds: workItemSeconds(ex, perPerson),
  }
  return Object.keys(lastTime).length > 0 ? { ...item, lastTime } : item
}

/** The set's length: the MAX across participants — they lift simultaneously. */
export function workItemSeconds(ex: Exercise, perPerson: Record<string, PersonTarget>): number {
  return Math.max(...Object.values(perPerson).map((t) => setSeconds(ex, t)))
}

/**
 * How long the plan actually takes to run, including every pause the player
 * inserts. The changeovers are the load-bearing part: 15s between different
 * movements inside a round is ~3 minutes a session, and leaving them out made
 * `fitToBudget` plan a session that always overran.
 */
export function estimatePlanSeconds(blocks: Block[]): number {
  let total = 0
  for (const [i, b] of blocks.entries()) {
    // The 20s transition follows a TIMED block only. A work block ends at the
    // block gate, which waits for a person and then starts the next block on
    // the same tick — billing 20s there invents ~80s a session, and the fitter
    // then trims real work to make room for time the player never spends.
    const timed = b.kind === 'warmup' || b.kind === 'cooldown' || b.kind === 'mobility'
    if (timed && blocks[i + 1]) total += TRANSITION_S
    if (timed) {
      total += b.items.reduce((a, i) => a + i.seconds, 0)
    } else {
      const round = b.items.reduce((a, i) => a + i.workSeconds, 0)
      total += b.rounds * (round + changeoversPerRound(b.items) * CHANGEOVER_SECONDS)
      total += (b.rounds - 1) * b.restSeconds
    }
  }
  return total
}

/** Changeovers sit between DIFFERENT consecutive movements, never on the round
 *  boundary — that edge is rest (or the block gate). */
function changeoversPerRound(items: WorkItem[]): number {
  let n = 0
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.exerciseId !== items[i - 1]!.exerciseId) n++
  }
  return n
}

const MIN_ROUNDS = 2
const MAX_ROUNDS = 4

/**
 * Deterministic, bounded fitting into the band around `targetSeconds`.
 *
 * Three levers, coarsest first: how many work blocks there are, how many rounds
 * each runs, and how long the rests are. The first is what makes a 20-minute
 * request possible at all — no amount of rest-trimming fits four blocks and a
 * seven-move warm-up into twenty minutes.
 */
function fitToBudget(blocks: Block[], [minS, maxS]: [number, number]): Block[] {
  const work = () => blocks.filter(isWorkBlock)
  const estimate = () => estimatePlanSeconds(blocks)

  const fitRounds = () => {
    for (let guard = 0; guard < 8 && estimate() < minS; guard++) {
      const target = work().find((b) => b.rounds < MAX_ROUNDS)
      if (!target) break
      target.rounds += 1
    }
    for (let guard = 0; guard < 8 && estimate() > maxS; guard++) {
      const target = [...work()].reverse().find((b) => b.rounds > MIN_ROUNDS)
      if (!target) break
      target.rounds -= 1
    }
  }

  // Structural: still over budget with the rounds floored means there is simply
  // one block too many. Drop from the end (the finisher goes first).
  for (let guard = 0; guard < 8; guard++) {
    fitRounds()
    if (estimate() <= maxS) break
    const blocksOfWork = work()
    if (blocksOfWork.length <= 1) break
    const last = blocksOfWork[blocksOfWork.length - 1]!
    blocks = blocks.filter((b) => b !== last)
  }

  // Fine: distribute the remaining gap across rest periods (45–150s each).
  const gap = () =>
    estimate() < minS ? minS - estimate() : estimate() > maxS ? maxS - estimate() : 0
  for (let guard = 0; guard < 40 && gap() !== 0; guard++) {
    const restSlots = work().reduce((a, b) => a + (b.rounds - 1), 0)
    if (restSlots === 0) break
    const perSlot = Math.ceil(Math.abs(gap()) / restSlots) * Math.sign(gap())
    let moved = false
    for (const b of work()) {
      const next = Math.max(45, Math.min(150, b.restSeconds + perSlot))
      if (next !== b.restSeconds) {
        b.restSeconds = next
        moved = true
      }
      if (gap() === 0) break
    }
    if (!moved) break
  }
  return blocks
}

// ─── main entry ──────────────────────────────────────────────────────────────

export function generateWorkout(input: GeneratorInput): WorkoutPlan {
  const { catalog, dateISO, generatorVersion, householdId, participants, recentHistory } = input
  const targetSeconds = input.targetSeconds ?? DEFAULT_TARGET_SECONDS
  // Duration is part of the plan's identity: a 20-minute Tuesday and a
  // 55-minute Tuesday are different sessions, so they get different seeds.
  const seed = fnv1a32(`${householdId}|${dateISO}|${targetSeconds}|v${generatorVersion}`)
  const rng = mulberry32(seed)
  const dayType = dayTypeFor(input.scheduledDays, dateISO)
  const template = TEMPLATES[dayType]

  // Merged household context.
  const maxTier = participants.reduce<1 | 2 | 3>((acc, p) => (p.maxTier < acc ? p.maxTier : acc), 3)
  const lastUsed = new Map<string, number>()
  const muscleSets7d = new Map<string, number>()
  const sortedHistory = [...recentHistory].sort((a, b) =>
    a.dateISO === b.dateISO ? 0 : a.dateISO < b.dateISO ? -1 : 1,
  )
  for (const day of sortedHistory) {
    const age = daysBetween(day.dateISO, dateISO)
    for (const id of day.exerciseIds) {
      const prev = lastUsed.get(id)
      if (prev === undefined || age < prev) lastUsed.set(id, age)
    }
    if (age <= 7) {
      for (const [muscle, sets] of Object.entries(day.muscleSetCounts)) {
        muscleSets7d.set(muscle, (muscleSets7d.get(muscle) ?? 0) + (sets ?? 0))
      }
    }
  }

  // Equipment is filtered ONCE, before any selection: the relaxation ladder in
  // selectForSlot may drop the no-repeat window and the tier cap, but it must
  // never reach for a movement someone in the session cannot physically do.
  const performable = catalog.filter((e) =>
    allCanPerform(
      e,
      participants.map((p) => p.equipment),
    ),
  )

  const ctx: SelectionCtx = {
    rng,
    mains: performable.filter((e) => e.role === 'main'),
    maxTier,
    usedToday: new Set(),
    lastUsed,
    muscleSets7d,
  }

  const toWorkItem = (ex: Exercise): WorkItem => buildWorkItem(ex, participants)

  // Fixed call order: supersets in template order, then circuit, then warmup/cooldown.
  const supersetBlocks: Block[] = template.supersets.map((patterns, i) => ({
    kind: 'superset',
    label: `Strength ${String.fromCharCode(65 + i)}`,
    rounds: 3,
    restSeconds: 75,
    items: patterns.map((p) => toWorkItem(selectForSlot(p, ctx))),
  }))
  const circuitBlock: Block = {
    kind: 'circuit',
    label: 'Finisher',
    rounds: 2,
    restSeconds: 60,
    items: template.circuit.map((p) => toWorkItem(selectForSlot(p, ctx))),
  }

  // A short session gets a shorter warm-up and cool-down too — spending six of
  // twenty minutes on arm circles is not a workout. Floors, not proportions,
  // at the bottom: warming up is the part you skip last, not first.
  const ratio = targetSeconds / DEFAULT_TARGET_SECONDS
  const scale = (full: number, floor: number) =>
    Math.max(floor, Math.min(full, Math.round(full * ratio)))
  const warmupPool = performable.filter((e) => e.role === 'warmup')
  const cooldownPool = performable.filter((e) => e.role === 'cooldown')
  const warmupCount = scale(WARMUP_ITEMS, 3)
  const warmupBlock: Extract<Block, { kind: 'warmup' }> = {
    kind: 'warmup',
    items: Array.from({ length: warmupCount }, () => ({
      exerciseId: '',
      seconds: WARMUP_SECONDS,
    })),
  }
  const cooldownCount = scale(COOLDOWN_ITEMS, 2)
  const cooldownBlock: Extract<Block, { kind: 'cooldown' }> = {
    kind: 'cooldown',
    // Placeholder holds the shape the fitter budgets against; the movements are
    // chosen below, once it is settled which work blocks actually survive.
    items: Array.from({ length: cooldownCount }, () => ({
      exerciseId: '',
      seconds: COOLDOWN_SECONDS,
    })),
  }

  const blocks: Block[] = fitToBudget(
    [warmupBlock, ...supersetBlocks, circuitBlock, cooldownBlock],
    durationBand(targetSeconds),
  )

  // The cool-down is chosen from the fitted plan, not the draft: `fitToBudget`
  // can drop the finisher outright, and a prelude stretching a block nobody
  // ran is the same "unrelated" complaint by another route. Item count and
  // seconds are fixed above, so nothing here can move the estimate.
  //
  // Its own PRNG stream, seeded off the plan seed: the cool-down is now the
  // last thing decided, and sharing `rng` would make every warm-up and every
  // main selection sensitive to a change in stretch selection.
  const byId = new Map(catalog.map((e) => [e.id, e]))
  // Both ends of the session are chosen the same way and for the same reason:
  // from the fitted blocks, on their own PRNG streams, with counts and seconds
  // already settled above so neither can move the estimate.
  warmupBlock.items = selectWarmup({
    blocks,
    pool: warmupPool,
    byId,
    count: warmupCount,
    seconds: WARMUP_SECONDS,
    rng: mulberry32(fnv1a32(`${seed}|warmup`)),
  })
  cooldownBlock.items = selectCooldown({
    blocks,
    pool: cooldownPool,
    byId,
    count: cooldownCount,
    seconds: COOLDOWN_SECONDS,
    rng: mulberry32(fnv1a32(`${seed}|cooldown`)),
  })

  return {
    planVersion: 1,
    seed,
    dateISO,
    mode: targetSeconds <= SHORT_SESSION_MAX_S ? 'short' : 'full',
    dayType,
    participantIds: participants.map((p) => p.userId),
    estimatedSeconds: estimatePlanSeconds(blocks),
    blocks,
  }
}

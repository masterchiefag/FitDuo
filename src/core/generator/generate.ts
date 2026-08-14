import type { Exercise, Pattern } from '../catalog/types'
import { daysBetween, weekdayIndex } from '../dates'
import { fnv1a32, mulberry32, pick, shuffle } from './prng'
import { nextTarget } from './progression'
import type {
  Block,
  DayType,
  GeneratorInput,
  PersonTarget,
  TimedItem,
  WorkItem,
  WorkoutPlan,
} from './types'

export const DURATION_MIN_S = 3000 // 50 min
export const DURATION_MAX_S = 3600 // 60 min
const WARMUP_ITEMS = 7
const WARMUP_SECONDS = 40
const COOLDOWN_ITEMS = 5
const COOLDOWN_SECONDS = 60
const TRANSITION_S = 20
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
  const pos = scheduledIdx.indexOf(today)
  if (pos >= 0) return rotation[pos % rotation.length]!
  // Bonus workout on a rest day: next rotation slot.
  const before = scheduledIdx.filter((d) => d < today).length
  return rotation[Math.min(before, rotation.length - 1)]!
}

// Slot templates: 3 superset pairs + 1 circuit triple per day type.
const TEMPLATES: Record<DayType, { supersets: [Pattern, Pattern][]; circuit: Pattern[] }> = {
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
  throw new Error(`no candidates for pattern ${pattern}`)
}

// ─── time budgeting ──────────────────────────────────────────────────────────

function setSeconds(ex: Exercise, target: PersonTarget): number {
  if (ex.repRange[0] === 1 && ex.repRange[1] === 1) return ex.setupSeconds + ex.secondsPerRep
  return ex.setupSeconds + target.targetReps * ex.secondsPerRep * (ex.unilateral ? 2 : 1)
}

function workItemSeconds(byId: Map<string, Exercise>, item: WorkItem): number {
  const ex = byId.get(item.exerciseId)!
  return Math.max(...Object.values(item.perPerson).map((t) => setSeconds(ex, t)))
}

export function estimatePlanSeconds(byId: Map<string, Exercise>, blocks: Block[]): number {
  let total = 0
  for (const b of blocks) {
    total += TRANSITION_S
    if (b.kind === 'warmup' || b.kind === 'cooldown') {
      total += b.items.reduce((a, i) => a + i.seconds, 0)
    } else {
      const round = b.items.reduce((a, i) => a + workItemSeconds(byId, i), 0)
      total += b.rounds * round + (b.rounds - 1) * b.restSeconds
    }
  }
  return total
}

type WorkBlock = Extract<Block, { kind: 'superset' | 'circuit' }>

/** Deterministic, bounded fitting into [DURATION_MIN_S, DURATION_MAX_S]. */
function fitToBudget(byId: Map<string, Exercise>, blocks: Block[]): Block[] {
  const work = () =>
    blocks.filter((b): b is WorkBlock => b.kind === 'superset' || b.kind === 'circuit')
  const estimate = () => estimatePlanSeconds(byId, blocks)

  // Coarse: add/remove rounds (bounded passes).
  for (let guard = 0; guard < 8 && estimate() < DURATION_MIN_S; guard++) {
    const target = work().find((b) => b.rounds < 4)
    if (!target) break
    target.rounds += 1
  }
  for (let guard = 0; guard < 8 && estimate() > DURATION_MAX_S; guard++) {
    const target = [...work()].reverse().find((b) => b.rounds > 2)
    if (!target) break
    target.rounds -= 1
  }

  // Fine: distribute the remaining gap across rest periods (45–150s each).
  const gap = () =>
    estimate() < DURATION_MIN_S
      ? DURATION_MIN_S - estimate()
      : estimate() > DURATION_MAX_S
        ? DURATION_MAX_S - estimate()
        : 0
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
  const seed = fnv1a32(`${householdId}|${dateISO}|v${generatorVersion}`)
  const rng = mulberry32(seed)
  const byId = new Map(catalog.map((e) => [e.id, e]))
  const dayType = dayTypeFor(input.scheduledDays, dateISO)
  const template = TEMPLATES[dayType]

  // Merged household context.
  const maxTier = participants.reduce<1 | 2 | 3>((acc, p) => (p.maxTier < acc ? p.maxTier : acc), 3)
  const lastUsed = new Map<string, number>()
  const muscleSets7d = new Map<string, number>()
  const sortedHistory = [...recentHistory].sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1))
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

  const ctx: SelectionCtx = {
    rng,
    mains: catalog.filter((e) => e.role === 'main'),
    maxTier,
    usedToday: new Set(),
    lastUsed,
    muscleSets7d,
  }

  const toWorkItem = (ex: Exercise): WorkItem => {
    const perPerson: Record<string, PersonTarget> = {}
    for (const p of participants) {
      perPerson[p.userId] = nextTarget(ex, p.availableWeights, p.progression[ex.id])
    }
    return { exerciseId: ex.id, perPerson }
  }

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

  const warmupPool = catalog.filter((e) => e.role === 'warmup')
  const cooldownPool = catalog.filter((e) => e.role === 'cooldown')
  const warmup: TimedItem[] = shuffle(rng, warmupPool)
    .slice(0, WARMUP_ITEMS)
    .map((e) => ({ exerciseId: e.id, seconds: WARMUP_SECONDS }))
  const cooldown: TimedItem[] = shuffle(rng, cooldownPool)
    .slice(0, COOLDOWN_ITEMS)
    .map((e) => ({ exerciseId: e.id, seconds: COOLDOWN_SECONDS }))

  const blocks: Block[] = fitToBudget(byId, [
    { kind: 'warmup', items: warmup },
    ...supersetBlocks,
    circuitBlock,
    { kind: 'cooldown', items: cooldown },
  ])

  return {
    planVersion: 1,
    seed,
    dateISO,
    dayType,
    participantIds: participants.map((p) => p.userId),
    estimatedSeconds: estimatePlanSeconds(byId, blocks),
    blocks,
  }
}

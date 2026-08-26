import { allCanPerform } from '../catalog/equipment'
import type { Equipment, Exercise, MobilityPhase, MobilityRegion } from '../catalog/types'
import { estimatePlanSeconds } from './generate'
import { fnv1a32, mulberry32, shuffle } from './prng'
import type { Block, TimedItem, WorkoutPlan } from './types'

/**
 * Mobility & Relief sessions: short, unloaded, and structured
 * mobilise → open → activate.
 *
 * That order is the point. Stretching alone does not change a slouched
 * posture — the stiff segment has to move first, the tight front has to open,
 * and then the weak mid-back has to switch on, or it all reverts by evening.
 */

export type MobilityFocus = 'posture' | 'lower_back_hips' | 'full_body'

export interface MobilityFocusSpec {
  label: string
  blurb: string
  /** Always in scope — what the session is *for*. */
  regions: MobilityRegion[]
  /**
   * Reached for only when a phase can afford a whole extra movement on top of
   * its own regions (see `fillPhase`). Breadth the clock buys, in other words.
   *
   * This exists because the alternative a long session had was *repetition*:
   * `maxRounds` cycles the pool a second time, so thirty minutes bought the
   * same stretches twice. Widening is the better use of the time — but only
   * where it does not crowd out the reason the person picked this focus, which
   * is why it is a separate, budget-gated list and not just more `regions`.
   */
  extendedRegions?: MobilityRegion[]
}

export const MOBILITY_FOCUS: Record<MobilityFocus, MobilityFocusSpec> = {
  posture: {
    label: 'Posture & Shoulders',
    blurb: 'Upper back, chest and shoulder blades — for desk slouch and stiff shoulders',
    regions: ['thoracic', 'shoulders', 'chest', 'neck'],
  },
  lower_back_hips: {
    label: 'Lower Back & Hips',
    // Hamstrings belong to this one on the merits, not as breadth: sitting
    // holds the hip flexors *and* the hamstrings short, and the session already
    // opened the front of the hip and never the back of the thigh.
    blurb: 'Hips, glutes, hamstrings and lower back — for sitting stiffness',
    regions: ['lower_back', 'hips', 'glutes', 'hamstrings'],
  },
  full_body: {
    label: 'Full Body',
    blurb: 'A bit of everything — the longer you have, the more ground it covers',
    regions: ['thoracic', 'shoulders', 'chest', 'neck', 'lower_back', 'hips'],
    // Legs now reach all three phases (the catalog gained leg `mobilise` and
    // `activate` work), so this list is no longer a compromise about missing
    // content — it is the budget gate doing its actual job. `quads` and
    // `calves` are here and in no focus's `regions`, which is why they stay
    // breadth: a five-minute Full Body session should not spend a slot on a
    // calf stretch, and a thirty-minute one can afford to.
    extendedRegions: ['glutes', 'hamstrings', 'quads', 'calves'],
  },
}

const PHASE_LABEL: Record<MobilityPhase, string> = {
  mobilise: 'Mobilise',
  open: 'Open',
  activate: 'Activate',
}

/**
 * Share of the session each phase gets. Open work dominates because holds are
 * long; activation is short but must never be dropped — it is the half that
 * actually changes anything.
 */
const PHASE_SHARE: Record<MobilityPhase, number> = {
  mobilise: 0.25,
  open: 0.4,
  activate: 0.35,
}

/** Offered durations. Duration is a user input, not a property of the routine. */
export const MOBILITY_DURATIONS = [5, 10, 20, 30] as const
export type MobilityDuration = (typeof MOBILITY_DURATIONS)[number]
export const DEFAULT_MOBILITY_MINUTES: MobilityDuration = 10

export interface MobilityInput {
  householdId: string
  dateISO: string
  generatorVersion: number
  catalog: Exercise[]
  focus: MobilityFocus
  participantIds: string[]
  /**
   * One kit per participant, in any order. Everyone does the same movement at
   * the same time, so a movement is eligible only if EACH of these kits can do
   * it — see `allCanPerform` for why this is not one intersected list.
   */
  kits: Equipment[][]
  /** How long they have. The generator fills this budget. */
  targetSeconds?: number
}

function poolFor(
  catalog: Exercise[],
  phase: MobilityPhase,
  regions: MobilityRegion[],
  kits: Equipment[][],
): Exercise[] {
  return catalog
    .filter((ex) => ex.mobility?.phase === phase)
    .filter((ex) => ex.mobility!.regions.some((r) => regions.includes(r)))
    .filter((ex) => allCanPerform(ex, kits))
    .sort((a, b) => (a.id < b.id ? -1 : 1)) // total order before any PRNG use
}

/**
 * Order a pool for selection: the catalog's high-value movements first,
 * shuffled inside each tier so sessions still vary day to day.
 */
function orderPool(rng: () => number, pool: Exercise[]): Exercise[] {
  return [
    ...shuffle(
      rng,
      pool.filter((ex) => (ex.mobility!.priority ?? 1) >= 2),
    ),
    ...shuffle(
      rng,
      pool.filter((ex) => (ex.mobility!.priority ?? 1) < 2),
    ),
  ]
}

interface FillOptions {
  /** Cycle the pool for a second round when the budget outlasts it. */
  allowRepeat: boolean
  /**
   * How to spend the last, partial slot. `nearest` takes a movement when doing
   * so lands closer to the budget than stopping does — right for a phase that
   * must fill its share. `strict` takes only movements that fit whole, so a
   * budget too small for one buys none: that is what keeps a five-minute
   * session free of the breadth a thirty-minute one can afford.
   */
  edge: 'nearest' | 'strict'
  /** Never return empty — activation especially must survive a short session. */
  minOne: boolean
}

/** Movements from `ordered` that fit `budget`, in rounds. */
function fillBudget(ordered: Exercise[], budget: number, opts: FillOptions): Exercise[][] {
  if (ordered.length === 0) return []
  const maxRounds = opts.allowRepeat && ordered.length >= 4 ? 2 : 1
  const chosen: Exercise[] = []
  let spent = 0
  for (let i = 0; i < ordered.length * maxRounds; i++) {
    const ex = ordered[i % ordered.length]!
    const seconds = ex.mobility!.seconds
    const fits =
      opts.edge === 'strict' ? spent + seconds <= budget : spent + seconds / 2 <= budget
    if (!fits && !(opts.minOne && chosen.length === 0)) break
    chosen.push(ex)
    spent += seconds
  }
  // Order each round sensibly, keeping later rounds after earlier ones.
  const rounds: Exercise[][] = []
  chosen.forEach((ex, i) => {
    const round = Math.floor(i / ordered.length)
    ;(rounds[round] ??= []).push(ex)
  })
  return rounds.map((r) => [...r].sort((a, b) => (a.id < b.id ? -1 : 1)))
}

/**
 * The share of a phase that breadth may take, once it can afford a whole
 * movement. Small on purpose: a Full Body session that spent a third of its
 * open phase on legs would stop being the posture session people picked it for.
 */
const EXTENDED_SHARE = 0.2

export function generateMobilitySession(input: MobilityInput): WorkoutPlan {
  const { catalog, dateISO, focus, generatorVersion, householdId, kits, participantIds } = input
  const targetSeconds = input.targetSeconds ?? DEFAULT_MOBILITY_MINUTES * 60
  const seed = fnv1a32(
    `${householdId}|${dateISO}|mobility|${focus}|${targetSeconds}|v${generatorVersion}`,
  )
  const rng = mulberry32(seed)
  const regions = MOBILITY_FOCUS[focus].regions

  const extendedRegions = MOBILITY_FOCUS[focus].extendedRegions ?? []

  const blocks: Block[] = []
  for (const phase of ['mobilise', 'open', 'activate'] as const) {
    const pool = poolFor(catalog, phase, regions, kits)
    if (pool.length === 0) continue
    const budget = targetSeconds * PHASE_SHARE[phase]

    // Breadth is settled first, and only takes what fits whole inside its
    // share, so what it does not spend goes straight back to the focus's own
    // work — a five-minute session is exactly what it always was.
    const extendedPool = poolFor(catalog, phase, extendedRegions, kits).filter(
      (ex) => !pool.some((p) => p.id === ex.id),
    )
    const extended = fillBudget(orderPool(rng, extendedPool), budget * EXTENDED_SHARE, {
      allowRepeat: false,
      edge: 'strict',
      minOne: false,
    }).flat()
    const extendedSeconds = extended.reduce((a, ex) => a + ex.mobility!.seconds, 0)

    // Fill the rest with this phase's own regions. Longer sessions work further
    // down the pool and then cycle back for a second round of the key
    // movements — which is how a real mobility routine lengthens. A third round
    // is padding, so shallow pools stop after one pass and a long request
    // returns an honestly shorter session instead of the same two stretches
    // three times.
    const core = fillBudget(orderPool(rng, pool), budget - extendedSeconds, {
      allowRepeat: true,
      edge: 'nearest',
      minOne: true,
    }).flat()

    // Breadth goes last within its phase: the focus's own work leads.
    const items: TimedItem[] = [...core, ...extended].map((ex) => ({
      exerciseId: ex.id,
      seconds: ex.mobility!.seconds,
    }))
    blocks.push({ kind: 'mobility', label: PHASE_LABEL[phase], items })
  }

  return {
    planVersion: 1,
    seed,
    dateISO,
    mode: 'mobility',
    // Recovery work takes no part in day-type rotation; `mode` is what the app
    // reads. This field only satisfies the shared plan shape.
    dayType: 'full_a',
    participantIds,
    // One estimator for every plan shape — the player's own block-transition
    // constant included, so the number shown matches the session run.
    estimatedSeconds: estimatePlanSeconds(blocks),
    blocks,
  }
}

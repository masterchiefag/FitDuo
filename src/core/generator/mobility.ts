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

export const MOBILITY_FOCUS: Record<
  MobilityFocus,
  { label: string; blurb: string; regions: MobilityRegion[] }
> = {
  posture: {
    label: 'Posture & Shoulders',
    blurb: 'Upper back, chest and shoulder blades — for desk slouch and stiff shoulders',
    regions: ['thoracic', 'shoulders', 'chest', 'neck'],
  },
  lower_back_hips: {
    label: 'Lower Back & Hips',
    blurb: 'Hips, glutes and lower back — for sitting stiffness',
    regions: ['lower_back', 'hips'],
  },
  full_body: {
    label: 'Full Body',
    blurb: 'A bit of everything, head to toe',
    regions: ['thoracic', 'shoulders', 'chest', 'neck', 'lower_back', 'hips'],
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

export function generateMobilitySession(input: MobilityInput): WorkoutPlan {
  const { catalog, dateISO, focus, generatorVersion, householdId, kits, participantIds } = input
  const targetSeconds = input.targetSeconds ?? DEFAULT_MOBILITY_MINUTES * 60
  const seed = fnv1a32(
    `${householdId}|${dateISO}|mobility|${focus}|${targetSeconds}|v${generatorVersion}`,
  )
  const rng = mulberry32(seed)
  const regions = MOBILITY_FOCUS[focus].regions

  const blocks: Block[] = []
  for (const phase of ['mobilise', 'open', 'activate'] as const) {
    const pool = poolFor(catalog, phase, regions, kits)
    if (pool.length === 0) continue
    // High-value movements first (editorial priority in the catalog), shuffled
    // within each tier so sessions still vary day to day.
    const high = shuffle(
      rng,
      pool.filter((ex) => (ex.mobility!.priority ?? 1) >= 2),
    )
    const rest = shuffle(
      rng,
      pool.filter((ex) => (ex.mobility!.priority ?? 1) < 2),
    )
    const ordered = [...high, ...rest]

    // Fill this phase's share of the time budget. Longer sessions work further
    // down the pool and then cycle back for a second round of the key
    // movements — which is how a real mobility routine lengthens.
    // A second round of the key movements is how a real routine lengthens; a
    // third is padding. Shallow pools stop after one pass, so a long request
    // returns an honestly shorter session instead of the same two stretches
    // three times.
    const maxRounds = ordered.length >= 4 ? 2 : 1
    const budget = targetSeconds * PHASE_SHARE[phase]
    const chosen: Exercise[] = []
    let spent = 0
    for (let i = 0; i < ordered.length * maxRounds; i++) {
      const ex = ordered[i % ordered.length]!
      const seconds = ex.mobility!.seconds
      // Round to the nearest fit rather than always overshooting: take the
      // movement only if it lands us closer to the budget than stopping does.
      // Every phase keeps at least one movement — activation especially.
      if (chosen.length > 0 && spent + seconds / 2 > budget) break
      chosen.push(ex)
      spent += seconds
    }
    // Order each round sensibly, keeping later rounds after earlier ones.
    const rounds: Exercise[][] = []
    chosen.forEach((ex, i) => {
      const round = Math.floor(i / ordered.length)
      ;(rounds[round] ??= []).push(ex)
    })
    const laidOut = rounds.flatMap((r) => [...r].sort((a, b) => (a.id < b.id ? -1 : 1)))

    const items: TimedItem[] = laidOut.map((ex) => ({
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
    estimatedSeconds: estimatePlanSeconds(new Map(catalog.map((e) => [e.id, e])), blocks),
    blocks,
  }
}

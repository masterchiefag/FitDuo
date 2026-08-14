import type { Equipment, Exercise, MobilityPhase, MobilityRegion } from '../catalog/types'
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

/** How many movements each phase contributes, by session length. */
const PHASE_COUNTS: Record<'short' | 'standard', Record<MobilityPhase, number>> = {
  short: { mobilise: 2, open: 3, activate: 2 },
  standard: { mobilise: 3, open: 4, activate: 4 },
}

export interface MobilityInput {
  householdId: string
  dateISO: string
  generatorVersion: number
  catalog: Exercise[]
  focus: MobilityFocus
  participantIds: string[]
  /** Equipment available to whoever is doing the session. */
  equipment: Equipment[]
  length?: 'short' | 'standard'
}

function poolFor(
  catalog: Exercise[],
  phase: MobilityPhase,
  regions: MobilityRegion[],
  equipment: Equipment[],
): Exercise[] {
  return catalog
    .filter((ex) => ex.mobility?.phase === phase)
    .filter((ex) => ex.mobility!.regions.some((r) => regions.includes(r)))
    .filter((ex) => equipment.includes(ex.equipment))
    .sort((a, b) => (a.id < b.id ? -1 : 1)) // total order before any PRNG use
}

export function generateMobilitySession(input: MobilityInput): WorkoutPlan {
  const { catalog, dateISO, focus, generatorVersion, householdId, participantIds } = input
  const equipment: Equipment[] = input.equipment.includes('bodyweight')
    ? input.equipment
    : ['bodyweight', ...input.equipment]
  const length = input.length ?? 'standard'
  const seed = fnv1a32(`${householdId}|${dateISO}|mobility|${focus}|v${generatorVersion}`)
  const rng = mulberry32(seed)
  const regions = MOBILITY_FOCUS[focus].regions
  const counts = PHASE_COUNTS[length]

  const blocks: Block[] = []
  let estimatedSeconds = 0
  for (const phase of ['mobilise', 'open', 'activate'] as const) {
    const pool = poolFor(catalog, phase, regions, equipment)
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
    const chosen = [...high, ...rest].slice(0, Math.min(counts[phase], pool.length))
    // Present in a stable order within the block so the session reads sensibly.
    chosen.sort((a, b) => (a.id < b.id ? -1 : 1))
    const items: TimedItem[] = chosen.map((ex) => ({
      exerciseId: ex.id,
      seconds: ex.mobility!.seconds,
    }))
    estimatedSeconds += items.reduce((a, i) => a + i.seconds, 0) + 15
    blocks.push({ kind: 'mobility', label: PHASE_LABEL[phase], items })
  }

  return {
    planVersion: 1,
    seed,
    dateISO,
    dayType: 'full_a', // mobility sessions do not participate in day-type rotation
    participantIds,
    estimatedSeconds,
    blocks,
  }
}

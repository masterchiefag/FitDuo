import type { Exercise, MobilityRegion, WarmupPhase } from '../catalog/types'
import { MUSCLE_REGIONS, workedRegions } from './cooldown'
import { pick } from './prng'
import type { Block, TimedItem } from './types'

/**
 * Which movements open a session, in which order, and why those.
 *
 * The warm-up used to be `shuffle(pool).slice(0, n)` — it had no reference to
 * the day, and none to itself either. Half the pool is seven of fourteen, so at
 * a full session it did in fact touch everything the day trained; what it got
 * wrong was the *shape*. A real 55-minute leg day read:
 *
 *     hip-circles → groiners → arm-circles → star-jumps → worlds-greatest
 *       → cat-cow → butt-kicks
 *
 * Jumping fourth, floor work either side of it, and heels-to-glutes as the last
 * thing before picking up dumbbells. Roughly two days in three put the pulse
 * raiser somewhere in the middle.
 *
 * So this is RAMP, the order a warm-up is supposed to run: **raise** the pulse,
 * **mobilise** the joints, **rehearse** the patterns about to be loaded. The
 * phase is authored per movement (`warmupPhase`), because nothing already in the
 * catalog says it — every warm-up carries `pattern: 'mobility'`, and
 * `mobility.phase` is the relief-session gate, not this (see `WARMUP_PHASES`).
 *
 * The day enters as a *tie-break inside a phase*, not as a filter: with four
 * mobilisation slots and eight candidates, something has to choose, and
 * "whichever the shuffle landed on" is the thing being replaced. It is not a
 * coverage guarantee, and it does not need to be — at the default duration the
 * old shuffle already reached both halves of the body on all 84 plans measured.
 * Where it earns its keep is short sessions: at three items, 13 of 84 days had
 * upper-body work and nothing above the waist to warm it up.
 */

/**
 * Share of the warm-up spent rehearsing the day's patterns. The rest, less the
 * single raise, mobilises. At seven items that is 1 raise / 4 mobilise /
 * 2 rehearse; at the three-item floor it is exactly one of each, so even the
 * shortest session keeps the whole shape rather than becoming three stretches.
 */
const REHEARSE_SHARE = 0.3

/** Fixed order the phases run in. This is the feature. */
const PHASE_ORDER: readonly WarmupPhase[] = ['raise', 'mobilise', 'rehearse'] as const

/** An entry with no authored phase still has to go somewhere; `tests/catalog.test.ts`
 *  requires one on every warm-up, so this is a totality guard, not a default. */
const phaseOf = (ex: Exercise): WarmupPhase => ex.warmupPhase ?? 'mobilise'

/**
 * How many items each phase gets, summing to exactly `count`.
 *
 * A phase whose pool cannot fill its quota hands the remainder back, and the
 * others take it in pool-size order — the count is an input and is honoured
 * exactly, so this rule can never move a session's duration.
 */
export function phaseQuotas(count: number, available: Record<WarmupPhase, number>) {
  const wanted: Record<WarmupPhase, number> = { raise: 0, mobilise: 0, rehearse: 0 }
  if (count <= 0) return wanted
  wanted.raise = count >= 2 ? 1 : 0
  wanted.rehearse = count >= 3 ? Math.max(1, Math.round(count * REHEARSE_SHARE)) : 0
  wanted.mobilise = count - wanted.raise - wanted.rehearse

  // Clamp to what exists, then redistribute the shortfall. Mobilise absorbs
  // first because it is the deepest pool and the most forgiving thing to have
  // extra of; a second raise is the last resort.
  for (const phase of PHASE_ORDER) wanted[phase] = Math.min(wanted[phase], available[phase])
  const spillOrder: WarmupPhase[] = ['mobilise', 'rehearse', 'raise']
  for (const phase of spillOrder) {
    const short = count - (wanted.raise + wanted.mobilise + wanted.rehearse)
    if (short <= 0) break
    wanted[phase] = Math.min(available[phase], wanted[phase] + short)
  }
  return wanted
}

export interface WarmupInput {
  /** The blocks the session will actually run — post-fit, so the rehearsal
   *  prepares patterns that survived rather than ones the fitter dropped. */
  blocks: Block[]
  /** Warm-up entries every participant can perform. */
  pool: Exercise[]
  byId: Map<string, Exercise>
  /** How many items the time budget allows. Unchanged by this rule. */
  count: number
  seconds: number
  rng: () => number
}

/**
 * `count` warm-up items, in RAMP order.
 *
 * Within a phase, candidates are scored by how much of today they touch and
 * sorted `(score desc, id asc)`, and the seeded pick takes one of the top two —
 * the same idiom as `selectForSlot` and `selectCooldown`, so the warm-up still
 * varies day to day without drifting off the day.
 *
 * Relevance runs through `MUSCLE_REGIONS`, the cool-down's map, so both ends of
 * the session describe the day in one vocabulary. Cat-Cow is filed under
 * `core` and lands on `lower_back`, which means a pure leg day scores it zero —
 * acceptable here in a way it would not have been for the cool-down, because
 * this is breaking a tie between mobilisations, not choosing the whole block.
 */
export function selectWarmup(input: WarmupInput): TimedItem[] {
  const { blocks, byId, count, pool, rng, seconds } = input
  if (count <= 0) return []

  const worked = new Map(workedRegions(blocks, byId).map((r) => [r.region, r.sets]))
  /** How much of today this movement prepares. 0 = none of it. */
  const relevance = (ex: Exercise) => {
    const regions = new Set<MobilityRegion>(ex.primaryMuscles.map((m) => MUSCLE_REGIONS[m]))
    let score = 0
    for (const region of regions) score += worked.get(region) ?? 0
    return score
  }

  const byPhase: Record<WarmupPhase, Exercise[]> = { raise: [], mobilise: [], rehearse: [] }
  // Total order before any PRNG use, so the seeded picks below are reproducible.
  for (const ex of [...pool].sort((a, b) => (a.id < b.id ? -1 : 1))) byPhase[phaseOf(ex)].push(ex)

  // A rehearsal that rehearses nothing you are about to do is not a rehearsal.
  // The other two phases are general by nature — any pulse raiser raises the
  // pulse, and a joint benefits from moving whatever the day holds — but the
  // catalog's rehearsal movements are all lower-body patterns, so on an upper
  // day every one of them scores zero. Dropping them here hands the slots to
  // `phaseQuotas`' spill, and a push day opens with six mobilisations that
  // actually touch the shoulders instead of closing on bodyweight squats.
  byPhase.rehearse = byPhase.rehearse.filter((ex) => relevance(ex) > 0)

  const quotas = phaseQuotas(count, {
    raise: byPhase.raise.length,
    mobilise: byPhase.mobilise.length,
    rehearse: byPhase.rehearse.length,
  })

  const items: TimedItem[] = []
  for (const phase of PHASE_ORDER) {
    const remaining = [...byPhase[phase]]
    for (let n = 0; n < quotas[phase] && remaining.length > 0; n++) {
      const scored = remaining
        .map((ex) => ({ ex, score: relevance(ex) }))
        .sort((a, b) => b.score - a.score || (a.ex.id < b.ex.id ? -1 : 1))
      const chosen = pick(
        rng,
        scored.slice(0, 2).map((s) => s.ex),
      )
      items.push({ exerciseId: chosen.id, seconds })
      remaining.splice(remaining.indexOf(chosen), 1)
    }
  }
  return items
}

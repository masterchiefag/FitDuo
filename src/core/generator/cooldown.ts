import type { Exercise, MobilityRegion, MuscleGroup } from '../catalog/types'
import { pick, shuffle } from './prng'
import type { Block, TimedItem } from './types'

/**
 * Which stretches close a strength session, and why those.
 *
 * The first real session's verdict was *"the stretches seem unrelated to the
 * muscles used in the workout"* (docs/SESSIONS.md, finding 6) — fairly, since
 * the cool-down was a shuffle of the whole cool-down pool.
 *
 * The shape here is the household trainer's, as the corpus recorded it
 * (docs/PLAN.md §"the trainer corpus"): every session ends with the *same*
 * short chain — the ending is supposed to feel familiar — and she *prepends*
 * stretches for whatever the day worked, so leg day opens the cool-down with
 * hamstrings and glutes. So: a fixed core chain, plus a targeted prelude.
 *
 * Keyed to `mobility.regions`, never `primaryMuscles`. Child's Pose is filed
 * under `core` and stretches the lower back and mid-spine; a muscle-keyed rule
 * would keep making exactly the pairing the finding complained about.
 */

/**
 * The ending, every strength session, in this order: hug the knees in, twist
 * the spine out, settle into Child's Pose. One continuous descent to the floor,
 * and the last thing that happens is always the same thing.
 *
 * Ids rather than a query on purpose — "recognisable" is the whole feature, and
 * a scored pick would quietly vary it. Guarded by `tests/catalog.test.ts`,
 * which checks each id exists, is a `cooldown`, and needs no equipment (a chain
 * member that some kit filters out would silently stop being the ending).
 */
export const COOLDOWN_CORE_CHAIN = ['knees-to-chest', 'spinal-twist', 'childs-pose'] as const

/** At most this many targeted stretches open the cool-down, chain intact. */
export const PRELUDE_MAX = 3

/**
 * Muscle worked → the region whose stretch answers it.
 *
 * The two vocabularies are different on purpose (see `MOBILITY_REGIONS`), so
 * the mapping is stated once, here, rather than inferred at three call sites.
 * Arms route to `shoulders` because that is where the catalog's arm stretches
 * live (overhead triceps, cross-body); an `arms` region with two entries in it
 * would be a bigger vocabulary buying nothing.
 */
export const MUSCLE_REGIONS: Record<MuscleGroup, MobilityRegion[]> = {
  chest: ['chest'],
  back: ['thoracic'],
  shoulders: ['shoulders'],
  biceps: ['shoulders'],
  triceps: ['shoulders'],
  quads: ['quads', 'hips'],
  hamstrings: ['hamstrings'],
  glutes: ['glutes', 'hips'],
  calves: ['calves'],
  core: ['lower_back'],
}

type WorkBlock = Extract<Block, { kind: 'superset' | 'circuit' }>

export interface WorkedRegion {
  region: MobilityRegion
  /** Sets of work that landed on it — the ranking key, not a dose. */
  sets: number
}

/**
 * What today actually worked, ranked.
 *
 * Weight is sets, counted per region rather than shared out between them: a
 * goblet squat is quads *and* glutes *and* hips for its full three rounds, and
 * dividing that would rank a day's biggest movement below its accessories.
 * Integers, so the sort has nothing to be nearly-equal about; ties break on
 * region name, which keeps this total and byte-deterministic.
 *
 * Secondary muscles are deliberately out: everything is secondary to something,
 * and including them flattens the ranking until every day works everything.
 */
export function workedRegions(blocks: Block[], byId: Map<string, Exercise>): WorkedRegion[] {
  const sets = new Map<MobilityRegion, number>()
  const work = blocks.filter((b): b is WorkBlock => b.kind === 'superset' || b.kind === 'circuit')
  for (const block of work) {
    for (const item of block.items) {
      const ex = byId.get(item.exerciseId)
      if (!ex) continue
      for (const muscle of ex.primaryMuscles) {
        for (const region of MUSCLE_REGIONS[muscle]) {
          sets.set(region, (sets.get(region) ?? 0) + block.rounds)
        }
      }
    }
  }
  return [...sets.entries()]
    .map(([region, n]) => ({ region, sets: n }))
    .sort((a, b) => b.sets - a.sets || (a.region < b.region ? -1 : 1))
}

export interface CooldownInput {
  /** The blocks the session will actually run — post-fit, so a dropped
   *  finisher does not leave the cool-down stretching something nobody did. */
  blocks: Block[]
  /** Cool-down entries every participant can perform. */
  pool: Exercise[]
  byId: Map<string, Exercise>
  /** How many items the time budget allows. Unchanged by this rule. */
  count: number
  seconds: number
  rng: () => number
}

/**
 * `count` cool-down items: the targeted prelude first, the core chain last.
 *
 * The count is an input and is always honoured exactly, so this rule cannot
 * move a session's duration — a cool-down of five 60s holds before is five 60s
 * holds after, and the fitter upstream never has to know the difference. Short
 * sessions spend their smaller budget from the *end* of the chain, because the
 * ending is the part worth keeping (and one targeted stretch survives even at
 * two items — that is the finding being answered).
 */
export function selectCooldown(input: CooldownInput): TimedItem[] {
  const { blocks, byId, count, pool, rng, seconds } = input
  if (count <= 0) return []
  const available = new Map(pool.map((e) => [e.id, e]))

  const chain = COOLDOWN_CORE_CHAIN.filter((id) => available.has(id))
  const preludeWanted =
    count <= 1 ? 0 : Math.max(1, Math.min(PRELUDE_MAX, count - COOLDOWN_CORE_CHAIN.length))
  const chainTake = Math.min(chain.length, Math.max(0, count - preludeWanted))
  const ending = chain.slice(chain.length - chainTake)
  const endingIds = new Set<string>(ending)

  const ranked = workedRegions(blocks, byId)
  const worked = new Map(ranked.map((r) => [r.region, r.sets]))
  const candidates = pool
    .filter((e) => e.mobility && !endingIds.has(e.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1)) // total order before any PRNG use

  // One stretch per worked region, most-worked region first, so the prelude
  // reads as the day it follows. A region with nothing to offer is skipped
  // rather than filled with something else's stretch.
  const prelude: string[] = []
  const used = new Set<string>(endingIds)
  for (const { region } of ranked) {
    if (prelude.length >= count - ending.length) break
    const forRegion = candidates.filter(
      (e) => !used.has(e.id) && e.mobility!.regions.includes(region),
    )
    if (forRegion.length === 0) continue
    // Score inside the region: how much of today's other work it also answers,
    // plus the catalog's editorial priority. Sorted (score desc, id asc), then
    // the seeded pick chooses among the top two — same rule as `selectForSlot`,
    // so the cool-down varies day to day without ever drifting off the day.
    const scored = forRegion
      .map((e) => ({
        e,
        score:
          e.mobility!.regions.reduce((acc, r) => acc + (worked.get(r) ?? 0), 0) +
          (e.mobility!.priority ?? 1),
      }))
      .sort((a, b) => b.score - a.score || (a.e.id < b.e.id ? -1 : 1))
    const chosen = pick(
      rng,
      scored.slice(0, 2).map((s) => s.e),
    )
    prelude.push(chosen.id)
    used.add(chosen.id)
  }

  // Thin content (or a day whose regions have no stretches) must not shorten
  // the session: top up from the rest of the pool, as the old shuffle did.
  const ids = [...prelude, ...ending]
  if (ids.length < count) {
    for (const ex of shuffle(
      rng,
      pool.filter((e) => !used.has(e.id)),
    )) {
      if (ids.length >= count) break
      ids.splice(prelude.length, 0, ex.id)
      used.add(ex.id)
    }
  }

  return ids.slice(0, count).map((exerciseId) => ({ exerciseId, seconds }))
}

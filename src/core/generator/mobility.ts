import { allCanPerform } from '../catalog/equipment'
import type { Equipment, Exercise, MobilityPhase, MobilityRegion } from '../catalog/types'
import { CHANGEOVER_SECONDS } from '../player/reducer'
import { buildWorkItem, estimatePlanSeconds } from './generate'
import { fnv1a32, mulberry32, shuffle } from './prng'
import type { Block, ParticipantInput, TimedItem, WorkoutPlan } from './types'

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
 * Share of the session each phase gets.
 *
 * Activation takes the largest share, which is a reversal: open work dominated
 * while every phase was priced in 40-second holds, and 0.35 of a ten-minute
 * session bought three of them. Priced as the sets it actually is, that same
 * share buys ONE movement — a shoulder session with five stretches and a single
 * set of rotations, which is the shape this file's own header argues against.
 * Stretching is what reverts by evening; the strengthening is what does not.
 */
const PHASE_SHARE: Record<MobilityPhase, number> = {
  mobilise: 0.2,
  open: 0.3,
  activate: 0.5,
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
  /**
   * Everyone in the session, with their own kit, resistances and progression —
   * the same shape a strength session takes, because the Activate phase now
   * prescribes real sets and has the same questions to answer.
   *
   * Eligibility still runs per kit and is never intersected: everyone does the
   * same movement at the same time, so a movement is eligible only if EACH kit
   * can do it (`allCanPerform`).
   */
  participants: ParticipantInput[]
  /** How long they have. The generator fills this budget. */
  targetSeconds?: number
}

/**
 * Rounds and rest for the Activate block.
 *
 * Two rounds is the floor and what the phase budgets against; a third is taken
 * only when the movements already chosen leave room for it. That order matters:
 * breadth across the small muscles is worth more than a third set of one of
 * them, so rounds spend what breadth could not.
 *
 * It is also how this phase lengthens at all. A timed phase fills a long
 * session by cycling its pool for a second pass — a work block must not, or the
 * same movement is prescribed twice in one block while `rounds` already says
 * "do it again". Rounds are that repeat, stated once.
 *
 * Rest is short for the reason it is short in a physio clinic: the loads are
 * light and the limit is control, not fatigue.
 */
const ACTIVATE_ROUNDS = 2
const ACTIVATE_MAX_ROUNDS = 3
const ACTIVATE_REST_S = 30

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

/**
 * A movement the catalog prescribes by the clock rather than by reps. The
 * `[1, 1]` range is the existing language for it — `nextTarget` already refuses
 * to progress one — so this asks the catalog rather than keeping a list.
 */
function isHold(ex: Exercise): boolean {
  return ex.repRange[0] === 1 && ex.repRange[1] === 1
}

/**
 * `fillBudget` may cycle the pool for a second round, which is how a long
 * relief session lengthens. A work block says the same thing with `rounds`, so
 * the repeat would be counted twice.
 */
function dedupe(list: Exercise[]): Exercise[] {
  const seen = new Set<string>()
  return list.filter((ex) => (seen.has(ex.id) ? false : (seen.add(ex.id), true)))
}

/** Movements from `ordered` that fit `budget`, in rounds. */
function fillBudget(
  ordered: Exercise[],
  budget: number,
  opts: FillOptions,
  /**
   * What one movement costs the phase. Defaults to the authored hold length,
   * which is what a timed phase spends. The Activate phase overrides it: a set
   * repeated for rounds costs what the player will actually spend on it, and
   * budgeting a two-round band row as if it were a 45-second hold is how a
   * five-minute session quietly became nine.
   */
  costOf: (ex: Exercise) => number = (ex) => ex.mobility!.seconds,
): Exercise[][] {
  if (ordered.length === 0) return []
  const maxRounds = opts.allowRepeat && ordered.length >= 4 ? 2 : 1
  const chosen: Exercise[] = []
  let spent = 0
  for (let i = 0; i < ordered.length * maxRounds; i++) {
    const ex = ordered[i % ordered.length]!
    const seconds = costOf(ex)
    const fits = opts.edge === 'strict' ? spent + seconds <= budget : spent + seconds / 2 <= budget
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
  const { catalog, dateISO, focus, generatorVersion, householdId, participants } = input
  const kits: Equipment[][] = participants.map((p) => p.equipment)
  const participantIds = participants.map((p) => p.userId)
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

    const extendedPool = poolFor(catalog, phase, extendedRegions, kits).filter(
      (ex) => !pool.some((p) => p.id === ex.id),
    )

    // What a movement costs this phase, and what the phase has to spend. Both
    // change under Activate: a set runs for as many rounds as the block does,
    // and the block's between-round rest is charged once, up front, because it
    // is a property of the block and not of any one movement in it.
    const workItems = new Map(
      phase === 'activate'
        ? [...pool, ...extendedPool].map((ex) => [ex.id, buildWorkItem(ex, participants)] as const)
        : [],
    )
    const costOf = (ex: Exercise): number =>
      phase === 'activate'
        ? ACTIVATE_ROUNDS *
          ((workItems.get(ex.id)?.workSeconds ?? ex.mobility!.seconds) + CHANGEOVER_SECONDS)
        : ex.mobility!.seconds
    const phaseBudget = targetSeconds * PHASE_SHARE[phase]
    const budget =
      phaseBudget - (phase === 'activate' ? (ACTIVATE_ROUNDS - 1) * ACTIVATE_REST_S : 0)

    // Breadth is settled first, and only takes what fits whole inside its
    // share, so what it does not spend goes straight back to the focus's own
    // work — a five-minute session is exactly what it always was.
    const extended = fillBudget(
      orderPool(rng, extendedPool),
      budget * EXTENDED_SHARE,
      { allowRepeat: false, edge: 'strict', minOne: false },
      costOf,
    ).flat()
    const extendedSeconds = extended.reduce((a, ex) => a + costOf(ex), 0)

    // Fill the rest with this phase's own regions. Longer sessions work further
    // down the pool and then cycle back for a second round of the key
    // movements — which is how a real mobility routine lengthens. A third round
    // is padding, so shallow pools stop after one pass and a long request
    // returns an honestly shorter session instead of the same two stretches
    // three times.
    const core = fillBudget(
      orderPool(rng, pool),
      budget - extendedSeconds,
      // Activate never cycles the pool: a work block repeats with `rounds`, so
      // a second pass would prescribe the same set twice over.
      { allowRepeat: phase !== 'activate', edge: 'nearest', minOne: true },
      costOf,
    ).flat()

    // Breadth goes last within its phase: the focus's own work leads.
    const chosen = [...core, ...extended]
    if (phase === 'activate') {
      // Sets, not seconds — but only for movements the catalog gives a real rep
      // range. `[1, 1]` still means a hold, and an isometric neck press is a
      // hold whichever phase it lands in.
      const loaded = dedupe(chosen.filter((ex) => !isHold(ex)))
      const holds = chosen.filter(isHold)
      // Sets lead. A block is one kind or the other — the player runs a timed
      // flow or logs sets, never both — so a phase holding some of each is two
      // blocks, named apart so the session does not announce "Activate" twice.
      if (loaded.length > 0) {
        const items = loaded.map((ex) => workItems.get(ex.id) ?? buildWorkItem(ex, participants))
        const roundCost = items.reduce((a, i) => a + i.workSeconds + CHANGEOVER_SECONDS, 0)
        const fits = (r: number) => r * roundCost + (r - 1) * ACTIVATE_REST_S <= phaseBudget
        blocks.push({
          kind: 'activate',
          label: PHASE_LABEL[phase],
          rounds: fits(ACTIVATE_MAX_ROUNDS) ? ACTIVATE_MAX_ROUNDS : ACTIVATE_ROUNDS,
          restSeconds: ACTIVATE_REST_S,
          items,
        })
      }
      if (holds.length > 0) {
        blocks.push({
          kind: 'mobility',
          label: loaded.length > 0 ? `${PHASE_LABEL[phase]} holds` : PHASE_LABEL[phase],
          items: holds.map((ex) => ({ exerciseId: ex.id, seconds: ex.mobility!.seconds })),
        })
      }
      continue
    }
    const items: TimedItem[] = chosen.map((ex) => ({
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

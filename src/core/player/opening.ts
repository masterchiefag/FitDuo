import type { SessionMode, WorkoutPlan } from '../generator/types'
import { isWorkBlock } from './position'

/**
 * What the session is, before it starts — the numbers behind the opening ritual.
 *
 * First real session: *"kicks off without any context of what today's targets
 * are, what we're doing — not a welcoming start"* (docs/SESSIONS.md, finding 1).
 * The persona's answer is a fixed ritual: **name the day and its shape, then
 * start. No pep talk** (docs/PERSONA.md) — so everything here is a fact the
 * plan already holds, and nothing here is encouragement.
 *
 * Pure and plan-derived on purpose: the opening must say the same thing the
 * session then does. Anything it cannot read off the plan it does not say.
 */

export interface SessionSummary {
  /** Work blocks — the warm-up is not "block 1", as everywhere else. */
  blockCount: number
  /**
   * Sets programmed for ONE person. A duo set logs a row per participant at
   * their own target, so this number is the same for both — which is why the
   * screen can say it once, with "each".
   */
  setsPerPerson: number
  /** The plan's own estimate, in whole minutes — never a second computation. */
  minutes: number
}

export function sessionSummary(plan: WorkoutPlan): SessionSummary {
  let blockCount = 0
  let setsPerPerson = 0
  for (const block of plan.blocks) {
    if (!isWorkBlock(block)) continue
    blockCount++
    setsPerPerson += block.rounds * block.items.length
  }
  return { blockCount, setsPerPerson, minutes: Math.round(plan.estimatedSeconds / 60) }
}

/** The bells one person needs out for today's session. */
export interface PersonLoads {
  userId: string
  /** Distinct loaded weights, ascending. Empty = nothing to pick up. */
  weights: number[]
}

/**
 * What each person is lifting today, as a kit list rather than a schedule.
 *
 * The distinct weights and not a min–max span: the question this answers is
 * "which dumbbells do I get out before we start", and a span claims the ones
 * in between are needed too. Keyed off `participantIds` so a solo session has
 * one panel, a duo has two, and the order matches every other screen.
 */
export function personLoads(plan: WorkoutPlan): PersonLoads[] {
  return plan.participantIds.map((userId) => {
    const weights = new Set<number>()
    for (const block of plan.blocks) {
      if (!isWorkBlock(block)) continue
      for (const item of block.items) {
        const target = item.perPerson[userId]
        if (target && target.weight > 0) weights.add(target.weight)
      }
    }
    return { userId, weights: [...weights].sort((a, b) => a - b) }
  })
}

/**
 * The opening's one line — what the app is about to do, said calmly once.
 *
 * Two registers, one persona: strength states the contract (it runs itself),
 * mobility trades load talk for sensation ("wherever you reach today is the
 * stretch"). Neither performs enthusiasm, and neither claims anything the app
 * cannot know — the never-list applies to the first line of the session as
 * much as the last.
 *
 * Varied by seeded pick, which is the repetition discipline the persona asks
 * for: two people hear every line and the ritual is *supposed* to repeat, so
 * the shape stays fixed and only the prose moves. The plan's own seed carries
 * the date, so a line lasts a day and no new session state exists to hold it.
 */
const OPENING_LINES: Record<'strength' | 'mobility', readonly string[]> = {
  strength: [
    'Sets and rests are timed — the only tap is between blocks.',
    'Every set runs on its own clock. Change a number whenever it is wrong.',
    'Warm-up first, then the blocks in order. The screen keeps count.',
  ],
  mobility: [
    'No loads today. Wherever you reach is the stretch.',
    'Nothing to hit here — hold where you feel it, and breathe.',
    'Slow and low-stakes: sensation, not range.',
  ],
}

export function openingLine(seed: number, mode: SessionMode): string {
  const lines = OPENING_LINES[mode === 'mobility' ? 'mobility' : 'strength']
  return lines[Math.abs(seed) % lines.length]!
}

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

/** One thing today asks someone to pick up: what asks for it, and how much. */
export interface OpeningLoad {
  exerciseId: string
  weight: number
}

/** The kit one person needs out for today's session. */
export interface PersonLoads {
  userId: string
  /** Every distinct (movement, weight) prescribed to them, ascending. */
  loads: OpeningLoad[]
}

/**
 * What each person is lifting today, as a kit list rather than a schedule.
 *
 * The distinct loads and not a min-max span: the question this answers is
 * "which dumbbells do I get out before we start", and a span claims the ones
 * in between are needed too. Keyed off `participantIds` so a solo session has
 * one panel, a duo has two, and the order matches every other screen.
 *
 * Pairs, not bare numbers, and no filter on zero: a weight is not always a
 * number out loud. Relief sessions prescribe bands, stored as the force their
 * colour pulls — "1.7 kg" is not a thing anyone can pick up, and a band whose
 * colour nobody has recorded yet is a real 0 that still means "bring the band"
 * (PR #41). Which of those a number is, and whether it is kit at all, is a
 * question about the exercise's resistance, and the catalog is not in core —
 * so the movement travels with the number and the edge says the words.
 * `src/app/lib/load.ts` is the one place that conversion lives.
 */
export function personLoads(plan: WorkoutPlan): PersonLoads[] {
  return plan.participantIds.map((userId) => {
    const seen = new Set<string>()
    const loads: OpeningLoad[] = []
    for (const block of plan.blocks) {
      if (!isWorkBlock(block)) continue
      for (const item of block.items) {
        const target = item.perPerson[userId]
        if (!target) continue
        const key = `${item.exerciseId}|${target.weight}`
        if (seen.has(key)) continue
        seen.add(key)
        loads.push({ exerciseId: item.exerciseId, weight: target.weight })
      }
    }
    // Ascending, id-tiebroken: two movements can share a weight, and the same
    // plan must list the same kit in the same order every time it is opened.
    loads.sort((a, b) => a.weight - b.weight || (a.exerciseId < b.exerciseId ? -1 : 1))
    return { userId, loads }
  })
}

/**
 * The opening's one line — what the app is about to do, said calmly once.
 *
 * Two registers, one persona: strength states the contract (it runs itself),
 * mobility speaks in sensation rather than numbers. Neither performs
 * enthusiasm, and — the part that keeps needing enforcing — neither claims
 * anything the app cannot know, including about its own session. The
 * never-list applies to the first line of the session as much as the last.
 *
 * Varied by seeded pick, which is the repetition discipline the persona asks
 * for: two people hear every line and the ritual is *supposed* to repeat, so
 * the shape stays fixed and only the prose moves. The plan's own seed carries
 * the date, so a line lasts a day and no new session state exists to hold it.
 */
const OPENING_LINES: Record<'strength' | 'mobility', readonly string[]> = {
  strength: [
    // A third variant said "the only tap is between blocks", which is a promise
    // this player does not keep — Done, Skip, +15s and "I'm ready" are all
    // taps inside a block. The contract is that the timers advance WITHOUT a
    // tap, not that taps are rare (Grok, PR #40).
    'Every set runs on its own clock. Change a number whenever it is wrong.',
    'Warm-up first, then the blocks in order. The screen keeps count.',
  ],
  mobility: [
    // Two of these used to say "No loads today" and "Nothing to hit here".
    // Both were true of the relief session this app had in August and false of
    // the one it has now — Activate prescribes sets on a band and progresses
    // them (PR #41). Same fault as the tap promise above: an opening claiming
    // the shape of a session it has not read.
    'Stretch what is tight, then wake up what is weak.',
    'Hold where you feel it, and breathe.',
    'Slow and low-stakes: sensation, not range.',
  ],
}

export function openingLine(seed: number, mode: SessionMode): string {
  const lines = OPENING_LINES[mode === 'mobility' ? 'mobility' : 'strength']
  return lines[Math.abs(seed) % lines.length]!
}

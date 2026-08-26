import type { MobilityRegion, MuscleGroup } from '../catalog/types'

/**
 * What a block is called out loud — position plus what it is made of.
 *
 * The generator names blocks `Strength A`, `Strength B`, `Finisher` so its own
 * ordering is legible in a plan dump. First real session, on the gate: *"I
 * didn't get what B and C are"* — a letter is an index into a list nobody was
 * shown, and printing it is the same class as the exercise-id leak fixed in
 * 2026-08-16, one level up (docs/DECISIONS.md, 2026-08-25).
 *
 * This is a DISPLAY name only. Nothing here reaches the generator, and
 * `block.label` stays exactly as it is — it is the plan's own identifier, and
 * the next-up preview already lists the movements themselves.
 */

/**
 * The words the block's own content gives it: its distinct primary muscles, in
 * the order the movements are performed.
 *
 * `primaryMuscles` and not `pattern` on purpose. A pattern is a movement
 * mechanic, and the catalog files curls under `pull_h` alongside rows — so a
 * curl-and-kickback block would be announced as "rows & presses", which is not
 * true. Every main exercise carries exactly one primary muscle, and that word
 * is one a person already uses about their own body.
 */
export function muscleWords(primaries: MuscleGroup[]): string | null {
  const distinct: MuscleGroup[] = []
  for (const m of primaries) if (!distinct.includes(m)) distinct.push(m)
  // Three is where the line stops being a name and starts being a list. A
  // block has two or three movements, so this only bites when all three differ.
  return joinWords(distinct.slice(0, 3))
}

/** `back`, `back & shoulders`, `chest, back & shoulders`. Null for nothing. */
function joinWords(words: string[]): string | null {
  const last = words[words.length - 1]
  if (last === undefined) return null
  if (words.length === 1) return last
  return `${words.slice(0, -1).join(', ')} & ${last}`
}

/**
 * The words a mobility session gives itself — what it is about to work on.
 *
 * A stretch speaks regions, not muscle groups (see `MOBILITY_REGIONS`), and a
 * mobility plan's `dayType` is a placeholder satisfying the shared plan shape —
 * so "Full Body" is the one thing the opening must NOT print for one of these.
 * Ranked by how much of the session each region gets, so a Posture session
 * names the upper back before the hip it borrowed one movement for.
 */
const REGION_WORD: Record<MobilityRegion, string> = {
  thoracic: 'upper back',
  shoulders: 'shoulders',
  neck: 'neck',
  chest: 'chest',
  lower_back: 'lower back',
  hips: 'hips',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  quads: 'quads',
  calves: 'calves',
}

export function regionWords(regions: MobilityRegion[], max = 3): string | null {
  const counts = new Map<MobilityRegion, number>()
  for (const r of regions) counts.set(r, (counts.get(r) ?? 0) + 1)
  // Count first, then first-appearance — ties must not depend on Map order
  // alone, or the same session could name itself two different ways.
  const order = [...counts.keys()]
  const ranked = order
    .slice()
    .sort((a, b) => counts.get(b)! - counts.get(a)! || order.indexOf(a) - order.indexOf(b))
    .slice(0, max)
  return joinWords(ranked.map((r) => REGION_WORD[r]))
}

/**
 * Where the block sits in the session, 1-based among the WORK blocks — the
 * warm-up is not "block 1", exactly as `sessionPosition` counts it.
 *
 * The Finisher keeps its name: it is already a human word, it is already the
 * one block the player styles differently, and "Block 4 of 4" would throw away
 * the one thing everyone in the session knows about it.
 */
export function blockPosition(
  kind: 'superset' | 'circuit',
  blockNumber: number,
  blockCount: number,
): string {
  return kind === 'circuit' ? 'Finisher' : `Block ${blockNumber} of ${blockCount}`
}

/** The whole display name: `Block 2 of 4 — back & shoulders`. */
export function workBlockName(input: {
  kind: 'superset' | 'circuit'
  blockNumber: number
  blockCount: number
  primaries: MuscleGroup[]
}): string {
  const position = blockPosition(input.kind, input.blockNumber, input.blockCount)
  const words = muscleWords(input.primaries)
  return words ? `${position} — ${words}` : position
}

import type { MuscleGroup } from '../catalog/types'

/** The block kinds that carry sets rather than a timed flow. */
export type WorkBlockKind = 'superset' | 'circuit' | 'activate'

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
  const words = distinct.slice(0, 3)
  const last = words[words.length - 1]
  if (last === undefined) return null
  if (words.length === 1) return last
  return `${words.slice(0, -1).join(', ')} & ${last}`
}

/**
 * Where the block sits in the session, 1-based among the WORK blocks — the
 * warm-up is not "block 1", exactly as `sessionPosition` counts it.
 *
 * The Finisher keeps its name: it is already a human word, it is already the
 * one block the player styles differently, and "Block 4 of 4" would throw away
 * the one thing everyone in the session knows about it. Activate keeps its name
 * for the same reason, and for one more: it is the third phase of a named
 * routine, so "Block 1 of 1" would rename the only part of the session the
 * person came for.
 */
export function blockPosition(
  kind: WorkBlockKind,
  blockNumber: number,
  blockCount: number,
): string {
  if (kind === 'circuit') return 'Finisher'
  if (kind === 'activate') return 'Activate'
  return `Block ${blockNumber} of ${blockCount}`
}

/** The whole display name: `Block 2 of 4 — back & shoulders`. */
export function workBlockName(input: {
  kind: WorkBlockKind
  blockNumber: number
  blockCount: number
  primaries: MuscleGroup[]
}): string {
  const position = blockPosition(input.kind, input.blockNumber, input.blockCount)
  const words = muscleWords(input.primaries)
  return words ? `${position} — ${words}` : position
}

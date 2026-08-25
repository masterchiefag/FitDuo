/**
 * What one person's body actually did in one session.
 *
 * Separate from `deriveStats`, which replays the whole log to answer "who are
 * you now". This answers "what did you just do", which is the only thing the
 * last screen of a session can honestly say about the person in front of it.
 *
 * Volume is the standard tonnage: weight × reps, summed. Bodyweight sets carry
 * `weight === 0` and so add nothing to it — which is why reps are counted too,
 * or a chair-dip-and-plank session would end on "0 kg moved".
 */
export interface SessionTotals {
  sets: number
  reps: number
  volumeKg: number
}

/** The fields a set log needs to have; both the draft and the event shape fit. */
interface CountableSet {
  userId: string
  actualReps: number
  weight: number
}

export function sessionTotals(sets: readonly CountableSet[], userId: string): SessionTotals {
  let count = 0
  let reps = 0
  let volumeKg = 0
  for (const s of sets) {
    if (s.userId !== userId) continue
    count += 1
    reps += s.actualReps
    volumeKg += s.weight * s.actualReps
  }
  // Tonnage lands on halves at worst (2.5 kg dumbbells), so rounding here keeps
  // "1237.5000000001 kg" off the one screen that is meant to feel finished.
  return { sets: count, reps, volumeKg: Math.round(volumeKg) }
}

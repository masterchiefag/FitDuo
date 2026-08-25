import type { LastPerformance, PersonTarget } from '../generator/types'

/**
 * The rest screen's one earned fact — or nothing at all.
 *
 * "Last time 7.5 kg × 10" is only worth reading when today asks for something
 * else; a fact that repeats today's number is noise, and a rest screen that
 * carries noise stops being read. So it is news exactly when the prescription
 * moved.
 *
 * Both numbers are compared, not just the weight: bodyweight movements carry
 * `weight === 0` on either side, so weight alone would mean chair dips and
 * planks never have news, and on a weighted movement the extra rep IS the
 * progression that week (double progression tops out the rep range before it
 * steps the bell).
 */
export function lastTimeNews(
  target: PersonTarget,
  last: LastPerformance | undefined,
): LastPerformance | null {
  if (!last) return null
  if (last.weight === target.weight && last.reps === target.targetReps) return null
  return last
}

/**
 * Whether today's prescription is the harder one.
 *
 * The fact is worth saying either way — a lighter day is the app visibly
 * answering a "too hard" tap, and an answer nobody sees is why people stop
 * telling you things. But only the harder day is the prize for good work
 * (principle 2), so a step down must not borrow its styling: the same emerald
 * "last time 10 kg × 8" beside today's 7.5 kg would celebrate a deload.
 */
export function movedUp(target: PersonTarget, last: LastPerformance): boolean {
  if (target.weight !== last.weight) return target.weight > last.weight
  return target.targetReps > last.reps
}

/**
 * What one person's card says under the target — including on the day the app
 * knows nothing.
 */
export type TargetNote =
  | { kind: 'last_time'; last: LastPerformance; up: boolean }
  | { kind: 'first_time' }

/**
 * The rest/changeover card's note, cold store included.
 *
 * `lastTimeNews` returns null for two different situations and the card treated
 * them as one: *today equals last time* (deliberate silence — a fact that
 * repeats today's number is noise) and *there is no last time at all*. The
 * second is every card of a first-ever session, and it is why the first real
 * session called the rest screens dead nine days after they shipped "worth
 * reading": the one earned fact cannot exist yet, so the screen's best row was
 * blank exactly when the app most needed to be worth reading (docs/SESSIONS.md,
 * finding 3).
 *
 * A first time is a true thing to say, so it is said — and it says what the app
 * will do with today, which is the only promise it can actually keep.
 *
 * `firstAppearance` is what keeps it from becoming wallpaper. `lastTime` is
 * frozen at generate time and cannot learn from the session it is in, so from
 * the second round onward it still reports "nothing logged" for a movement they
 * finished five minutes ago — and the line would then print on every rest
 * screen of a first session, which is the staleness the persona brief budgets
 * against and exactly the noise `lastTimeNews` already refuses to print. Said
 * once, before the first set of that movement (Grok, PR #30).
 *
 * Holds keep their existing silence *when there is history*: "last time 1 rep"
 * is not a fact. Never having held it is still a fact.
 */
export function targetNote(
  target: PersonTarget,
  last: LastPerformance | undefined,
  isHold: boolean,
  firstAppearance: boolean,
): TargetNote | null {
  if (!last) return firstAppearance ? { kind: 'first_time' } : null
  if (isHold) return null
  const news = lastTimeNews(target, last)
  return news ? { kind: 'last_time', last: news, up: movedUp(target, news) } : null
}

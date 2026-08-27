import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { usePlayerStore } from '../stores/playerStore'
import { exercisesById } from '../lib/catalog'
import { PROFILES, profileById } from '../lib/profiles'
import { loadSnapshot, clearSnapshot } from '../../infra/localstore'
import { playCue } from '../../infra/audio'
import { BLOCK_TRANSITION_SECONDS, CHANGEOVER_SECONDS } from '../../core/player/reducer'
import { sessionPosition } from '../../core/player/position'
import { targetNote } from '../../core/player/lastTime'
import { openingLine, personLoads, sessionSummary } from '../../core/player/opening'
import { blockNames, mobilityRegions, sessionShape } from '../lib/blockName'
import { DAY_TYPE_LABEL } from '../lib/planner'
import type {
  Block,
  LastPerformance,
  PersonTarget,
  WorkItem,
  WorkoutPlan,
} from '../../core/generator/types'
import type { Overrides, PlayerState } from '../../core/player/types'
import type { Exercise } from '../../core/catalog/types'
import { grabLabel, kitLine, lastTimeLabel, loadLabel } from '../lib/load'
import { areaLabel, cautionsFor } from '../lib/cautions'
import type { BodyArea } from '../../core/catalog/types'
import { isWorkBlock, type WorkBlock } from '../../core/player/position'
import { ladderFor } from '../../core/catalog/resistance'
import { stepWeight } from '../../core/generator/progression'

// ─── helpers ─────────────────────────────────────────────────────────────────

const holdSeconds = (ex: Exercise) => (ex.repRange[1] === 1 ? ex.secondsPerRep : null)

function phaseTotalSeconds(plan: WorkoutPlan, state: PlayerState): number {
  switch (state.phase) {
    case 'timed': {
      const b = plan.blocks[state.blockIndex]
      return b && 'items' in b && 'seconds' in (b.items[state.itemIndex] ?? {})
        ? ((b.items[state.itemIndex] as { seconds: number }).seconds ?? 1)
        : 1
    }
    case 'work': {
      const b = plan.blocks[state.blockIndex]
      const item = b && isWorkBlock(b) ? b.items[state.itemIndex] : undefined
      return item?.workSeconds ?? 1
    }
    case 'changeover':
      return CHANGEOVER_SECONDS
    case 'rest': {
      const b = plan.blocks[state.blockIndex]
      return b && isWorkBlock(b) ? b.restSeconds : 1
    }
    case 'block_transition':
      return BLOCK_TRANSITION_SECONDS
    default:
      return 1
  }
}

/**
 * What the session was, said once as the cool-down's frame.
 *
 * Household-level on purpose — one screen, two bodies (JOURNEY principle 7).
 * Blocks come from the plan (a block cannot be skipped; "Finish here" ends the
 * session before the cool-down), and the set count is what was actually
 * logged, not what was programmed, so a skipped set does not get claimed.
 * Per-person work — the volume each body moved — waits for the completion
 * cards, where each person has their own.
 */
function workDoneLine(plan: WorkoutPlan, setsDone: number): string {
  const blocks = plan.blocks.filter(isWorkBlock).length
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return `That's the work done — ${plural(blocks, 'block')}, ${plural(setsDone, 'set')}.`
}

/** Linear progress through the whole session, 0..1. */
function sessionProgress(plan: WorkoutPlan, state: PlayerState): number {
  const steps: number[] = plan.blocks.map((b) =>
    isWorkBlock(b) ? b.rounds * b.items.length : b.items.length,
  )
  const total = steps.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const before = (blockIndex: number) => steps.slice(0, blockIndex).reduce((a, b) => a + b, 0)
  const s = state.phase === 'paused' ? state.resumeState : state
  switch (s.phase) {
    case 'idle':
      return 0
    case 'timed':
      return (before(s.blockIndex) + s.itemIndex) / total
    case 'work': {
      const b = plan.blocks[s.blockIndex]
      const items = b && 'items' in b ? b.items.length : 1
      return (before(s.blockIndex) + s.round * items + s.itemIndex) / total
    }
    case 'changeover': {
      const b = plan.blocks[s.blockIndex]
      const items = b && 'items' in b ? b.items.length : 1
      return (before(s.blockIndex) + s.round * items + s.nextItemIndex) / total
    }
    case 'rest': {
      const b = plan.blocks[s.blockIndex]
      const items = b && 'items' in b ? b.items.length : 1
      return (before(s.blockIndex) + s.round * items) / total
    }
    case 'block_transition':
      return before(s.nextBlockIndex) / total
    case 'block_gate':
      return before(s.nextBlockIndex) / total

    case 'complete':
      return 1
    default:
      return 0
  }
}

// ─── the training-distance type scale ────────────────────────────────────────

/**
 * Every session screen is read from meters away, mid-set — not at the desk
 * where it was built. First real session: *"text too small on all screens — I
 * have to come close to see what any exercise says"* (docs/SESSIONS.md,
 * finding 2), which is the same builder-as-witness failure as the rest screens:
 * verified at arm's length, used across a room (docs/DECISIONS.md 2026-08-25).
 *
 * Named here rather than inlined per screen so the four session surfaces stay
 * one scale — the finding was "all screens", so a fix on three of them is a
 * screen that still sends someone walking over. Mobile-first pairs: the base
 * size is 375 px, the `sm:` size is the laptop that is actually across the room.
 *
 * The bar these are sized against, and the one every walk frame has to clear:
 * **legible at one-third scale.**
 */
const T = {
  /** Phase eyebrow — REST, GET READY, WARM-UP. */
  eyebrow: 'text-lg font-bold tracking-widest uppercase sm:text-2xl',
  /** The movement itself: the biggest words the app ever says. */
  exercise: 'text-4xl font-extrabold tracking-tight sm:text-6xl',
  /** Second rank — "Up next: Block 3 of 4 — chest & triceps". */
  heading: 'text-2xl font-extrabold tracking-tight sm:text-4xl',
  /** Where you are, what is left, what is coming. */
  status: 'text-lg font-semibold sm:text-2xl',
  /** Form cues and the tempo line: sentences, read while moving. */
  cue: 'text-lg sm:text-xl',
  /** A person's name over their own numbers. */
  person: 'text-base font-bold tracking-wide uppercase sm:text-xl',
  /** The instruction that starts a set: "Grab 12.5 kg". */
  grab: 'text-3xl font-extrabold sm:text-4xl',
  /** Reps and weight on the work screen. */
  target: 'text-4xl font-extrabold sm:text-5xl',
  /** Notes under a target — last time, first time. */
  note: 'text-base font-semibold sm:text-lg',
} as const

// ─── shared pieces ───────────────────────────────────────────────────────────

const MEDIA_SIZE = {
  large: 'mx-auto max-h-64 w-full rounded-2xl bg-white object-contain sm:max-h-80',
  /** The work screen, where the numbers outrank the photo for the same pixels. */
  medium: 'mx-auto max-h-40 w-full rounded-2xl bg-white object-contain sm:max-h-48',
  small: 'h-16 w-20 rounded-lg bg-white object-contain',
} as const

function ExerciseMedia({ ex, size = 'large' }: { ex: Exercise; size?: keyof typeof MEDIA_SIZE }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 1100)
    return () => clearInterval(t)
  }, [])
  const img = <img src={ex.media.images[frame]} alt={ex.name} className={MEDIA_SIZE[size]} />
  // The demo frames come from a gym dataset, so the picture can show a bench we
  // do not ask for. Say so right under it, or the photo quietly overrides the cues.
  if (size === 'small' || !ex.setupNote) return img
  return (
    <>
      {img}
      <p className={`mx-auto mt-2 max-w-md text-slate-500 italic dark:text-slate-400 ${T.cue}`}>
        {ex.setupNote}
      </p>
    </>
  )
}

/**
 * A bare countdown is ambiguous: the same ring meant "you are lifting" on the
 * work screen and "you are getting ready" on the changeover, and they were
 * told apart by a small word at the top. First real session: "first time I saw
 * it I thought it had started the set." So a ring now carries its own meaning —
 * colour AND a caption under the number saying what it is counting to.
 */
const RING_TONE = {
  work: 'stroke-indigo-500',
  ready: 'stroke-amber-500',
  rest: 'stroke-emerald-500',
  /** The cool-down: the same ring, deliberately the quietest one in the app. */
  wind_down: 'stroke-slate-400',
} as const

function RingTimer({
  remaining,
  total,
  tone = 'work',
  caption,
  size = 'lg',
}: {
  remaining: number
  total: number
  tone?: keyof typeof RING_TONE
  caption?: string
  size?: 'lg' | 'xl'
}) {
  const r = 64
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, remaining / Math.max(1, total)))
  return (
    <div
      className={`relative mx-auto ${size === 'xl' ? 'h-48 w-48 sm:h-60 sm:w-60' : 'h-40 w-40 sm:h-52 sm:w-52'}`}
    >
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
        <circle
          cx="80"
          cy="80"
          r={r}
          className="fill-none stroke-slate-200 dark:stroke-slate-800"
          strokeWidth="10"
        />
        <circle
          cx="80"
          cy="80"
          r={r}
          className={`fill-none ${RING_TONE[tone]} transition-[stroke-dashoffset] duration-200`}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-extrabold tabular-nums ${size === 'xl' ? 'text-6xl sm:text-7xl' : 'text-5xl sm:text-6xl'}`}
        >
          {Math.ceil(remaining)}
        </span>
        {caption && (
          <span className="mt-0.5 text-sm font-bold tracking-wider text-slate-400 uppercase">
            {caption}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * How to move, and what to watch — the tempo line first.
 *
 * The tempo cue is authored per exercise (`tempoCue`) and never computed from
 * `secondsPerRep`, which exists so the generator can fit a session into the
 * time budget and carries 1 for a warm-up. First real session, on bent-over
 * rows: *"nothing about speed of movement, here or anywhere. If it's my first
 * time I don't know how to do it right"* (docs/SESSIONS.md, finding 4). It sits
 * above the form cues because it is the one that changes what the next rep
 * looks like.
 */
/**
 * What to watch on this movement, from the areas it loads.
 *
 * Shown to everyone, flag or no flag: a person who waits for a sore shoulder
 * before being told to keep the ribs down has already done the set that caused
 * it (PLAN §R5). A flagged area moves to the front and gets the loud styling —
 * it is the reason their number is lower than it was.
 *
 * `painAreas` is the UNION across the session's participants, because this line
 * sits under a shared demo rather than on a person's card, and one screen
 * cannot whisper to one of two people standing at it. The targets stay strictly
 * per person; only the reading matter is shared, and reading someone else's
 * caution costs nothing.
 */
/** Every flag in this session, deduped — see `Cautions` for why a union. */
function sessionPainAreas(participantIds: string[]): BodyArea[] {
  return [...new Set(participantIds.flatMap((id) => profileById(id)?.painAreas ?? []))]
}

function Cautions({ ex, painAreas }: { ex: Exercise; painAreas: BodyArea[] }) {
  const cautions = cautionsFor(ex, painAreas)
  if (cautions.length === 0) return null
  const lead = cautions[0]!
  return (
    <p
      className={
        lead.flagged
          ? `mb-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 ${T.cue}`
          : `mb-3 text-slate-500 dark:text-slate-400 ${T.cue}`
      }
    >
      {lead.flagged && (
        <span className="mr-2 text-sm font-bold tracking-widest uppercase">
          Your {areaLabel(lead.area)}
        </span>
      )}
      {lead.line}
    </p>
  )
}

function Cues({
  ex,
  focusCue,
  painAreas = [],
}: {
  ex: Exercise
  focusCue?: string | undefined
  /** Union of the flags in this session — see `Cautions` for why a union. */
  painAreas?: BodyArea[]
}) {
  return (
    <div className="mx-auto mt-4 max-w-2xl">
      <Cautions ex={ex} painAreas={painAreas} />
      {/* Why this movement is in the session at all — above the tempo, because
          it is the reason to do the next rep properly rather than the way to.
          Lives here rather than in `TimedView` so it survives the phase
          becoming loaded: an Activate set is the one that most needs it, and it
          was the one screen that had lost it (Grok, PR #41). */}
      {focusCue && (
        <p
          className={`mb-3 rounded-2xl bg-emerald-50 px-4 py-3 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 ${T.cue}`}
        >
          {focusCue}
        </p>
      )}
      {ex.tempoCue && (
        <p
          className={`rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 ${T.cue}`}
        >
          <span className="mr-2 text-sm font-bold tracking-widest text-slate-400 uppercase">
            Tempo
          </span>
          {ex.tempoCue}
        </p>
      )}
      <ul className={`mt-3 space-y-1 text-slate-500 dark:text-slate-400 ${T.cue}`}>
        {ex.media.instructions.map((c) => (
          <li key={c}>• {c}</li>
        ))}
      </ul>
    </div>
  )
}

// ─── phase views ─────────────────────────────────────────────────────────────

function TimedView({
  title,
  exercise,
  remaining,
  total,
  nextLabel,
  focusCue,
  painAreas,
  ending,
  onSkip,
}: {
  title: string
  exercise: Exercise | undefined
  remaining: number
  total: number
  nextLabel: string | null
  focusCue?: string | undefined
  painAreas: BodyArea[]
  /**
   * The cool-down, which is not a second warm-up: it is the last five minutes
   * of the session, and peak–end says those are the ones that get remembered
   * (JOURNEY act 5). Quieter type, a slate ring instead of the work indigo, and
   * a line saying the work is behind them rather than "Next up".
   */
  ending?: { line: string; lastOne: boolean } | undefined
  onSkip: () => void
}) {
  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p className={`${T.eyebrow} ${ending ? 'text-slate-400' : 'text-indigo-500'}`}>{title}</p>
      {ending && (
        <p className={`mt-1 text-slate-500 dark:text-slate-400 ${T.status}`}>{ending.line}</p>
      )}
      <h2 className={`mt-1 ${T.exercise}`}>{exercise?.name ?? '—'}</h2>
      {exercise && (
        <div className="mt-4">
          <ExerciseMedia ex={exercise} />
        </div>
      )}
      <div className="mt-4">
        <RingTimer remaining={remaining} total={total} tone={ending ? 'wind_down' : 'work'} />
      </div>
      {exercise && <Cues ex={exercise} focusCue={focusCue} painAreas={painAreas} />}
      {ending?.lastOne ? (
        <p className={`mt-4 text-slate-500 dark:text-slate-400 ${T.status}`}>
          Last one — take it slow.
        </p>
      ) : (
        nextLabel && (
          <p className={`mt-4 text-slate-500 ${T.status}`}>
            Next up: <span className="font-bold">{nextLabel}</span>
          </p>
        )
      )}
      <button
        onClick={onSkip}
        className="mt-4 rounded-xl px-5 py-3 text-lg font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        Skip →
      </button>
    </div>
  )
}

/**
 * What the next block actually IS — the movements, not its label.
 *
 * A superset alternates its two exercises for every round, so a block is four
 * sets of the same pair and a session feels like it owns two movements. The
 * screen between blocks is the only moment that can say otherwise, and
 * "Up next: Strength B" says nothing at all. First real session, first
 * reaction: "I keep seeing lateral raises and chair dips only" — from someone
 * who had stopped at the gate, one tap short of two different exercises.
 */
function NextUpPreview({ block }: { block: Block | undefined }) {
  if (!block) return null
  const rounds = isWorkBlock(block) ? block.rounds : null
  return (
    <div className="mx-auto mt-3 flex max-w-xl flex-wrap items-center justify-center gap-2">
      {block.items.map((item, i) => {
        const ex = exercisesById.get(item.exerciseId)
        return (
          <div
            key={`${item.exerciseId}-${i}`}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900"
          >
            {ex && <ExerciseMedia ex={ex} size="small" />}
            <span className={`pr-1 font-bold ${T.status}`}>{ex?.name ?? item.exerciseId}</span>
          </div>
        )
      })}
      {rounds !== null && (
        <span className="text-base font-semibold text-slate-400">
          × {rounds} round{rounds === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}

/**
 * One person's card for the movement that is about to start: what to pick up,
 * for how many, and the one earned fact when today's number has moved.
 *
 * Shared by rest AND changeover on purpose. Rest only ever previews item 0 of
 * the next round, so a superset's second movement and the Finisher's 2nd and
 * 3rd reach the floor through a changeover — five of nine movements in a
 * 55-minute session. Rendering the fact on one screen only would compute it
 * for those and show it for none (Grok, PR #22).
 */
function NextTargetCard({
  userId,
  exercise,
  target,
  last,
  hold,
  tone,
  firstAppearance,
}: {
  userId: string
  /** Needed to say the load: a band is a colour, a dumbbell is kilos. */
  exercise: Exercise | undefined
  target: PersonTarget
  last: LastPerformance | undefined
  /** Timed holds have no reps to compare — "last time 1 rep" is not a fact. */
  hold: number | null
  tone: 'ready' | 'rest'
  /** Whether this is the movement's first set of the session — see `targetNote`. */
  firstAppearance: boolean
}) {
  const profile = profileById(userId) ?? PROFILES[0]!
  const note = targetNote(target, last, hold !== null, firstAppearance)
  return (
    <div
      className={
        tone === 'ready'
          ? 'rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950'
          : 'rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950'
      }
    >
      <p className={`${T.person} ${profile.accent.text}`}>{profile.name}</p>
      <p className={`mt-0.5 ${T.grab}`}>{grabLabel(exercise, target.weight)}</p>
      <p className={`font-semibold text-slate-500 dark:text-slate-400 ${T.status}`}>
        {hold ? `${hold}s hold` : `${target.targetReps} reps`}
      </p>
      {/* The prize for good work is better work: today's number beside the one
          it beat. A lighter day still says it — that is the app answering a
          "too hard" tap — but without the colour that would celebrate it. And
          the day there is no number yet, the screen says THAT, rather than
          leaving its best row blank on the one session nobody has any history
          for (docs/SESSIONS.md, finding 3). */}
      {note?.kind === 'last_time' && (
        <p
          className={`mt-1 ${T.note} ${note.up ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}
        >
          Last time {lastTimeLabel(exercise, note.last)}
        </p>
      )}
      {note?.kind === 'first_time' && (
        <p className={`mt-1 text-slate-500 dark:text-slate-400 ${T.note}`}>
          First time on this one — we&rsquo;ll remember today for next time.
        </p>
      )}
    </div>
  )
}

function TargetPanel({
  item,
  overrides,
  onAdjust,
}: {
  item: WorkItem
  overrides: Overrides
  /** Absent on preview panels (changeover, rest): nothing to correct yet. */
  onAdjust?: (userId: string, field: 'targetReps' | 'weight', delta: number) => void
}) {
  const ex = exercisesById.get(item.exerciseId)
  const hold = ex ? holdSeconds(ex) : null
  return (
    <div
      className={`mx-auto grid max-w-xl gap-3 ${Object.keys(item.perPerson).length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}
    >
      {Object.entries(item.perPerson).map(([userId, target]) => {
        const profile = profileById(userId) ?? PROFILES[0]!
        const o = overrides[userId]
        const reps = o?.targetReps ?? target.targetReps
        const weight = o?.weight ?? target.weight
        const adjusted = o !== undefined
        return (
          <div
            key={userId}
            className={`rounded-2xl border-2 bg-white p-3 dark:bg-slate-900 ${adjusted ? profile.accent.ring + ' border-current' : 'border-slate-200 dark:border-slate-800'}`}
          >
            <p className={`${T.person} ${profile.accent.text}`}>{profile.name}</p>
            {hold ? (
              <p className={`mt-1 ${T.target}`}>
                {hold}s <span className="text-xl font-semibold text-slate-400">hold</span>
              </p>
            ) : (
              <>
                {/* The number never breaks across lines — "2.5" over "kg" is
                    unreadable at the distance this type exists for. The ± pair
                    drops below it instead when the card is too narrow to hold
                    both, which is the duo card at 375. */}
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <p className={`tabular-nums whitespace-nowrap ${T.target}`}>
                    {reps} <span className="text-xl font-semibold text-slate-400">reps</span>
                  </p>
                  <div className={`flex shrink-0 gap-1 ${onAdjust ? '' : 'hidden'}`}>
                    <button
                      onClick={() => onAdjust?.(userId, 'targetReps', -1)}
                      className="h-9 w-9 rounded-lg bg-slate-100 text-lg font-bold dark:bg-slate-800"
                    >
                      −
                    </button>
                    <button
                      onClick={() => onAdjust?.(userId, 'targetReps', 1)}
                      className="h-9 w-9 rounded-lg bg-slate-100 text-lg font-bold dark:bg-slate-800"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <p className="text-2xl font-bold whitespace-nowrap text-slate-600 sm:text-3xl dark:text-slate-300">
                    {loadLabel(ex, weight)}
                  </p>
                  {target.weight > 0 && onAdjust && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => onAdjust(userId, 'weight', -1)}
                        className="h-9 w-9 rounded-lg bg-slate-100 text-lg font-bold dark:bg-slate-800"
                      >
                        −
                      </button>
                      <button
                        onClick={() => onAdjust(userId, 'weight', 1)}
                        className="h-9 w-9 rounded-lg bg-slate-100 text-lg font-bold dark:bg-slate-800"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function WorkView({
  plan,
  state,
  remaining,
}: {
  plan: WorkoutPlan
  state: Extract<PlayerState, { phase: 'work' }>
  remaining: number
}) {
  const dispatch = usePlayerStore((s) => s.dispatch)
  const block = plan.blocks[state.blockIndex] as WorkBlock
  const item = block.items[state.itemIndex]!
  const ex = exercisesById.get(item.exerciseId)
  // Adjustments live in the reducer, not here: the set can end on its own
  // timer, and a correction held in component state would be lost exactly then.
  const overrides = state.overrides ?? {}

  const nextItem = block.items[state.itemIndex + 1]
  const nextEx = nextItem ? exercisesById.get(nextItem.exerciseId) : null

  /**
   * `delta` is a DIRECTION for weight and an amount for reps.
   *
   * Weight moves one rung along the ladder this person actually owns — the same
   * one `nextTarget` prescribed from — because the alternative is arithmetic on
   * a number the UI never shows: a band's load is a colour, and 1.7 + 2.5 names
   * no colour at all. For dumbbells it is the same fix a size smaller, since a
   * household owning 1, 2.5 and 5 was previously offered 3.5.
   */
  const adjust = (userId: string, field: 'targetReps' | 'weight', delta: number) => {
    const target = item.perPerson[userId]!
    const current = overrides[userId]?.[field] ?? target[field]
    if (field === 'weight') {
      const profile = profileById(userId)
      const ladder = ex && profile ? ladderFor(ex, profile) : []
      const next = ladder.length > 0 ? stepWeight(ladder, current, delta > 0 ? 1 : -1) : current
      dispatch({ type: 'ADJUST', now: Date.now(), userId, target: { weight: next } })
      return
    }
    dispatch({
      type: 'ADJUST',
      now: Date.now(),
      userId,
      target: { targetReps: Math.max(1, current + delta) },
    })
  }

  // The last work block of every session that has one, resting 60s where the
  // strength blocks rest 75: the generator already built a climax and the
  // player rendered it in the same indigo pill as block one. Marked by KIND,
  // never by its round count — that varies day to day (JOURNEY Part 5).
  const isFinisher = block.kind === 'circuit'
  // Where this block sits and what it works, never `Strength B` (finding 5).
  // The pill takes the position alone: the movement's own name is directly
  // underneath it in the largest type on the screen, so naming the muscles here
  // too would spend a mid-set line on something already answered.
  const names = blockNames(plan, state.blockIndex)

  return (
    // Wider than the other surfaces: this one carries the ring, both people's
    // numbers and the cues at once, and at this type scale 2xl made every one
    // of them wrap.
    <div className="mx-auto max-w-4xl p-4 text-center">
      <div
        className={`inline-flex items-center gap-2 rounded-full px-5 py-2 ${isFinisher ? 'bg-rose-600' : 'bg-indigo-600'}`}
      >
        <span className={`text-white ${T.eyebrow}`}>
          {isFinisher ? '🔥 ' : 'Go — '}
          {names?.position ?? 'Block'} · Round {state.round + 1}/{block.rounds}
        </span>
      </div>
      {/* Orientation, not encouragement: nothing motivational belongs inside a
          set (JOURNEY principle 3). Where you are is instruction. */}
      {isFinisher && (
        <p className="mt-1 text-base font-bold tracking-widest text-rose-500 uppercase">
          Last block of the session
        </p>
      )}
      <h2 className={`mt-2 ${T.exercise}`}>{ex?.name ?? item.exerciseId}</h2>
      <div className="mt-3 grid items-center gap-4 sm:grid-cols-[auto_1fr]">
        <RingTimer
          remaining={remaining}
          total={item.workSeconds}
          tone="work"
          caption="left in set"
          size="xl"
        />
        <TargetPanel item={item} overrides={overrides} onAdjust={adjust} />
      </div>
      {ex && (
        <div className="mt-4 grid items-center gap-4 sm:grid-cols-[auto_1fr]">
          {/* The photo is demoted, not dropped: mid-set the numbers and the
              tempo are what a person is actually reading from across the room,
              and they were losing the page to a 320 px stock frame. */}
          <ExerciseMedia ex={ex} size="medium" />
          <div className="text-left">
            <Cues
              ex={ex}
              focusCue={block.kind === 'activate' ? ex.mobility?.focusCue : undefined}
              painAreas={sessionPainAreas(plan.participantIds)}
            />
          </div>
        </div>
      )}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => dispatch({ type: 'SET_DONE', now: Date.now() })}
        className="mt-5 w-full max-w-2xl rounded-2xl bg-indigo-600 py-5 text-3xl font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500"
      >
        Done ✓
      </motion.button>
      <div className="mt-3 flex items-center justify-center gap-4 text-lg text-slate-500">
        {/* The set ends on its own, so "we need longer" has to be one tap and
            not Pause — which nobody reaches for mid-rep. */}
        <button
          onClick={() => dispatch({ type: 'EXTEND', now: Date.now(), seconds: 15 })}
          className="rounded-lg px-3 py-1.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          +15s
        </button>
        {nextEx && (
          <span>
            Next: <span className="font-semibold">{nextEx.name}</span>
          </span>
        )}
        <button
          onClick={() => dispatch({ type: 'SKIP', now: Date.now() })}
          className="rounded-lg px-3 py-1.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

/**
 * The get-ready screen between two movements in a round.
 *
 * Deliberately NOT a smaller work screen: it leads with the instruction (pick
 * this up), counts down to a start rather than to an end, and carries none of
 * the work screen's controls. It is the only place that can tell you what is
 * about to happen while your hands are still free.
 */
function ChangeoverView({
  plan,
  state,
  remaining,
}: {
  plan: WorkoutPlan
  state: Extract<PlayerState, { phase: 'changeover' }>
  remaining: number
}) {
  const dispatch = usePlayerStore((s) => s.dispatch)
  const block = plan.blocks[state.blockIndex] as WorkBlock
  const next = block.items[state.nextItemIndex]
  const nextEx = next ? exercisesById.get(next.exerciseId) : null
  const hold = nextEx ? holdSeconds(nextEx) : null
  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-5 py-2 dark:bg-amber-950">
        <span className="text-xl">🔄</span>
        <span className={`text-amber-700 dark:text-amber-300 ${T.eyebrow}`}>Get ready</span>
      </div>
      <p className={`mt-4 text-slate-500 ${T.status}`}>Coming up</p>
      <h2 className={T.exercise}>{nextEx?.name ?? 'Next up'}</h2>

      {/* The one thing to DO right now: pick up the right weight. Two columns
          rather than a wrapping row: a first-time card is three lines tall, and
          stacked they pushed the countdown itself off the bottom of a laptop. */}
      {next && (
        <div
          className={`mx-auto mt-3 grid gap-3 text-left ${Object.keys(next.perPerson).length > 1 ? 'grid-cols-2' : 'max-w-sm grid-cols-1'}`}
        >
          {Object.entries(next.perPerson).map(([userId, target]) => (
            <NextTargetCard
              key={userId}
              userId={userId}
              exercise={nextEx ?? undefined}
              target={target}
              last={next.lastTime?.[userId]}
              hold={hold}
              tone="ready"
              // Round 0 is the only time this movement has not been done yet
              // today — the changeover into it is where "first time" is true.
              firstAppearance={state.round === 0}
            />
          ))}
        </div>
      )}

      <div className="mt-4">
        <RingTimer
          remaining={remaining}
          total={CHANGEOVER_SECONDS}
          tone="ready"
          caption="to start"
        />
      </div>
      <button
        onClick={() => dispatch({ type: 'SKIP', now: Date.now() })}
        className="mt-4 rounded-xl bg-amber-500 px-6 py-3 text-xl font-extrabold text-white hover:bg-amber-400"
      >
        I&rsquo;m ready →
      </button>
      {/* Below the fold on purpose now: the instruction and the clock have to
          clear the top of the screen at training distance, and the picture is
          for whoever walks over to check the setup. */}
      {nextEx && (
        <div className="mt-4">
          <ExerciseMedia ex={nextEx} size="medium" />
        </div>
      )}
    </div>
  )
}

/**
 * Rest — a quarter of the session on its own, a third with the changeovers, and
 * the only surface where nothing competes with a rep (JOURNEY Part 3).
 *
 * So it carries the three things a trainer would say here and nowhere else:
 * where you are in the session, what to pick up next — per person, because rest
 * is when you set up — and the one earned fact, last time beside today, shown
 * only when the two differ.
 */
function RestView({
  plan,
  state,
  remaining,
}: {
  plan: WorkoutPlan
  state: Extract<PlayerState, { phase: 'rest' }>
  remaining: number
}) {
  const dispatch = usePlayerStore((s) => s.dispatch)
  const block = plan.blocks[state.blockIndex] as WorkBlock
  const next = block.items[state.nextItemIndex]
  const nextEx = next ? exercisesById.get(next.exerciseId) : null
  const hold = nextEx ? holdSeconds(nextEx) : null
  // Structural, from the plan — not from sets logged, which a SKIP makes drift.
  const position = sessionPosition(plan, state)
  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p className={`text-emerald-500 ${T.eyebrow}`}>Rest</p>
      {position && (
        <p className={`mt-1 text-slate-500 dark:text-slate-400 ${T.status}`}>
          Block {position.blockNumber} of {position.blockCount} · {position.setsToGo} set
          {position.setsToGo === 1 ? '' : 's'} to go
        </p>
      )}
      <div className="mt-5">
        <RingTimer remaining={remaining} total={block.restSeconds} tone="rest" caption="rest" />
      </div>
      {nextEx && next && (
        <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-slate-200 bg-white p-3 text-left dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <ExerciseMedia ex={nextEx} size="small" />
            <div>
              <p className="text-base text-slate-400">
                Next · Round {state.round + 1}/{block.rounds}
              </p>
              <p className={T.heading}>{nextEx.name}</p>
              {/* Rest is exactly when you get set up, so the note has to be here
                  too — the thumbnail beside it is the misleading gym frame. */}
              {nextEx.setupNote && (
                <p className={`mt-0.5 text-slate-500 italic dark:text-slate-400 ${T.note}`}>
                  {nextEx.setupNote}
                </p>
              )}
            </div>
          </div>
          <div
            className={`mt-3 grid gap-2 ${Object.keys(next.perPerson).length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}
          >
            {Object.entries(next.perPerson).map(([userId, target]) => (
              <NextTargetCard
                key={userId}
                userId={userId}
                exercise={nextEx ?? undefined}
                target={target}
                last={next.lastTime?.[userId]}
                hold={hold}
                tone="rest"
                // Never: rest previews item 0 of the NEXT round, which is
                // always the movement this round opened with.
                firstAppearance={false}
              />
            ))}
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-center gap-3">
        <button
          onClick={() => dispatch({ type: 'EXTEND', now: Date.now(), seconds: 15 })}
          className="rounded-xl bg-slate-100 px-5 py-3 text-lg font-bold dark:bg-slate-800"
        >
          +15s
        </button>
        <button
          onClick={() => dispatch({ type: 'SKIP', now: Date.now() })}
          className="rounded-xl bg-slate-100 px-5 py-3 text-lg font-bold dark:bg-slate-800"
        >
          Skip →
        </button>
      </div>
    </div>
  )
}

const RATINGS = [
  { rating: 'too_easy', emoji: '😴', label: 'Too easy' },
  { rating: 'right', emoji: '👌', label: 'Just right' },
  { rating: 'too_hard', emoji: '🥵', label: 'Too hard' },
] as const

function BlockTransitionView({
  plan,
  state,
  remaining,
}: {
  plan: WorkoutPlan
  state: Extract<PlayerState, { phase: 'block_transition' }>
  remaining: number
}) {
  const dispatch = usePlayerStore((s) => s.dispatch)
  const nextBlock = plan.blocks[state.nextBlockIndex]
  const nextName = blockNames(plan, state.nextBlockIndex)?.full ?? 'Finish'

  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p className={`text-indigo-500 ${T.eyebrow}`}>Get ready</p>
      <h2 className={`mt-1 ${T.heading}`}>Up next: {nextName}</h2>
      <NextUpPreview block={nextBlock} />
      <div className="mt-4">
        <RingTimer
          remaining={remaining}
          total={BLOCK_TRANSITION_SECONDS}
          tone="ready"
          caption="to start"
        />
      </div>
      <button
        onClick={() => dispatch({ type: 'SKIP', now: Date.now() })}
        className="mt-4 rounded-xl bg-slate-100 px-5 py-3 text-lg font-bold dark:bg-slate-800"
      >
        Start now →
      </button>
    </div>
  )
}

/**
 * The block gate: the session's only required interaction, ~4 taps in an hour.
 *
 * It holds — no countdown ring, nothing expiring underneath them — because it
 * is a presence check, not a rest. Continue alone is a complete answer: an
 * unrated exercise records "just right", which is what a human confirming the
 * block actually means, and keeps progression moving without demanding taps.
 */
function BlockGateView({
  plan,
  state,
}: {
  plan: WorkoutPlan
  state: Extract<PlayerState, { phase: 'block_gate' }>
}) {
  const dispatch = usePlayerStore((s) => s.dispatch)
  const block = plan.blocks[state.blockIndex]
  const done = block && isWorkBlock(block) ? block : null
  const nextBlock = plan.blocks[state.nextBlockIndex]
  // Both halves of this screen used to print the plan's own identifier —
  // "Strength B done! Up next: Strength C" — and the first real session read it
  // exactly as written: *"I didn't get what B and C are"* (docs/SESSIONS.md,
  // finding 5). Position plus the movements' own words, both ways.
  const doneNames = blockNames(plan, state.blockIndex)
  const doneWords = doneNames?.words ? ` — ${doneNames.words}` : ''
  const nextName = blockNames(plan, state.nextBlockIndex)?.full ?? 'Finish'
  // Act 4 has two beats and they sit on different gates: this screen announces
  // the peak that is coming, and the peak's own gate says it happened.
  const finisherNext = nextBlock?.kind === 'circuit'
  const finisherDone = done?.kind === 'circuit'

  return (
    <div className="mx-auto max-w-3xl p-4 text-center">
      <p className={`${T.eyebrow} ${finisherDone ? 'text-rose-500' : 'text-emerald-500'}`}>
        {finisherDone
          ? `🔥 Finisher done${doneWords}`
          : `${doneNames?.position ?? 'Block'} done${doneWords} 🎉`}
      </p>
      <h2 className={`mt-1 ${T.heading}`}>Up next: {nextName}</h2>
      {/* Framing, never a control — the ratings below are what keep progression
          alive and are the only required tap in the hour (JOURNEY Part 5). */}
      {finisherNext && (
        <p className={`mt-1 font-bold text-rose-500 ${T.status}`}>🔥 Last block — the Finisher.</p>
      )}
      {finisherDone && (
        <p className={`mt-1 text-slate-500 dark:text-slate-400 ${T.status}`}>
          That was the peak. The hard work is done.
        </p>
      )}
      <NextUpPreview block={nextBlock} />
      {done && (
        <div className="mx-auto mt-5 max-w-2xl space-y-3 text-left">
          <p className={`text-center text-slate-500 ${T.status}`}>
            How was that? (optional — Continue means “just right”)
          </p>
          {done.items.map((item) => {
            const ex = exercisesById.get(item.exerciseId)
            return (
              <div
                key={item.exerciseId}
                className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <p className={T.status}>{ex?.name ?? item.exerciseId}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {Object.keys(item.perPerson).map((userId) => {
                    const profile = profileById(userId) ?? PROFILES[0]!
                    const chosen = state.ratings[`${userId}:${item.exerciseId}`]
                    return (
                      <div key={userId} className="flex items-center justify-between gap-2">
                        <span className={`${T.person} ${profile.accent.text}`}>{profile.name}</span>
                        <div className="flex gap-1">
                          {RATINGS.map((r) => (
                            <button
                              key={r.rating}
                              title={r.label}
                              onClick={() =>
                                dispatch({
                                  type: 'FEEDBACK',
                                  now: Date.now(),
                                  userId,
                                  exerciseId: item.exerciseId,
                                  rating: r.rating,
                                })
                              }
                              className={`rounded-lg px-2.5 py-1.5 text-2xl transition-transform ${chosen === r.rating ? 'scale-110 bg-indigo-100 dark:bg-indigo-950' : 'opacity-60 hover:opacity-100'}`}
                            >
                              {r.emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => dispatch({ type: 'CONTINUE', now: Date.now() })}
        className="mt-5 w-full max-w-2xl rounded-2xl bg-indigo-600 py-5 text-3xl font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500"
      >
        Continue →
      </motion.button>
      {/* Ending here is a completion, not an abandon: the rest was never
          programmed, so it does not count against them. */}
      <button
        onClick={() => dispatch({ type: 'FINISH_EARLY', now: Date.now() })}
        className="mt-3 rounded-xl px-5 py-3 text-lg font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        Finish here
      </button>
    </div>
  )
}

/**
 * The opening: what today is, what shape it has, and what each person is
 * lifting — said once, before anything starts.
 *
 * First real session: *"kicks off without any context of what today's targets
 * are, what we're doing — not a welcoming start"* (docs/SESSIONS.md, finding 1;
 * PLAN §R6c). The persona's opening ritual is the whole spec — **name the day
 * and its shape, then start. No pep talk** — so this screen is four facts and
 * one line, every one of them read off the plan. Nothing here congratulates
 * anybody for arriving, and nothing here is a number the session will not keep.
 *
 * It HOLDS, like the block gate, rather than counting itself down into the
 * warm-up. Three reasons: a ring that starts the session while someone is still
 * reading it is the confusion finding 3 already reported ("I thought it had
 * started the set"); the type here is sized to be read from across the room,
 * which is a bad fit for a screen that expires; and the person who wants none
 * of this is one tap from the warm-up, in the same place the gate's Continue
 * always is. Nothing is logged, timed or persisted until that tap.
 */
function SessionOpeningView({ plan, onLeave }: { plan: WorkoutPlan; onLeave: () => void }) {
  const dispatch = usePlayerStore((s) => s.dispatch)
  const mobility = plan.mode === 'mobility'
  const shape = sessionShape(plan)
  const summary = sessionSummary(plan)
  // The edge says the words: core hands over (movement, weight) pairs, and what
  // that is out loud — "12.5 kg", "the red band", nothing at all — is a
  // question about the exercise's resistance, answered in one place (PR #41).
  const kits = personLoads(plan).map(({ userId, loads }) => ({
    userId,
    kit: kitLine(
      loads.reduce<string[]>((labels, { exerciseId, weight }) => {
        const label = loadLabel(exercisesById.get(exerciseId), weight)
        if (!labels.includes(label)) labels.push(label)
        return labels
      }, []),
    ),
  }))
  // A mobility plan's `dayType` is a placeholder for the shared plan shape, so
  // "Full Body" would be a lie on half the sessions this screen opens. What the
  // stretches actually address is the honest name for one of those days.
  const regions = mobility ? mobilityRegions(plan) : null
  const title = mobility
    ? regions
      ? regions.charAt(0).toUpperCase() + regions.slice(1)
      : 'Mobility & relief'
    : DAY_TYPE_LABEL[plan.dayType]
  const people = plan.participantIds.length
  // A strength day always has a panel — "nothing to pick up" is news when you
  // were expecting dumbbells. A relief day only earns one if there is kit to
  // fetch, and without one the shape gets the whole width rather than sitting
  // beside a column of nothing.
  const showKit = !mobility || kits.some((k) => k.kit !== null)
  const sub = mobility
    ? `${shape.length} phases · about ${summary.minutes} min`
    : `${summary.blockCount} blocks · ${summary.setsPerPerson} sets${people > 1 ? ' each' : ''} · about ${summary.minutes} min`

  return (
    // Two columns on the laptop — the shape beside today's targets — for the
    // same reason the work screen is this wide: at this type scale, stacking
    // them put the button that starts the session below the fold, and a primary
    // action nobody can see is worse than a screen nobody reads.
    <div className="mx-auto max-w-4xl p-4 text-center">
      <p className={`${T.eyebrow} ${mobility ? 'text-emerald-500' : 'text-indigo-500'}`}>
        {mobility ? 'Mobility & relief' : 'Today'}
      </p>
      {/* The day gets the biggest words on the screen — naming it is half the
          ritual, and this is the one screen where nothing is moving yet. */}
      <h2 className={`mt-0.5 ${T.exercise}`}>{title}</h2>
      <p className={`mt-0.5 text-slate-500 dark:text-slate-400 ${T.status}`}>{sub}</p>

      <div
        className={`mt-3 grid gap-3 text-left ${showKit ? 'sm:grid-cols-[5fr_3fr] sm:items-start' : 'mx-auto max-w-xl'}`}
      >
        {/* The shape: every block in the order it runs, the warm-up and the
            stretch included — someone deciding whether they have time is
            counting those too. */}
        <ol className="space-y-1">
          {shape.map((row, i) => (
            <li
              key={`${row.name}-${i}`}
              className={`flex items-baseline justify-between gap-3 rounded-2xl border-2 px-4 py-1.5 ${
                row.finisher
                  ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <span className={`font-extrabold ${T.status}`}>
                {row.finisher ? `🔥 ${row.name}` : row.name}
              </span>
              <span className="shrink-0 text-base font-semibold text-slate-400 sm:text-lg">
                {row.meta}
              </span>
            </li>
          ))}
        </ol>

        {/* Today's targets, per person — the kit to get out before anyone
            starts. This used to be hidden on every mobility day, on the
            reasoning that a relief session has no loads and a panel of zeroes
            would be the app talking about weight on the one day it decided not
            to. PR #41 half-expired that: Activate prescribes sets on a band
            now, so a relief day CAN have kit to fetch, and hiding it meant
            finding out at the third phase. Half, because a household that owns
            no bands still gets the no-load version of the same session — so
            the rule is what there is to fetch, not which mode it is. A
            strength day keeps its panel either way: "nothing to pick up" is
            news when you were expecting dumbbells. */}
        {showKit && (
          <div className={`grid gap-3 sm:grid-cols-1 ${people > 1 ? 'grid-cols-2' : ''}`}>
            {kits.map(({ userId, kit }) => {
              const profile = profileById(userId) ?? PROFILES[0]!
              return (
                <div
                  key={userId}
                  className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <p className={`${T.person} ${profile.accent.text}`}>{profile.name}</p>
                  <p className={`mt-0.5 ${T.grab}`}>{kit ?? 'Bodyweight'}</p>
                  <p className={`font-semibold text-slate-500 dark:text-slate-400 ${T.note}`}>
                    {kit ? 'to have out' : 'nothing to pick up'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <p className={`mx-auto mt-3 max-w-2xl text-slate-500 dark:text-slate-400 ${T.cue}`}>
        {openingLine(plan.seed, plan.mode)}
      </p>

      <div className="mt-4 flex flex-col items-center">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => dispatch({ type: 'START', now: Date.now() })}
          className="w-full max-w-2xl rounded-2xl bg-indigo-600 py-5 text-3xl font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500"
        >
          {plan.blocks[0]?.kind === 'warmup' ? 'Start warm-up →' : 'Start →'}
        </motion.button>
        {/* Backing out costs nothing, and says so: the session has not begun,
            so there is no abandoned session to record. */}
        <button
          onClick={onLeave}
          className="mt-2 rounded-xl px-5 py-2 text-lg font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Not now
        </button>
      </div>
    </div>
  )
}

function CompleteView() {
  const summary = usePlayerStore((s) => s.summary)
  const reset = usePlayerStore((s) => s.reset)
  const navigate = useNavigate()
  if (!summary) return null
  const mins = Math.round(summary.durationSeconds / 60)
  return (
    <div className="mx-auto max-w-2xl p-6 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.5 }}
      >
        <div className="text-7xl">{summary.abandoned ? '💤' : '🎉'}</div>
        <h2 className="mt-3 text-3xl font-extrabold">
          {summary.abandoned ? 'Session ended' : 'Workout complete!'}
        </h2>
        <p className="mt-1 text-slate-500">{mins} min</p>
      </motion.div>
      <div className={`mt-6 grid gap-4 ${summary.people.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {summary.people.map((p, i) => {
          const profile = profileById(p.userId) ?? PROFILES[0]!
          return (
            <motion.div
              key={p.userId}
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.15 }}
              className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <p className={`text-sm font-bold tracking-wide uppercase ${profile.accent.text}`}>
                {profile.name}
              </p>
              {/* What the body did, in the biggest type on the card. XP and the
                  streak are the scoreboard and still here — they are just no
                  longer the only thing this screen says (JOURNEY act 5).
                  Bodyweight sessions have no tonnage, so they count reps; a
                  session that logged no sets at all — every mobility session,
                  and a strength session skipped to the first gate — has neither,
                  and leads with what IS true rather than a zero (Grok, PR #23). */}
              {p.reps === 0 ? (
                <>
                  <p className="mt-2 text-4xl font-extrabold">+{p.xp} XP</p>
                  {p.setsPlanned > 0 && (
                    <p className="mt-1 text-sm text-slate-500">
                      {p.setsLogged}/{p.setsPlanned} sets
                    </p>
                  )}
                </>
              ) : p.volumeKg > 0 ? (
                <>
                  <p className="mt-2 text-4xl font-extrabold tabular-nums">
                    {p.volumeKg.toLocaleString()}{' '}
                    <span className="text-lg font-bold text-slate-400">kg moved</span>
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {p.setsLogged}/{p.setsPlanned} sets · {p.reps} reps
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-4xl font-extrabold tabular-nums">
                    {p.reps} <span className="text-lg font-bold text-slate-400">reps</span>
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {p.setsLogged}/{p.setsPlanned} sets
                  </p>
                </>
              )}
              <p className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">
                {/* XP is already the hero when there was no work to report. */}
                {p.reps > 0 && <>+{p.xp} XP</>}
                {p.reps > 0 && !summary.abandoned && ' · '}
                {!summary.abandoned && <>🔥 {p.streak}-day streak</>}
              </p>
            </motion.div>
          )
        })}
      </div>
      {/* The last thing said is about the people, not the numbers — and it is
          said once a session, which is what keeps it from discounting to noise
          (JOURNEY act 5, trainer trait 6). An abandoned session gets nothing:
          "you finished it" would not be true. */}
      {!summary.abandoned && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 + summary.people.length * 0.15 }}
          className="mt-6 text-lg font-semibold text-slate-600 dark:text-slate-300"
        >
          {summary.people.length > 1
            ? 'You both showed up, and you finished it.'
            : 'You showed up, and you finished it.'}
        </motion.p>
      )}
      <button
        onClick={() => {
          reset()
          void navigate('/')
        }}
        className="mt-8 w-full max-w-sm rounded-2xl bg-indigo-600 py-3 text-lg font-extrabold text-white hover:bg-indigo-500"
      >
        Back to Today
      </button>
    </div>
  )
}

// ─── screen ──────────────────────────────────────────────────────────────────

export default function PlayerScreen() {
  const plan = usePlayerStore((s) => s.plan)
  const state = usePlayerStore((s) => s.state)
  const dispatch = usePlayerStore((s) => s.dispatch)
  const resume = usePlayerStore((s) => s.resume)
  const reset = usePlayerStore((s) => s.reset)
  const navigate = useNavigate()
  const [nowMs, setNowMs] = useState(() => Date.now())
  // Every LOG_SET path logs one row per participant, so this count is the same
  // for both people — which is what lets the cool-down state it as one number.
  const setsLogged = usePlayerStore((s) => s.setsLogged)
  const setsDoneThisSession = Math.max(0, ...Object.values(setsLogged))
  const lastBeepSecond = useRef(-1)
  const [snapshotOffered, setSnapshotOffered] = useState(false)

  const snapshot = useMemo(() => loadSnapshot(), [])

  // One scroll container for the whole session, so a screen that was scrolled
  // hands its offset to the next one — and the next one opens with its heading
  // above the fold, which is the same as not being readable at all. Only
  // reachable at 375, where these screens are taller than the viewport.
  const scroller = useRef<HTMLDivElement>(null)
  const phaseKey = `${state.phase}-${'itemIndex' in state ? state.itemIndex : ''}-${'round' in state ? state.round : ''}-${'blockIndex' in state ? state.blockIndex : ''}`
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [phaseKey])

  // Tick: render time, fire due timers, 3-2-1 countdown beeps.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      setNowMs(now)
      const s = usePlayerStore.getState().state
      // The gate has no deadline to render, but it still has to be able to
      // conclude that nobody is here — so it needs the tick too.
      if (s.phase === 'block_gate') {
        if (now >= s.pauseAt) usePlayerStore.getState().dispatch({ type: 'TIMER_FIRED', now })
      } else if ('endsAt' in s) {
        if (now >= s.endsAt) {
          usePlayerStore.getState().dispatch({ type: 'TIMER_FIRED', now })
        } else {
          const remaining = Math.ceil((s.endsAt - now) / 1000)
          if (remaining <= 3 && remaining >= 1 && remaining !== lastBeepSecond.current) {
            lastBeepSecond.current = remaining
            if (usePlayerStore.getState().soundOn) playCue('countdown')
          }
        }
      }
    }, 250)
    const onVisible = () => {
      if (document.visibilityState === 'visible')
        usePlayerStore.getState().dispatch({ type: 'TIMER_FIRED', now: Date.now() })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // No active session: offer resume of a snapshot, else bounce home.
  useEffect(() => {
    if (!plan && !snapshot) void navigate('/')
  }, [plan, snapshot, navigate])

  if (!plan) {
    if (!snapshot) return null
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <div className="text-5xl">⏸️</div>
        <h2 className="mt-3 text-2xl font-extrabold">Resume your workout?</h2>
        <p className="mt-2 text-sm text-slate-500">
          You have an unfinished session from {new Date(snapshot.startedAt).toLocaleTimeString()}.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => {
              setSnapshotOffered(true)
              resume(snapshot)
            }}
            className="rounded-2xl bg-indigo-600 py-3 font-extrabold text-white"
          >
            Resume
          </button>
          <button
            onClick={() => {
              clearSnapshot()
              void navigate('/')
            }}
            className="rounded-2xl bg-slate-100 py-3 font-bold dark:bg-slate-800"
          >
            Discard
          </button>
        </div>
      </div>
    )
  }
  void snapshotOffered

  const progress = sessionProgress(plan, state)
  const remaining = 'endsAt' in state ? Math.max(0, (state.endsAt - nowMs) / 1000) : 0
  const total = phaseTotalSeconds(plan, state)
  const soundOn = usePlayerStore.getState().soundOn

  return (
    <div className="flex h-full flex-col">
      {/* header — not on the opening, where every one of its controls is a
          no-op: there is no clock to pause and no session to abandon yet. */}
      {state.phase !== 'complete' && state.phase !== 'idle' && (
        <div className="flex items-center gap-3 border-b border-slate-200 p-3 dark:border-slate-800">
          <button
            onClick={() => {
              if (state.phase === 'paused') dispatch({ type: 'RESUME', now: Date.now() })
              else dispatch({ type: 'PAUSE', now: Date.now() })
            }}
            className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-bold dark:bg-slate-800"
          >
            {state.phase === 'paused' ? '▶ Resume' : '⏸ Pause'}
          </button>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span title={soundOn ? 'Sound on' : 'Sound unavailable'} className="text-sm">
            {soundOn ? '🔊' : '🔇'}
          </span>
          <button
            onClick={() => {
              if (confirm('End this workout? Completed sets are saved.'))
                dispatch({ type: 'ABANDON', now: Date.now() })
            }}
            className="rounded-xl px-2 py-1.5 text-sm font-bold text-slate-400 hover:text-red-500"
          >
            ✕
          </button>
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <motion.div
          key={phaseKey}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.18 }}
        >
          {state.phase === 'paused' && (
            <div className="p-16 text-center">
              <div className="text-6xl">⏸️</div>
              <h2 className="mt-4 text-2xl font-extrabold">Paused</h2>
              <p className="mt-2 text-sm text-slate-500">
                Timers are frozen. Hit Resume when ready.
              </p>
            </div>
          )}
          {state.phase === 'idle' && (
            <SessionOpeningView
              plan={plan}
              onLeave={() => {
                reset()
                void navigate('/')
              }}
            />
          )}
          {state.phase === 'timed' &&
            (() => {
              const b = plan.blocks[state.blockIndex]
              if (!b || !('items' in b) || isWorkBlock(b)) return null
              const item = b.items[state.itemIndex] as { exerciseId: string } | undefined
              const next = b.items[state.itemIndex + 1] as { exerciseId: string } | undefined
              const winding = b.kind === 'cooldown'
              const heading = b.kind === 'warmup' ? 'Warm-up' : winding ? 'Winding down' : b.label
              const afterLabel = blockNames(plan, state.blockIndex + 1)?.full ?? 'Done! 🎉'
              return (
                <TimedView
                  painAreas={sessionPainAreas(plan.participantIds)}
                  title={`${heading} · ${state.itemIndex + 1} of ${b.items.length}`}
                  ending={
                    winding
                      ? {
                          line: workDoneLine(plan, setsDoneThisSession),
                          lastOne: state.itemIndex === b.items.length - 1,
                        }
                      : undefined
                  }
                  exercise={item ? exercisesById.get(item.exerciseId) : undefined}
                  remaining={remaining}
                  total={total}
                  nextLabel={next ? (exercisesById.get(next.exerciseId)?.name ?? null) : afterLabel}
                  focusCue={
                    b.kind === 'mobility' && item
                      ? exercisesById.get(item.exerciseId)?.mobility?.focusCue
                      : undefined
                  }
                  onSkip={() => dispatch({ type: 'SKIP', now: Date.now() })}
                />
              )
            })()}
          {state.phase === 'work' && <WorkView plan={plan} state={state} remaining={remaining} />}
          {state.phase === 'changeover' && (
            <ChangeoverView plan={plan} state={state} remaining={remaining} />
          )}
          {state.phase === 'rest' && <RestView plan={plan} state={state} remaining={remaining} />}
          {state.phase === 'block_transition' && (
            <BlockTransitionView plan={plan} state={state} remaining={remaining} />
          )}
          {state.phase === 'block_gate' && <BlockGateView plan={plan} state={state} />}
          {state.phase === 'complete' && <CompleteView />}
        </motion.div>
      </div>
    </div>
  )
}

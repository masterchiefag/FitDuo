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
import { lastTimeNews, movedUp } from '../../core/player/lastTime'
import type {
  Block,
  LastPerformance,
  PersonTarget,
  WorkItem,
  WorkoutPlan,
} from '../../core/generator/types'
import type { Overrides, PlayerState } from '../../core/player/types'
import type { Exercise } from '../../core/catalog/types'

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtWeight = (w: number) => (w === 0 ? 'bodyweight' : `${w} kg`)
const holdSeconds = (ex: Exercise) => (ex.repRange[1] === 1 ? ex.secondsPerRep : null)
/** The one thing to do before a set starts: pick up the right bell. */
const grabLabel = (t: PersonTarget) => (t.weight === 0 ? 'Bodyweight' : `Grab ${t.weight} kg`)
const lastTimeLabel = (last: LastPerformance) =>
  last.weight === 0 ? `${last.reps} reps` : `${last.weight} kg × ${last.reps}`

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
      const item = b && (b.kind === 'superset' || b.kind === 'circuit') ? b.items[state.itemIndex] : undefined
      return item?.workSeconds ?? 1
    }
    case 'changeover':
      return CHANGEOVER_SECONDS
    case 'rest': {
      const b = plan.blocks[state.blockIndex]
      return b && (b.kind === 'superset' || b.kind === 'circuit') ? b.restSeconds : 1
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
  const blocks = plan.blocks.filter((b) => b.kind === 'superset' || b.kind === 'circuit').length
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return `That's the work done — ${plural(blocks, 'block')}, ${plural(setsDone, 'set')}.`
}

/** Linear progress through the whole session, 0..1. */
function sessionProgress(plan: WorkoutPlan, state: PlayerState): number {
  const steps: number[] = plan.blocks.map((b) =>
    b.kind === 'superset' || b.kind === 'circuit' ? b.rounds * b.items.length : b.items.length,
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

// ─── shared pieces ───────────────────────────────────────────────────────────

function ExerciseMedia({ ex, size = 'large' }: { ex: Exercise; size?: 'large' | 'small' }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 1100)
    return () => clearInterval(t)
  }, [])
  const img = (
    <img
      src={ex.media.images[frame]}
      alt={ex.name}
      className={
        size === 'large'
          ? 'mx-auto max-h-64 w-full rounded-2xl bg-white object-contain sm:max-h-80'
          : 'h-16 w-20 rounded-lg bg-white object-contain'
      }
    />
  )
  // The demo frames come from a gym dataset, so the picture can show a bench we
  // do not ask for. Say so right under it, or the photo quietly overrides the cues.
  if (size === 'small' || !ex.setupNote) return img
  return (
    <>
      {img}
      <p className="mx-auto mt-2 max-w-md text-xs text-slate-500 italic dark:text-slate-400">
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
    <div className={`relative mx-auto ${size === 'xl' ? 'h-52 w-52' : 'h-40 w-40'}`}>
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
          className={`font-extrabold tabular-nums ${size === 'xl' ? 'text-6xl' : 'text-4xl'}`}
        >
          {Math.ceil(remaining)}
        </span>
        {caption && (
          <span className="mt-0.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
            {caption}
          </span>
        )}
      </div>
    </div>
  )
}

function Cues({ ex }: { ex: Exercise }) {
  return (
    <ul className="mx-auto mt-3 max-w-md space-y-1 text-sm text-slate-500 dark:text-slate-400">
      {ex.media.instructions.map((c) => (
        <li key={c}>• {c}</li>
      ))}
    </ul>
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
  ending,
  onSkip,
}: {
  title: string
  exercise: Exercise | undefined
  remaining: number
  total: number
  nextLabel: string | null
  focusCue?: string | undefined
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
      <p
        className={`text-sm font-bold tracking-widest uppercase ${ending ? 'text-slate-400' : 'text-indigo-500'}`}
      >
        {title}
      </p>
      {ending && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{ending.line}</p>}
      <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{exercise?.name ?? '—'}</h2>
      {exercise && (
        <div className="mt-4">
          <ExerciseMedia ex={exercise} />
        </div>
      )}
      <div className="mt-4">
        <RingTimer remaining={remaining} total={total} tone={ending ? 'wind_down' : 'work'} />
      </div>
      {focusCue && (
        <p className="mx-auto mt-3 max-w-md rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {focusCue}
        </p>
      )}
      {exercise && <Cues ex={exercise} />}
      {ending?.lastOne ? (
        <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Last one — take it slow.
        </p>
      ) : (
        nextLabel && (
          <p className="mt-4 text-sm text-slate-500">
            Next up: <span className="font-semibold">{nextLabel}</span>
          </p>
        )
      )}
      <button
        onClick={onSkip}
        className="mt-4 rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
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
  const rounds = block.kind === 'superset' || block.kind === 'circuit' ? block.rounds : null
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
            <span className="pr-1 text-sm font-semibold">{ex?.name ?? item.exerciseId}</span>
          </div>
        )
      })}
      {rounds !== null && (
        <span className="text-xs font-semibold text-slate-400">
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
  target,
  last,
  hold,
  tone,
}: {
  userId: string
  target: PersonTarget
  last: LastPerformance | undefined
  /** Timed holds have no reps to compare — "last time 1 rep" is not a fact. */
  hold: number | null
  tone: 'ready' | 'rest'
}) {
  const profile = profileById(userId) ?? PROFILES[0]!
  const news = hold ? null : lastTimeNews(target, last)
  const up = news ? movedUp(target, news) : false
  return (
    <div
      className={
        tone === 'ready'
          ? 'rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950'
          : 'rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950'
      }
    >
      <p className={`text-xs font-bold uppercase ${profile.accent.text}`}>{profile.name}</p>
      <p className="mt-0.5 text-lg font-extrabold">{grabLabel(target)}</p>
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        {hold ? `${hold}s hold` : `${target.targetReps} reps`}
      </p>
      {/* The prize for good work is better work: today's number beside the one
          it beat. A lighter day still says it — that is the app answering a
          "too hard" tap — but without the colour that would celebrate it. */}
      {news && (
        <p
          className={`mt-1 text-xs font-semibold ${up ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}
        >
          Last time {lastTimeLabel(news)}
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
            <p className={`text-xs font-bold tracking-wide uppercase ${profile.accent.text}`}>
              {profile.name}
            </p>
            {hold ? (
              <p className="mt-1 text-2xl font-extrabold">
                {hold}s <span className="text-base font-semibold text-slate-400">hold</span>
              </p>
            ) : (
              <>
                <div className="mt-1 flex items-baseline justify-between">
                  <p className="text-2xl font-extrabold tabular-nums">
                    {reps} <span className="text-sm font-semibold text-slate-400">reps</span>
                  </p>
                  <div className={`flex gap-1 ${onAdjust ? '' : 'hidden'}`}>
                    <button
                      onClick={() => onAdjust?.(userId, 'targetReps', -1)}
                      className="h-7 w-7 rounded-lg bg-slate-100 text-sm font-bold dark:bg-slate-800"
                    >
                      −
                    </button>
                    <button
                      onClick={() => onAdjust?.(userId, 'targetReps', 1)}
                      className="h-7 w-7 rounded-lg bg-slate-100 text-sm font-bold dark:bg-slate-800"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <p className="text-lg font-bold text-slate-600 dark:text-slate-300">
                    {fmtWeight(weight)}
                  </p>
                  {target.weight > 0 && onAdjust && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => onAdjust(userId, 'weight', -2.5)}
                        className="h-7 w-7 rounded-lg bg-slate-100 text-sm font-bold dark:bg-slate-800"
                      >
                        −
                      </button>
                      <button
                        onClick={() => onAdjust(userId, 'weight', 2.5)}
                        className="h-7 w-7 rounded-lg bg-slate-100 text-sm font-bold dark:bg-slate-800"
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
  const block = plan.blocks[state.blockIndex] as Extract<Block, { kind: 'superset' | 'circuit' }>
  const item = block.items[state.itemIndex]!
  const ex = exercisesById.get(item.exerciseId)
  // Adjustments live in the reducer, not here: the set can end on its own
  // timer, and a correction held in component state would be lost exactly then.
  const overrides = state.overrides ?? {}

  const nextItem = block.items[state.itemIndex + 1]
  const nextEx = nextItem ? exercisesById.get(nextItem.exerciseId) : null

  const adjust = (userId: string, field: 'targetReps' | 'weight', delta: number) => {
    const target = item.perPerson[userId]!
    const current = overrides[userId]?.[field] ?? target[field]
    dispatch({
      type: 'ADJUST',
      now: Date.now(),
      userId,
      target: { [field]: Math.max(field === 'weight' ? 0 : 1, current + delta) },
    })
  }

  // The last work block of every session that has one, resting 60s where the
  // strength blocks rest 75: the generator already built a climax and the
  // player rendered it in the same indigo pill as block one. Marked by KIND,
  // never by its round count — that varies day to day (JOURNEY Part 5).
  const isFinisher = block.kind === 'circuit'

  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <div
        className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 ${isFinisher ? 'bg-rose-600' : 'bg-indigo-600'}`}
      >
        <span className="text-sm font-extrabold tracking-widest text-white uppercase">
          {isFinisher ? '🔥 ' : 'Go — '}
          {block.label} · Round {state.round + 1}/{block.rounds}
        </span>
      </div>
      {/* Orientation, not encouragement: nothing motivational belongs inside a
          set (JOURNEY principle 3). Where you are is instruction. */}
      {isFinisher && (
        <p className="mt-1 text-xs font-bold tracking-widest text-rose-500 uppercase">
          Last block of the session
        </p>
      )}
      <h2 className="mt-2 text-3xl font-extrabold tracking-tight">{ex?.name ?? item.exerciseId}</h2>
      <div className="mt-3 grid items-center gap-3 sm:grid-cols-[1fr_auto]">
        <div>{ex && <ExerciseMedia ex={ex} />}</div>
        <RingTimer
          remaining={remaining}
          total={item.workSeconds}
          tone="work"
          caption="left in set"
          size="xl"
        />
      </div>
      <div className="mt-4">
        <TargetPanel item={item} overrides={overrides} onAdjust={adjust} />
      </div>
      {ex && <Cues ex={ex} />}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => dispatch({ type: 'SET_DONE', now: Date.now() })}
        className="mt-5 w-full max-w-xl rounded-2xl bg-indigo-600 py-4 text-xl font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500"
      >
        Done ✓
      </motion.button>
      <div className="mt-3 flex items-center justify-center gap-4 text-sm text-slate-500">
        {/* The set ends on its own, so "we need longer" has to be one tap and
            not Pause — which nobody reaches for mid-rep. */}
        <button
          onClick={() => dispatch({ type: 'EXTEND', now: Date.now(), seconds: 15 })}
          className="rounded-lg px-2 py-1 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
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
          className="rounded-lg px-2 py-1 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
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
  const block = plan.blocks[state.blockIndex] as Extract<Block, { kind: 'superset' | 'circuit' }>
  const next = block.items[state.nextItemIndex]
  const nextEx = next ? exercisesById.get(next.exerciseId) : null
  const hold = nextEx ? holdSeconds(nextEx) : null
  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 dark:bg-amber-950">
        <span className="text-lg">🔄</span>
        <span className="text-sm font-extrabold tracking-widest text-amber-700 uppercase dark:text-amber-300">
          Get ready
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-500">Coming up</p>
      <h2 className="text-3xl font-extrabold tracking-tight">{nextEx?.name ?? 'Next up'}</h2>

      {/* The one thing to DO right now: pick up the right weight. */}
      {next && (
        <div className="mx-auto mt-3 flex flex-wrap items-center justify-center gap-2 text-left">
          {Object.entries(next.perPerson).map(([userId, target]) => (
            <NextTargetCard
              key={userId}
              userId={userId}
              target={target}
              last={next.lastTime?.[userId]}
              hold={hold}
              tone="ready"
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
      {nextEx && (
        <div className="mt-3">
          <ExerciseMedia ex={nextEx} />
        </div>
      )}
      <button
        onClick={() => dispatch({ type: 'SKIP', now: Date.now() })}
        className="mt-4 rounded-xl bg-amber-500 px-5 py-2 text-sm font-extrabold text-white hover:bg-amber-400"
      >
        I&rsquo;m ready →
      </button>
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
  const block = plan.blocks[state.blockIndex] as Extract<Block, { kind: 'superset' | 'circuit' }>
  const next = block.items[state.nextItemIndex]
  const nextEx = next ? exercisesById.get(next.exerciseId) : null
  const hold = nextEx ? holdSeconds(nextEx) : null
  // Structural, from the plan — not from sets logged, which a SKIP makes drift.
  const position = sessionPosition(plan, state)
  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p className="text-sm font-bold tracking-widest text-emerald-500 uppercase">Rest</p>
      {position && (
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Block {position.blockNumber} of {position.blockCount} · {position.setsToGo} set
          {position.setsToGo === 1 ? '' : 's'} to go
        </p>
      )}
      <div className="mt-5">
        <RingTimer
          remaining={remaining}
          total={block.restSeconds}
          tone="rest"
          caption="rest"
        />
      </div>
      {nextEx && next && (
        <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-slate-200 bg-white p-3 text-left dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <ExerciseMedia ex={nextEx} size="small" />
            <div>
              <p className="text-xs text-slate-400">
                Next · Round {state.round + 1}/{block.rounds}
              </p>
              <p className="font-bold">{nextEx.name}</p>
              {/* Rest is exactly when you get set up, so the note has to be here
                  too — the thumbnail beside it is the misleading gym frame. */}
              {nextEx.setupNote && (
                <p className="mt-0.5 text-xs text-slate-500 italic dark:text-slate-400">
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
                target={target}
                last={next.lastTime?.[userId]}
                hold={hold}
                tone="rest"
              />
            ))}
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-center gap-3">
        <button
          onClick={() => dispatch({ type: 'EXTEND', now: Date.now(), seconds: 15 })}
          className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold dark:bg-slate-800"
        >
          +15s
        </button>
        <button
          onClick={() => dispatch({ type: 'SKIP', now: Date.now() })}
          className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold dark:bg-slate-800"
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
  const nextLabel = !nextBlock
    ? 'Finish'
    : nextBlock.kind === 'cooldown'
      ? 'Cool-down stretch'
      : nextBlock.kind === 'warmup'
        ? 'Warm-up'
        : nextBlock.label

  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p className="text-sm font-bold tracking-widest text-indigo-500 uppercase">Get ready</p>
      <h2 className="mt-1 text-2xl font-extrabold">Up next: {nextLabel}</h2>
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
        className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold dark:bg-slate-800"
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
  const done = block && (block.kind === 'superset' || block.kind === 'circuit') ? block : null
  const nextBlock = plan.blocks[state.nextBlockIndex]
  const nextLabel = !nextBlock
    ? 'Finish'
    : nextBlock.kind === 'cooldown'
      ? 'Cool-down stretch'
      : nextBlock.kind === 'warmup'
        ? 'Warm-up'
        : nextBlock.label
  // Act 4 has two beats and they sit on different gates: this screen announces
  // the peak that is coming, and the peak's own gate says it happened.
  const finisherNext = nextBlock?.kind === 'circuit'
  const finisherDone = done?.kind === 'circuit'

  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p
        className={`text-sm font-bold tracking-widest uppercase ${finisherDone ? 'text-rose-500' : 'text-emerald-500'}`}
      >
        {finisherDone ? '🔥 Finisher done' : `${done?.label ?? 'Block'} done! 🎉`}
      </p>
      <h2 className="mt-1 text-2xl font-extrabold">Up next: {nextLabel}</h2>
      {/* Framing, never a control — the ratings below are what keep progression
          alive and are the only required tap in the hour (JOURNEY Part 5). */}
      {finisherNext && (
        <p className="mt-1 text-sm font-bold text-rose-500">🔥 Last block — the Finisher.</p>
      )}
      {finisherDone && (
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
          That was the peak. The hard work is done.
        </p>
      )}
      <NextUpPreview block={nextBlock} />
      {done && (
        <div className="mx-auto mt-5 max-w-xl space-y-3 text-left">
          <p className="text-center text-sm font-semibold text-slate-500">
            How was that? (optional — Continue means “just right”)
          </p>
          {done.items.map((item) => {
            const ex = exercisesById.get(item.exerciseId)
            return (
              <div
                key={item.exerciseId}
                className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <p className="font-bold">{ex?.name ?? item.exerciseId}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {Object.keys(item.perPerson).map((userId) => {
                    const profile = profileById(userId) ?? PROFILES[0]!
                    const chosen = state.ratings[`${userId}:${item.exerciseId}`]
                    return (
                      <div key={userId} className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-bold uppercase ${profile.accent.text}`}>
                          {profile.name}
                        </span>
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
                              className={`rounded-lg px-2 py-1 text-lg transition-transform ${chosen === r.rating ? 'scale-110 bg-indigo-100 dark:bg-indigo-950' : 'opacity-60 hover:opacity-100'}`}
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
        className="mt-5 w-full max-w-xl rounded-2xl bg-indigo-600 py-4 text-xl font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500"
      >
        Continue →
      </motion.button>
      {/* Ending here is a completion, not an abandon: the rest was never
          programmed, so it does not count against them. */}
      <button
        onClick={() => dispatch({ type: 'FINISH_EARLY', now: Date.now() })}
        className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        Finish here
      </button>
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
  const navigate = useNavigate()
  const [nowMs, setNowMs] = useState(() => Date.now())
  // Every LOG_SET path logs one row per participant, so this count is the same
  // for both people — which is what lets the cool-down state it as one number.
  const setsLogged = usePlayerStore((s) => s.setsLogged)
  const setsDoneThisSession = Math.max(0, ...Object.values(setsLogged))
  const lastBeepSecond = useRef(-1)
  const [snapshotOffered, setSnapshotOffered] = useState(false)

  const snapshot = useMemo(() => loadSnapshot(), [])

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
      {/* header */}
      {state.phase !== 'complete' && (
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <motion.div
          key={`${state.phase}-${'itemIndex' in state ? state.itemIndex : ''}-${'round' in state ? state.round : ''}-${'blockIndex' in state ? state.blockIndex : ''}`}
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
          {state.phase === 'timed' &&
            (() => {
              const b = plan.blocks[state.blockIndex]
              if (!b || !('items' in b) || b.kind === 'superset' || b.kind === 'circuit')
                return null
              const item = b.items[state.itemIndex] as { exerciseId: string } | undefined
              const next = b.items[state.itemIndex + 1] as { exerciseId: string } | undefined
              const winding = b.kind === 'cooldown'
              const heading = b.kind === 'warmup' ? 'Warm-up' : winding ? 'Winding down' : b.label
              const nextBlock = plan.blocks[state.blockIndex + 1]
              const afterLabel = !nextBlock
                ? 'Done! 🎉'
                : nextBlock.kind === 'cooldown'
                  ? 'Cool-down'
                  : nextBlock.kind === 'mobility'
                    ? nextBlock.label
                    : 'Strength blocks'
              return (
                <TimedView
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
          {state.phase === 'work' && (
            <WorkView plan={plan} state={state} remaining={remaining} />
          )}
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

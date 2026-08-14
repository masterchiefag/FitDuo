import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { usePlayerStore } from '../stores/playerStore'
import { exercisesById } from '../lib/catalog'
import { PROFILES, profileById } from '../lib/profiles'
import { loadSnapshot, clearSnapshot } from '../../infra/localstore'
import { playCue } from '../../infra/audio'
import type { Block, WorkItem, WorkoutPlan } from '../../core/generator/types'
import type { PlayerState } from '../../core/player/types'
import type { Exercise } from '../../core/catalog/types'

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtWeight = (w: number) => (w === 0 ? 'bodyweight' : `${w} kg`)
const holdSeconds = (ex: Exercise) => (ex.repRange[1] === 1 ? ex.secondsPerRep : null)

function phaseTotalSeconds(plan: WorkoutPlan, state: PlayerState): number {
  switch (state.phase) {
    case 'timed': {
      const b = plan.blocks[state.blockIndex]
      return b && 'items' in b && 'seconds' in (b.items[state.itemIndex] ?? {})
        ? ((b.items[state.itemIndex] as { seconds: number }).seconds ?? 1)
        : 1
    }
    case 'rest': {
      const b = plan.blocks[state.blockIndex]
      return b && (b.kind === 'superset' || b.kind === 'circuit') ? b.restSeconds : 1
    }
    case 'block_transition':
      return 20
    default:
      return 1
  }
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
    case 'rest': {
      const b = plan.blocks[s.blockIndex]
      const items = b && 'items' in b ? b.items.length : 1
      return (before(s.blockIndex) + s.round * items) / total
    }
    case 'block_transition':
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

function RingTimer({ remaining, total }: { remaining: number; total: number }) {
  const r = 64
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, remaining / Math.max(1, total)))
  return (
    <div className="relative mx-auto h-40 w-40">
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
          className="fill-none stroke-indigo-500 transition-[stroke-dashoffset] duration-200"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-4xl font-extrabold tabular-nums">
        {Math.ceil(remaining)}
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
  onSkip,
}: {
  title: string
  exercise: Exercise | undefined
  remaining: number
  total: number
  nextLabel: string | null
  focusCue?: string | undefined
  onSkip: () => void
}) {
  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p className="text-sm font-bold tracking-widest text-indigo-500 uppercase">{title}</p>
      <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{exercise?.name ?? '—'}</h2>
      {exercise && (
        <div className="mt-4">
          <ExerciseMedia ex={exercise} />
        </div>
      )}
      <div className="mt-4">
        <RingTimer remaining={remaining} total={total} />
      </div>
      {focusCue && (
        <p className="mx-auto mt-3 max-w-md rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {focusCue}
        </p>
      )}
      {exercise && <Cues ex={exercise} />}
      {nextLabel && (
        <p className="mt-4 text-sm text-slate-500">
          Next up: <span className="font-semibold">{nextLabel}</span>
        </p>
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

function TargetPanel({
  item,
  overrides,
  onAdjust,
}: {
  item: WorkItem
  overrides: Record<string, { targetReps?: number; weight?: number }>
  onAdjust: (userId: string, field: 'targetReps' | 'weight', delta: number) => void
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
                  <div className="flex gap-1">
                    <button
                      onClick={() => onAdjust(userId, 'targetReps', -1)}
                      className="h-7 w-7 rounded-lg bg-slate-100 text-sm font-bold dark:bg-slate-800"
                    >
                      −
                    </button>
                    <button
                      onClick={() => onAdjust(userId, 'targetReps', 1)}
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
                  {target.weight > 0 && (
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
}: {
  plan: WorkoutPlan
  state: Extract<PlayerState, { phase: 'work' }>
}) {
  const dispatch = usePlayerStore((s) => s.dispatch)
  const block = plan.blocks[state.blockIndex] as Extract<Block, { kind: 'superset' | 'circuit' }>
  const item = block.items[state.itemIndex]!
  const ex = exercisesById.get(item.exerciseId)
  const [overrides, setOverrides] = useState<
    Record<string, { targetReps?: number; weight?: number }>
  >({})
  // Reset adjustments when the exercise/set changes.
  const key = `${state.blockIndex}:${state.round}:${state.itemIndex}`
  const lastKey = useRef(key)
  if (lastKey.current !== key) {
    lastKey.current = key
    if (Object.keys(overrides).length > 0) setOverrides({})
  }

  const nextItem = block.items[state.itemIndex + 1]
  const nextEx = nextItem ? exercisesById.get(nextItem.exerciseId) : null

  const adjust = (userId: string, field: 'targetReps' | 'weight', delta: number) => {
    setOverrides((o) => {
      const target = item.perPerson[userId]!
      const cur = {
        targetReps: o[userId]?.targetReps ?? target.targetReps,
        weight: o[userId]?.weight ?? target.weight,
      }
      const next = {
        ...cur,
        [field]: Math.max(field === 'weight' ? 0 : 1, cur[field] + delta),
      }
      return { ...o, [userId]: next }
    })
  }

  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p className="text-sm font-bold tracking-widest text-indigo-500 uppercase">
        {block.label} · Round {state.round + 1}/{block.rounds}
      </p>
      <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{ex?.name ?? item.exerciseId}</h2>
      {ex && (
        <div className="mt-3">
          <ExerciseMedia ex={ex} />
        </div>
      )}
      <div className="mt-4">
        <TargetPanel item={item} overrides={overrides} onAdjust={adjust} />
      </div>
      {ex && <Cues ex={ex} />}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() =>
          dispatch({
            type: 'SET_DONE',
            now: Date.now(),
            overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
          })
        }
        className="mt-5 w-full max-w-xl rounded-2xl bg-indigo-600 py-4 text-xl font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500"
      >
        Done ✓
      </motion.button>
      <div className="mt-3 flex items-center justify-center gap-4 text-sm text-slate-500">
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
  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p className="text-sm font-bold tracking-widest text-emerald-500 uppercase">Rest</p>
      <div className="mt-6">
        <RingTimer remaining={remaining} total={block.restSeconds} />
      </div>
      {nextEx && (
        <div className="mx-auto mt-6 flex max-w-sm items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left dark:border-slate-800 dark:bg-slate-900">
          <ExerciseMedia ex={nextEx} size="small" />
          <div>
            <p className="text-xs text-slate-400">
              Next · Round {state.round + 1}/{block.rounds}
            </p>
            <p className="font-bold">{nextEx.name}</p>
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-center gap-3">
        <button
          onClick={() => dispatch({ type: 'EXTEND_REST', now: Date.now(), seconds: 15 })}
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
  const feedbackGiven = usePlayerStore((s) => s.feedbackGiven)
  const prevBlock = plan.blocks[state.nextBlockIndex - 1]
  const nextBlock = plan.blocks[state.nextBlockIndex]
  const prevWork =
    prevBlock && (prevBlock.kind === 'superset' || prevBlock.kind === 'circuit') ? prevBlock : null
  const nextLabel = !nextBlock
    ? 'Finish'
    : nextBlock.kind === 'cooldown'
      ? 'Cool-down stretch'
      : nextBlock.kind === 'warmup'
        ? 'Warm-up'
        : nextBlock.label

  return (
    <div className="mx-auto max-w-2xl p-4 text-center">
      <p className="text-sm font-bold tracking-widest text-indigo-500 uppercase">
        {prevWork ? 'Block done! 🎉' : 'Get ready'}
      </p>
      <h2 className="mt-1 text-2xl font-extrabold">Up next: {nextLabel}</h2>
      <div className="mt-4">
        <RingTimer remaining={remaining} total={20} />
      </div>
      {prevWork && (
        <div className="mx-auto mt-4 max-w-xl space-y-3 text-left">
          <p className="text-center text-sm font-semibold text-slate-500">How was that block?</p>
          {prevWork.items.map((item) => {
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
                    const chosen = feedbackGiven[`${userId}:${item.exerciseId}`]
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
      <button
        onClick={() => dispatch({ type: 'SKIP', now: Date.now() })}
        className="mt-4 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold dark:bg-slate-800"
      >
        Start now →
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
              <p className="mt-2 text-4xl font-extrabold">+{p.xp} XP</p>
              <p className="mt-1 text-sm text-slate-500">
                {p.setsLogged}/{p.setsPlanned} sets
              </p>
              {!summary.abandoned && (
                <p className="mt-2 text-lg font-bold">🔥 {p.streak}-day streak</p>
              )}
            </motion.div>
          )
        })}
      </div>
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
  const lastBeepSecond = useRef(-1)
  const [snapshotOffered, setSnapshotOffered] = useState(false)

  const snapshot = useMemo(() => loadSnapshot(), [])

  // Tick: render time, fire due timers, 3-2-1 countdown beeps.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      setNowMs(now)
      const s = usePlayerStore.getState().state
      if ('endsAt' in s) {
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
              const heading =
                b.kind === 'warmup' ? 'Warm-up' : b.kind === 'cooldown' ? 'Cool-down' : b.label
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
                  title={`${heading} · ${state.itemIndex + 1}/${b.items.length}`}
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
          {state.phase === 'work' && <WorkView plan={plan} state={state} />}
          {state.phase === 'rest' && <RestView plan={plan} state={state} remaining={remaining} />}
          {state.phase === 'block_transition' && (
            <BlockTransitionView plan={plan} state={state} remaining={remaining} />
          )}
          {state.phase === 'complete' && <CompleteView />}
        </motion.div>
      </div>
    </div>
  )
}

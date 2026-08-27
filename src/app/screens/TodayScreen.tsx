import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { usePlayerStore } from '../stores/playerStore'
import { exercisesById } from '../lib/catalog'
import { PROFILES, USING_EXAMPLE_PROFILES } from '../lib/profiles'
import {
  DAY_TYPE_LABEL,
  DEFAULT_STRENGTH_MINUTES,
  PATTERN_LABEL,
  STRENGTH_DURATIONS,
  mobilityPlan,
  tryPlanForToday,
  statsFor,
} from '../lib/planner'
import { localDateISO } from '../../core/dates'
import { loadSnapshot, clearSnapshot } from '../../infra/localstore'
import { isWorkBlock } from '../../core/player/position'
import { areaLabel } from '../lib/cautions'
import {
  DEFAULT_MOBILITY_MINUTES,
  MOBILITY_DURATIONS,
  MOBILITY_FOCUS,
  type MobilityFocus,
} from '../../core/generator/mobility'

export default function TodayScreen() {
  const navigate = useNavigate()
  const start = usePlayerStore((s) => s.start)
  const resumeSession = usePlayerStore((s) => s.resume)
  const todayISO = localDateISO(Date.now())

  // Being on Today means no session is running. The opening holds a loaded
  // plan in `idle` and writes nothing, so leaving it by the nav — which on the
  // laptop is a permanent sidebar, far more reachable than "Not now" — used to
  // strand that plan in the store: it kept the wake lock, and it shadowed the
  // snapshot the banner below was offering, so Resume re-opened the new day's
  // opening and the unfinished session became unreachable (Grok, PR #40).
  // Idempotent, which is what StrictMode's double mount needs.
  useEffect(() => {
    const player = usePlayerStore.getState()
    if (player.plan && player.state.phase === 'idle') player.reset()
  }, [])

  const everyone = useMemo(() => PROFILES.map((p) => p.id), [])
  // Closing the lid mid-session is the normal way sessions end now (the
  // late-timer rule pauses rather than fast-forwards). Reopening lands here,
  // not on /workout, so the unfinished session has to be offered HERE or it is
  // silently discarded by the next Start.
  const [snapshot, setSnapshot] = useState(() => loadSnapshot())
  // A kit with no candidates for some movement pattern is a real answer, not a
  // crash — the generator throws, and this screen renders during load, so an
  // unguarded call turns a thin equipment list into a blank home screen.
  //
  // Solo is checked separately on purpose: a duo movement must suit BOTH kits,
  // so the duo pool is the smaller one. One person owning nothing must not take
  // the other person's workout away.
  // How long they have today. A short session is the same generated workout at
  // a smaller budget — full streak credit, proportionally less XP — and it is
  // the difference between training and breaking the streak on a bad day.
  const [minutes, setMinutes] = useState<number>(DEFAULT_STRENGTH_MINUTES)
  const duoAttempt = useMemo(() => tryPlanForToday(everyone, minutes), [everyone, minutes])
  const previewPlan = duoAttempt.ok ? duoAttempt.plan : null
  const soloAvailable = useMemo(
    () => new Set(PROFILES.filter((p) => tryPlanForToday([p.id], minutes).ok).map((p) => p.id)),
    [minutes],
  )
  const canStartSomething = previewPlan !== null || soloAvailable.size > 0
  const stats = useMemo(() => PROFILES.map((p) => ({ profile: p, s: statsFor(p.id) })), [])

  const mainExercises = (previewPlan?.blocks ?? [])
    .flatMap((b) => (isWorkBlock(b) ? b.items : []))
    .map((i) => exercisesById.get(i.exerciseId)?.name ?? i.exerciseId)
  const mins = Math.round((previewPlan?.estimatedSeconds ?? 0) / 60)
  const blockCount = (previewPlan?.blocks ?? []).filter(isWorkBlock).length

  // Default to everyone, like the strength card — tapping a focus starts
  // immediately, so a solo default silently drops the partner's credit.
  const [mobilityWho, setMobilityWho] = useState<string[]>(PROFILES.map((p) => p.id))
  const [mobilityMinutes, setMobilityMinutes] = useState<number>(DEFAULT_MOBILITY_MINUTES)

  // Generating three plans on every render just to label the cards is waste.
  const mobilityMins = useMemo(() => {
    const out = {} as Record<MobilityFocus, number>
    for (const focus of Object.keys(MOBILITY_FOCUS) as MobilityFocus[]) {
      out[focus] = Math.round(
        mobilityPlan(focus, mobilityWho, mobilityMinutes).estimatedSeconds / 60,
      )
    }
    return out
  }, [mobilityWho, mobilityMinutes])

  const beginMobility = (focus: MobilityFocus) => {
    start(mobilityPlan(focus, mobilityWho, mobilityMinutes))
    void navigate('/workout')
  }

  const begin = (participantIds: string[]) => {
    // Only rendered for combinations already known to generate, but the button
    // and the check are separate reads of the same profiles — re-check rather
    // than throw out of an onClick.
    const attempt = tryPlanForToday(participantIds, minutes)
    if (!attempt.ok) return
    start(attempt.plan)
    void navigate('/workout')
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Today</h1>
      <p className="text-sm text-slate-500">
        {new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </p>

      {USING_EXAMPLE_PROFILES && (
        <div className="mt-5 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-800 dark:bg-rose-950">
          <p className="font-bold">Example profiles — not your data</p>
          <p className="mt-0.5 text-slate-600 dark:text-slate-300">
            These names and weights are placeholders, so the loads below are not yours. Real
            profiles arrive with accounts (M4). Until then use <code>npm run dev</code>.
          </p>
        </div>
      )}

      {/* A flag must never apply silently. Without this the only evidence is a
          number one rung lower than last week, which reads as the app being
          wrong rather than the app doing what it was told (PLAN §R5). No
          countdown yet: `painAreas` is a profile field, not the renewable
          10-day event R5 specifies, so there is no honest number of days to
          show and inventing one would be worse than the banner's absence. */}
      {PROFILES.filter((p) => p.painAreas.length > 0).map((p) => (
        <div
          key={p.id}
          className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
        >
          <span className="text-2xl">🩹</span>
          <div className="min-w-40 flex-1">
            <p className="font-bold">
              Going lighter on {p.name}&rsquo;s {p.painAreas.map(areaLabel).join(' and ')} work
            </p>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
              Same movements, same session: {p.name}&rsquo;s targets drop on the ones that load it —
              reps to the bottom of the range, and a rung off the bell where the movement loads it
              hard. Nobody else&rsquo;s targets change. Clear it in <code>profiles.local.json</code>{' '}
              when it stops hurting.
            </p>
          </div>
        </div>
      ))}

      {snapshot && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <span className="text-2xl">⏸️</span>
          <div className="min-w-40 flex-1">
            <p className="font-bold">Unfinished session</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Paused at {new Date(snapshot.savedAt).toLocaleTimeString()} — starting something new
              will discard it.
            </p>
          </div>
          {/* Apply the snapshot here rather than navigating and hoping the
              player picks it up: this button names a specific session, so it
              must be the one that opens, whatever the store happens to hold. */}
          <button
            onClick={() => {
              resumeSession(snapshot)
              void navigate('/workout')
            }}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-extrabold text-white hover:bg-amber-400"
          >
            Resume
          </button>
          <button
            onClick={() => {
              clearSnapshot()
              setSnapshot(null)
            }}
            className="rounded-xl px-3 py-2 text-sm font-bold text-slate-500 hover:bg-amber-100 dark:hover:bg-amber-900"
          >
            Discard
          </button>
        </div>
      )}

      {/* Workout card */}
      {!canStartSomething ? (
        <div className="mt-5 rounded-3xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="text-lg font-extrabold">Not enough kit for a full session</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            A strength session needs candidates for every movement pattern, and nothing anyone here
            owns fits the{' '}
            <strong>{duoAttempt.ok ? '' : PATTERN_LABEL[duoAttempt.thinPattern]}</strong> slot.
            Check your kit in Settings — mobility sessions below still work with nothing at all.
          </p>
          <button
            onClick={() => void navigate('/settings')}
            className="mt-3 rounded-2xl bg-amber-500 px-4 py-2 text-sm font-extrabold text-white hover:bg-amber-400"
          >
            Check your kit
          </button>
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-5 text-white">
            <p className="text-xs font-bold tracking-widest uppercase opacity-80">
              {previewPlan ? DAY_TYPE_LABEL[previewPlan.dayType] : 'Solo only'}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold">Today's Workout</h2>
            <p className="mt-1 text-sm opacity-90">
              {previewPlan
                ? `~${mins} min · warm-up + ${blockCount} blocks + stretch`
                : 'Not everyone’s kit covers a full session — start solo below'}
            </p>
          </div>
          <div className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">How long have you got?</span>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {STRENGTH_DURATIONS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMinutes(m)}
                    className={`rounded-lg px-3 py-1 text-sm font-bold transition-colors ${
                      minutes === m
                        ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              {[...new Set(mainExercises)].join(' · ')}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              {previewPlan && (
                <button
                  onClick={() => begin(everyone)}
                  className="flex-1 rounded-2xl bg-indigo-600 py-3.5 text-lg font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500"
                >
                  Start duo workout 💪
                </button>
              )}
              <div className="flex flex-1 gap-2 sm:flex-none sm:flex-col">
                {PROFILES.filter((p) => soloAvailable.has(p.id)).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => begin([p.id])}
                    className="flex-1 rounded-2xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 sm:py-1.5 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Just {p.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobility & Relief — standalone, no strength session needed */}
      <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-extrabold">Mobility &amp; Relief</h2>
          <span className="text-xs font-semibold text-slate-400">light or no equipment</span>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Loosen up on its own or after a workout. Each session runs mobilise → open → activate.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400">How long have you got?</span>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {MOBILITY_DURATIONS.map((m) => (
              <button
                key={m}
                onClick={() => setMobilityMinutes(m)}
                className={`rounded-lg px-3 py-1 text-sm font-bold transition-colors ${
                  mobilityMinutes === m
                    ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {m} min
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>Who's doing it?</span>
          {PROFILES.map((p) => (
            <button
              key={p.id}
              onClick={() => setMobilityWho([p.id])}
              className={`rounded-full px-2.5 py-1 font-bold transition-colors ${
                mobilityWho.length === 1 && mobilityWho[0] === p.id
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
              }`}
            >
              {p.name}
            </button>
          ))}
          <button
            onClick={() => setMobilityWho(PROFILES.map((p) => p.id))}
            className={`rounded-full px-2.5 py-1 font-bold transition-colors ${
              mobilityWho.length > 1
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
            }`}
          >
            Both
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(Object.keys(MOBILITY_FOCUS) as MobilityFocus[]).map((focus) => {
            const f = MOBILITY_FOCUS[focus]
            // Shallow pools honestly deliver less than the slot asked for.
            const actualMins = mobilityMins[focus]
            return (
              <button
                key={focus}
                onClick={() => beginMobility(focus)}
                className="rounded-2xl border border-slate-200 p-3 text-left transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:border-slate-700 dark:hover:border-emerald-500 dark:hover:bg-emerald-950"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-bold">{f.label}</p>
                  <span className="shrink-0 text-xs font-semibold text-slate-400">
                    {actualMins} min
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{f.blurb}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* People cards */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {stats.map(({ profile, s }) => (
          <div
            key={profile.id}
            className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <p className={`text-sm font-bold tracking-wide uppercase ${profile.accent.text}`}>
                {profile.name}
              </p>
              {s.completedDates.has(todayISO) &&
                (s.workoutDates.has(todayISO) ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    Workout done ✓
                  </span>
                ) : (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    Recovery done
                  </span>
                ))}
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-3xl font-extrabold">🔥 {s.streak}</p>
                <p className="text-xs text-slate-400">day streak</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-extrabold">Lv {s.level}</p>
                <p className="text-xs text-slate-400">
                  {s.xpIntoLevel}/{s.xpForNextLevel} XP
                </p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${profile.accent.bg}`}
                style={{ width: `${Math.min(100, (s.xpIntoLevel / s.xpForNextLevel) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

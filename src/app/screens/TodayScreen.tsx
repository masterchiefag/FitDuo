import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { usePlayerStore } from '../stores/playerStore'
import { exercisesById } from '../lib/catalog'
import { PROFILES } from '../lib/profiles'
import { DAY_TYPE_LABEL, mobilityPlan, planForToday, statsFor } from '../lib/planner'
import { localDateISO } from '../../core/dates'
import { MOBILITY_FOCUS, type MobilityFocus } from '../../core/generator/mobility'

export default function TodayScreen() {
  const navigate = useNavigate()
  const start = usePlayerStore((s) => s.start)
  const todayISO = localDateISO(Date.now())

  const previewPlan = useMemo(() => planForToday(['p1', 'p2']), [])
  const stats = useMemo(() => PROFILES.map((p) => ({ profile: p, s: statsFor(p.id) })), [])

  const mainExercises = previewPlan.blocks
    .flatMap((b) => (b.kind === 'superset' || b.kind === 'circuit' ? b.items : []))
    .map((i) => exercisesById.get(i.exerciseId)?.name ?? i.exerciseId)
  const mins = Math.round(previewPlan.estimatedSeconds / 60)

  const [mobilityWho, setMobilityWho] = useState<string[]>([PROFILES[0]!.id])

  const beginMobility = (focus: MobilityFocus) => {
    start(mobilityPlan(focus, mobilityWho))
    void navigate('/workout')
  }

  const begin = (participantIds: string[]) => {
    start(planForToday(participantIds))
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

      {/* Workout card */}
      <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-5 text-white">
          <p className="text-xs font-bold tracking-widest uppercase opacity-80">
            {DAY_TYPE_LABEL[previewPlan.dayType]}
          </p>
          <h2 className="mt-1 text-2xl font-extrabold">Today's Workout</h2>
          <p className="mt-1 text-sm opacity-90">~{mins} min · warm-up + 4 blocks + stretch</p>
        </div>
        <div className="p-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {[...new Set(mainExercises)].join(' · ')}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => begin(['p1', 'p2'])}
              className="flex-1 rounded-2xl bg-indigo-600 py-3.5 text-lg font-extrabold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500"
            >
              Start duo workout 💪
            </button>
            <div className="flex gap-2 sm:flex-col">
              {PROFILES.map((p) => (
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

      {/* Mobility & Relief — standalone, no strength session needed */}
      <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-extrabold">Mobility &amp; Relief</h2>
          <span className="text-xs font-semibold text-slate-400">~10 min · no weights needed</span>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Loosen up on its own or after a workout. Each session runs mobilise → open → activate.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {(Object.keys(MOBILITY_FOCUS) as MobilityFocus[]).map((focus) => {
            const f = MOBILITY_FOCUS[focus]
            return (
              <button
                key={focus}
                onClick={() => beginMobility(focus)}
                className="rounded-2xl border border-slate-200 p-3 text-left transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:border-slate-700 dark:hover:border-emerald-500 dark:hover:bg-emerald-950"
              >
                <p className="font-bold">{f.label}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{f.blurb}</p>
              </button>
            )
          })}
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
              {s.completedDates.has(todayISO) && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  Done today ✓
                </span>
              )}
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

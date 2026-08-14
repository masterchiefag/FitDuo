import { useNavigate } from 'react-router'
import { usePlayerStore } from '../stores/playerStore'
import { buildDemoPlan } from '../fixtures/demoPlan'
import { exercisesById } from '../lib/catalog'
import { PROFILES } from '../lib/profiles'
import { loadSessions, loadSetLogs } from '../../infra/localstore'
import { localDateISO } from '../../core/dates'

function personStats(userId: string) {
  const sessions = loadSessions().filter((s) => !s.abandoned && s.participantIds.includes(userId))
  const sets = loadSetLogs().filter((l) => l.userId === userId).length
  const xp = sessions.length * 75 + sets * 2 // M2 approximation; real derivation in M3
  const days = new Set(sessions.map((s) => s.dateISO))
  let streak = 0
  const d = new Date()
  for (;;) {
    const iso = localDateISO(d.getTime())
    if (!days.has(iso)) break
    streak += 1
    d.setDate(d.getDate() - 1)
  }
  const doneToday = days.has(localDateISO(Date.now()))
  return { streak, xp, doneToday, totalSessions: sessions.length }
}

export default function TodayScreen() {
  const navigate = useNavigate()
  const start = usePlayerStore((s) => s.start)
  const todayISO = localDateISO(Date.now())
  const previewPlan = buildDemoPlan(['p1', 'p2'], todayISO)
  const mainExercises = previewPlan.blocks
    .flatMap((b) => (b.kind === 'superset' || b.kind === 'circuit' ? b.items : []))
    .map((i) => exercisesById.get(i.exerciseId)?.name ?? i.exerciseId)
  const mins = Math.round(previewPlan.estimatedSeconds / 60)

  const begin = (participantIds: string[]) => {
    start(buildDemoPlan(participantIds, todayISO))
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
          <p className="text-xs font-bold tracking-widest uppercase opacity-80">Full Body</p>
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

      {/* People cards */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {PROFILES.map((p) => {
          const s = personStats(p.id)
          return (
            <div
              key={p.id}
              className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <p className={`text-sm font-bold tracking-wide uppercase ${p.accent.text}`}>
                  {p.name}
                </p>
                {s.doneToday && (
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
                  <p className="text-xl font-extrabold">{s.xp} XP</p>
                  <p className="text-xs text-slate-400">{s.totalSessions} workouts</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        Fixture workout (M2). Generated daily workouts arrive in M3.
      </p>
    </div>
  )
}

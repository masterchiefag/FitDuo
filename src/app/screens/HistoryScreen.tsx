import { useMemo } from 'react'
import { loadSessions } from '../../infra/localstore'
import { PROFILES } from '../lib/profiles'
import { DAY_TYPE_LABEL } from '../lib/planner'
import type { DayType } from '../../core/generator/types'

export default function HistoryScreen() {
  const sessions = useMemo(() => [...loadSessions()].reverse(), [])

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-extrabold tracking-tight">History</h1>
      {sessions.length === 0 ? (
        <p className="mt-4 text-slate-500 dark:text-slate-400">
          No workouts yet — your finished sessions will show up here.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {sessions.map((s, i) => {
            const mins = Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000))
            const who = s.participantIds
              .map((id) => PROFILES.find((p) => p.id === id)?.name ?? id)
              .join(' + ')
            return (
              <div
                key={i}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <p className="font-bold">
                    {s.mode === 'mobility'
                      ? 'Mobility & Relief'
                      : (DAY_TYPE_LABEL[s.dayType as DayType] ?? s.dayType)}{' '}
                    {s.abandoned && (
                      <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800">
                        partial
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {s.dateISO} · {who}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold">{s.setsLogged} sets</p>
                  <p className="text-xs text-slate-400">{mins} min</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

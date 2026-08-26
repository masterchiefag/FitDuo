import { useMemo } from 'react'
import { exercisesById } from '../lib/catalog'
import { PROFILES } from '../lib/profiles'
import { loadLabel } from '../lib/load'
import { DAY_TYPE_LABEL, generatorInputFor } from '../lib/planner'
import { ThinKitError, generateWorkout } from '../../core/generator/generate'
import { addDays, localDateISO } from '../../core/dates'
import type { DayHistory, WorkoutPlan } from '../../core/generator/types'
import { isWorkBlock } from '../../core/player/position'

/**
 * Dev sanity-check: the next 14 generated days for both profiles, simulating
 * that every generated workout is completed (so no-repeat/variety rules show).
 */
export default function PreviewScreen() {
  // A kit too thin to fill every pattern is a legitimate outcome, and this runs
  // during render — so an unguarded loop white-screens the page instead of
  // saying which pattern ran out.
  const [days, thinKit] = useMemo((): [{ date: string; plan: WorkoutPlan }[], string | null] => {
    const out = []
    const base = generatorInputFor(['p1', 'p2'], localDateISO(Date.now()))
    let history: DayHistory[] = [...base.recentHistory]
    let date = base.dateISO
    for (let i = 0; i < 14; i++) {
      let plan: WorkoutPlan
      try {
        plan = generateWorkout({ ...base, dateISO: date, recentHistory: [...history] })
      } catch (err) {
        if (err instanceof ThinKitError) return [out, err.pattern]
        throw err
      }
      const mains = plan.blocks.filter(isWorkBlock).flatMap((b) => b.items)
      history = [
        ...history,
        {
          dateISO: date,
          dayType: plan.dayType,
          exerciseIds: mains.map((m) => m.exerciseId),
          muscleSetCounts: Object.fromEntries(
            mains
              .flatMap((m) => exercisesById.get(m.exerciseId)?.primaryMuscles ?? [])
              .map((mu) => [mu, 3]),
          ),
        },
      ].slice(-14)
      out.push({ date, plan })
      date = addDays(date, 1)
    }
    return [out, null]
  }, [])

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-extrabold">14-Day Preview</h1>
      {thinKit && (
        <p className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
          Stopped after {days.length} day{days.length === 1 ? '' : 's'}: no movement fits the{' '}
          <strong>{thinKit}</strong> slot with what both profiles own. Widen a kit in Settings.
        </p>
      )}
      <p className="text-sm text-slate-500">
        Dev page — assumes each day is completed. Weekend days show bonus-slot workouts.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {days.map(({ date, plan }) => (
          <div
            key={date}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-baseline justify-between">
              <p className="font-extrabold">
                {date}{' '}
                <span className="text-sm font-semibold text-indigo-500">
                  {DAY_TYPE_LABEL[plan.dayType]}
                </span>
              </p>
              <p className="text-xs text-slate-400">{Math.round(plan.estimatedSeconds / 60)} min</p>
            </div>
            <div className="mt-2 space-y-2">
              {plan.blocks.filter(isWorkBlock).map((b, i) => (
                <div key={i} className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">
                  <p className="text-xs font-bold text-slate-400">
                    {b.kind === 'superset' ? b.label : 'Finisher'} · {b.rounds}×, rest{' '}
                    {b.restSeconds}s
                  </p>
                  {b.items.map((item) => {
                    const ex = exercisesById.get(item.exerciseId)
                    return (
                      <p key={item.exerciseId} className="mt-0.5">
                        <span className="font-semibold">{ex?.name}</span>{' '}
                        <span className="text-xs text-slate-500">
                          {ex?.repRange[1] === 1
                            ? `${ex.secondsPerRep}s hold`
                            : PROFILES.map((p) => {
                                const t = item.perPerson[p.id]
                                if (!t) return null
                                return `${p.name}: ${t.targetReps}×${t.weight > 0 ? loadLabel(ex, t.weight) : 'bw'}`
                              })
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                      </p>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

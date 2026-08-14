import { useMemo } from 'react'
import { PROFILES } from '../lib/profiles'
import { statsFor } from '../lib/planner'
import { ACHIEVEMENTS } from '../../core/gamification/derive'

export default function StatsScreen() {
  const stats = useMemo(() => PROFILES.map((p) => ({ profile: p, s: statsFor(p.id) })), [])

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Stats</h1>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {stats.map(({ profile, s }) => (
          <div
            key={profile.id}
            className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <p className={`text-lg font-extrabold ${profile.accent.text}`}>{profile.name}</p>
              <p className="text-sm font-bold text-slate-400">Level {s.level}</p>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${profile.accent.bg}`}
                style={{ width: `${Math.min(100, (s.xpIntoLevel / s.xpForNextLevel) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {s.xpIntoLevel} / {s.xpForNextLevel} XP to level {s.level + 1}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              {[
                { label: 'Streak', value: `🔥 ${s.streak}` },
                { label: 'Best streak', value: `${s.longestStreak}` },
                { label: 'Workouts', value: `${s.sessionsCompleted}` },
                { label: 'Volume', value: `${(s.totalVolumeKg / 1000).toFixed(1)}t` },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
                  <p className="text-lg font-extrabold">{stat.value}</p>
                  <p className="text-xs text-slate-400">{stat.label}</p>
                </div>
              ))}
            </div>

            <p className="mt-5 text-sm font-bold text-slate-500">
              Achievements ({s.achievements.length}/{ACHIEVEMENTS.length})
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ACHIEVEMENTS.map((a) => {
                const got = s.achievements.find((u) => u.id === a.id)
                return (
                  <div
                    key={a.id}
                    title={got ? `Unlocked ${got.unlockedOn}` : 'Locked'}
                    className={`rounded-xl border p-2 text-center ${
                      got
                        ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950'
                        : 'border-slate-200 opacity-40 grayscale dark:border-slate-800'
                    }`}
                  >
                    <div className="text-xl">{a.emoji}</div>
                    <p className="text-[11px] font-bold">{a.name}</p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

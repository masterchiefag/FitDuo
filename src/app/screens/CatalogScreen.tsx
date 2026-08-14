import { useEffect, useState } from 'react'
import { catalog } from '../lib/catalog'
import { EQUIPMENT_LABEL } from '../lib/equipmentPresets'
import type { Exercise } from '../../core/catalog/types'

const TIER_LABEL = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' } as const

function ExerciseCard({ ex }: { ex: Exercise }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), 1200)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="relative aspect-[4/3] bg-white">
        <img
          src={ex.media.images[frame]}
          alt={ex.name}
          className="h-full w-full object-contain"
          loading="lazy"
        />
        <span className="absolute top-2 left-2 rounded-full bg-slate-900/70 px-2 py-0.5 text-xs font-semibold text-white">
          {ex.requires.map((kit) => kit.map((eq) => EQUIPMENT_LABEL[eq]).join(' + ')).join(' or ')}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold">{ex.name}</h3>
          <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            {TIER_LABEL[ex.tier]}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {ex.pattern} · {ex.primaryMuscles.join(', ')}
          {ex.unilateral ? ' · per side' : ''}
        </p>
        <ul className="mt-2 list-inside list-disc text-xs text-slate-600 dark:text-slate-300">
          {ex.media.instructions.map((cue) => (
            <li key={cue}>{cue}</li>
          ))}
        </ul>
        {ex.setupNote && (
          <p className="mt-2 text-xs text-slate-500 italic dark:text-slate-400">{ex.setupNote}</p>
        )}
      </div>
    </div>
  )
}

// Mobility-only movements were unbrowsable, which is how a stretch cued for the
// floor kept a gym photo unnoticed. Every catalog entry now has a tab.
const ROLES = ['warmup', 'main', 'cooldown', 'mobility'] as const

export default function CatalogScreen() {
  const [role, setRole] = useState<(typeof ROLES)[number]>('main')
  const shown = catalog.exercises.filter((e) => e.role === role)
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Exercise Catalog{' '}
          <span className="text-base font-medium text-slate-400">
            {catalog.exercises.length} exercises
          </span>
        </h1>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {ROLES.map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize transition-colors ${
                role === r
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {r} ({catalog.exercises.filter((e) => e.role === r).length})
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((ex) => (
          <ExerciseCard key={ex.id} ex={ex} />
        ))}
      </div>
    </div>
  )
}

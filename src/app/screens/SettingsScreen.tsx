import { catalog } from '../lib/catalog'
import { allCanPerform, canPerform } from '../../core/catalog/equipment'
import type { Equipment } from '../../core/catalog/types'
import { EQUIPMENT_LABEL, EQUIPMENT_PRESETS } from '../lib/equipmentPresets'
import { PROFILES } from '../lib/profiles'

/** Movements this kit unlocks — the only number that makes a kit change concrete. */
function performableCount(equipment: Equipment[]): number {
  return catalog.exercises.filter((ex) => canPerform(ex, equipment)).length
}

function KitChips({ equipment }: { equipment: Equipment[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {equipment.map((eq) => (
        <span
          key={eq}
          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {EQUIPMENT_LABEL[eq]}
        </span>
      ))}
    </div>
  )
}

export default function SettingsScreen() {
  const total = catalog.exercises.length
  // What a SHARED session can draw on. Per-person counts alone hide the gap:
  // two people at 89 and 82 look fine while the pair trains on 82, because
  // every movement has to suit both kits at once.
  const togetherCount = catalog.exercises.filter((ex) =>
    allCanPerform(
      ex,
      PROFILES.map((p) => p.equipment),
    ),
  ).length
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
      <p className="mt-2 text-slate-500 dark:text-slate-400">
        Weights and schedule will appear here. Editing lands with accounts (M4).
      </p>

      <h2 className="mt-8 text-lg font-bold">Your kit</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Exercises are filtered by what you own — a step-up needs a step the same way a curl needs a
        dumbbell. You do every movement at the same time, so a shared session keeps whatever{' '}
        <em>each</em> of you can do with your own kit: if one of you steps onto a stair and the
        other onto a bench, that still counts.
      </p>
      {PROFILES.length > 1 && (
        <p className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm dark:bg-slate-800">
          <strong>
            Together: {togetherCount} of {total} movements.
          </strong>{' '}
          {/* Compared against the BEST-equipped person, not the worst: the pair
              loses something the moment anyone can do more alone than together,
              which is the usual shape (one owns a band, the other does not). */}
          {togetherCount < Math.max(...PROFILES.map((p) => performableCount(p.equipment)))
            ? 'Fewer than one of you can do alone — every shared movement has to suit both kits, so anything only one of you owns is skipped. Listing it for both unlocks it.'
            : 'Nothing is lost to the gap between your two kits.'}
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PROFILES.map((p) => (
          <div key={p.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`font-bold ${p.accent.text}`}>{p.name}</span>
              <span className="text-xs font-semibold text-slate-400">
                {performableCount(p.equipment)} of {total} movements
              </span>
            </div>
            <KitChips equipment={p.equipment} />
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-bold">Preset kits</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Shortcuts for filling that list in — not modes. Until accounts land, set{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
          equipment
        </code>{' '}
        in{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
          profiles.local.json
        </code>{' '}
        to one of these and restart the dev server.
      </p>
      <div className="mt-4 space-y-3">
        {EQUIPMENT_PRESETS.map((preset) => (
          <div
            key={preset.id}
            className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold">{preset.label}</span>
              <span className="text-xs font-semibold text-slate-400">
                {performableCount(preset.equipment)} of {total} movements
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{preset.blurb}</p>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-100 p-3 text-xs dark:bg-slate-800">
              {`"equipment": ${JSON.stringify(preset.equipment)}`}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

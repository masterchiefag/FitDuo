import { useState } from 'react'
import { catalog } from '../lib/catalog'
import { allCanPerform, canPerform } from '../../core/catalog/equipment'
import type { Equipment } from '../../core/catalog/types'
import { EQUIPMENT_LABEL, EQUIPMENT_PRESETS } from '../lib/equipmentPresets'
import { PROFILES } from '../lib/profiles'
import { clearAllLocalData } from '../../infra/localstore'

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

/**
 * Wiping the app's own logs. Test data is not harmless: sets logged while
 * driving the UI feed `deriveProgression` like any other set, and did in fact
 * raise a real target from 12 reps to 13 before the household's first session
 * (docs/DECISIONS.md, 2026-08-16). Deleting them is the only undo there is.
 */
function ResetLocalData() {
  const [confirming, setConfirming] = useState(false)

  const reset = () => {
    clearAllLocalData()
    // Today, History and Stats each read localStorage once at mount, and the
    // player store holds any live session in memory, so nothing here observes
    // the delete — without this they keep rendering the streak that no longer
    // exists. A reload is the whole fix.
    location.reload()
  }

  return (
    <>
      <h2 className="mt-8 text-lg font-bold">Reset local data</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Deletes this app's saved workouts, sets, feedback and any unfinished session — on{' '}
        <strong>this browser only</strong>. Storage is per browser and per address, so another
        browser, another device, or the same app on a different address keeps its own copy
        untouched. Nothing else stored by other sites is touched.
      </p>
      <div className="mt-3 rounded-2xl border border-red-200 p-4 dark:border-red-900/60">
        {confirming ? (
          <>
            <p className="text-sm font-bold text-red-700 dark:text-red-400">
              Delete everything this browser has saved?
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Every logged workout and every set goes, and with them your History, your streak, your
              XP, your level and your achievements — those are all counted up from the logs, so they
              go back to zero. The weight and rep targets progression has earned reset to their
              starting points. An unfinished session waiting to be resumed is discarded too. This
              cannot be undone.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700"
              >
                Yes, delete it all
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Reset local data
          </button>
        )}
      </div>
    </>
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

      <h2 className="mt-8 text-lg font-bold">Music during a session</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Play it from a separate app, not a second browser tab. The session runs itself on a timer,
        and switching tabs hides this one — the player then pauses where it stood rather than
        counting sets nobody was there to do.
      </p>

      <h2 className="mt-8 text-lg font-bold">Your kit</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Exercises are filtered by what you own — a step-up needs a step the same way a curl needs a
        dumbbell. You do every movement at the same time, so a shared session keeps whatever{' '}
        <em>each</em> of you can do with your own kit: if one of you steps onto a stair and the
        other onto a bench, that still counts.
      </p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Floor space, a sturdy chair and a clear wall are assumed for everyone, so they are not in
        the lists below — movements still name them, which is why a badge can read “Chair or Step or
        Bench”.
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

      <ResetLocalData />
    </div>
  )
}

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogSchema } from '../src/core/catalog/types'
import {
  EQUIPMENT_MOBILITY,
  MOBILITY_ADDITIONS,
  MOBILITY_META,
  SELECTION,
  type Curated,
} from '../content/scripts/selection.ts'

/**
 * `content/catalog.json` is **generated**, not edited. This holds it to that.
 *
 * The failure it exists for is quiet and expensive: `catalog.json` is a normal
 * JSON file, so editing it works perfectly — right up until someone runs
 * `content/scripts/curate.ts`, which rebuilds the file from `selection.ts` and
 * silently drops anything the pipeline was never told about. It had already
 * happened by 2026-08-26: `selection.ts` was untouched since 2026-08-14 while
 * four commits hand-edited the catalog, and running the documented pipeline
 * deleted 45 authored `tempoCue`s and five lower-body `mobility.regions` tags —
 * the ones the cool-down uses to answer a leg day. The catalog tests caught the
 * tempo loss only *after* a regeneration nobody had reason to perform.
 *
 * Comparing the two sources catches it at the moment of the hand-edit instead,
 * and needs no network: only `primaryMuscles`, `secondaryMuscles` and the media
 * frames come from free-exercise-db. Everything checked here is our authoring.
 */

const ROOT = join(__dirname, '..')
const rawCatalog = JSON.parse(readFileSync(join(ROOT, 'content', 'catalog.json'), 'utf8')) as {
  exercises: Record<string, unknown>[]
}
const catalog = catalogSchema.parse(rawCatalog)

/**
 * Every key `curate.ts` can write. Adding one here without teaching the
 * pipeline to emit it is the bug this list exists to make impossible.
 *
 * The field-by-field checks below only compare what they were told to compare,
 * which makes a *new* authored field invisible to them by default — and that is
 * not hypothetical. `focusCue` was missing from the first version of this file
 * (Grok, #38), and `warmupPhase` arrived in #35 as a hand-edit to catalog.json
 * that this suite stayed green on while `curate.ts` deleted all 14 of them. So
 * the shape is guarded here rather than the values alone: an unrecognised key
 * fails on arrival, whatever it ends up being called.
 */
const PIPELINE_KEYS = new Set([
  'id',
  'name',
  'role',
  'warmupPhase',
  'requires',
  'pattern',
  'primaryMuscles',
  'secondaryMuscles',
  'tier',
  'unilateral',
  'repRange',
  'tempoCue',
  'secondsPerRep',
  'setupSeconds',
  'setupNote',
  'media',
  'loads',
  'mobility',
])

/** Every curated entry, in the order `curate.ts` walks them. */
const curated: Curated[] = [...SELECTION, ...MOBILITY_ADDITIONS, ...EQUIPMENT_MOBILITY]

describe('catalog.json is what selection.ts says it is', () => {
  it('carries no field the pipeline cannot write', () => {
    for (const ex of rawCatalog.exercises) {
      const unknown = Object.keys(ex).filter((k) => !PIPELINE_KEYS.has(k))
      expect(
        unknown,
        `${ex.id} carries ${unknown.join(', ')} — hand-edited into catalog.json, and gone at the next regeneration unless curate.ts learns to emit it`,
      ).toEqual([])
    }
  })

  it('has exactly the exercises the pipeline curates — no more, no fewer', () => {
    expect([...catalog.exercises.map((e) => e.id)].sort()).toEqual(
      [...curated.map((c) => c.slug)].sort(),
    )
  })

  it.each(curated.map((c) => [c.slug, c] as const))(
    'authored fields of %s match the pipeline',
    (slug, sel) => {
      const ex = catalog.exercises.find((e) => e.id === slug)
      expect(ex, `${slug} is curated but absent from catalog.json`).toBeDefined()
      expect({
        name: ex!.name,
        role: ex!.role,
        requires: ex!.requires,
        pattern: ex!.pattern,
        tier: ex!.tier,
        unilateral: ex!.unilateral,
        repRange: ex!.repRange,
        secondsPerRep: ex!.secondsPerRep,
        setupSeconds: ex!.setupSeconds,
        setupNote: ex!.setupNote,
        tempoCue: ex!.tempoCue,
        warmupPhase: ex!.warmupPhase,
        cues: ex!.media.instructions,
      }).toEqual({
        name: sel.displayName,
        role: sel.role,
        requires: sel.requires,
        pattern: sel.pattern,
        tier: sel.tier,
        unilateral: sel.unilateral,
        repRange: sel.repRange,
        secondsPerRep: sel.secondsPerRep,
        setupSeconds: sel.setupSeconds,
        setupNote: sel.setupNote,
        tempoCue: sel.tempoCue,
        warmupPhase: sel.warmupPhase,
        cues: sel.cues,
      })
    },
  )

  /**
   * Mobility metadata arrives by two routes — carried on the addition itself,
   * or layered onto an existing entry by `MOBILITY_META` — and the drift that
   * prompted this test came in through the second one. `regions` in particular
   * could not be expressed for the legs at all until the authoring type gained
   * the vocabulary, so the tags existed only in the JSON.
   */
  it.each(curated.map((c) => [c.slug, c] as const))(
    'mobility metadata of %s matches',
    (slug, sel) => {
      const ex = catalog.exercises.find((e) => e.id === slug)!
      const declared =
        ('mobility' in sel ? (sel as { mobility?: unknown }).mobility : undefined) ??
        MOBILITY_META[slug]
      if (!declared) {
        expect(ex.mobility, `${slug} carries mobility metadata nothing declares`).toBeUndefined()
        return
      }
      const d = declared as {
        phase: string
        regions: string[]
        seconds: number
        priority?: number
        focusCue?: string
      }
      expect({
        phase: ex.mobility?.phase,
        regions: ex.mobility?.regions,
        seconds: ex.mobility?.seconds,
        // `priority` defaults to 1 in the schema, so an entry that declares
        // nothing and one that declares 1 are the same exercise.
        priority: ex.mobility?.priority,
        // Included for the same reason as `tempoCue`: it is authored here and
        // rendered to the person mid-movement — the emerald line under the timer —
        // so a catalog-only edit is a line that survives until the next
        // regeneration, and a selection-only edit is a line that never ships.
        focusCue: ex.mobility?.focusCue,
      }).toEqual({
        phase: d.phase,
        regions: d.regions,
        seconds: d.seconds,
        priority: d.priority ?? 1,
        focusCue: d.focusCue,
      })
    },
  )
})

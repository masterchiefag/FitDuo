import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canPerform } from '../src/core/catalog/equipment'
import { catalogSchema, type Equipment } from '../src/core/catalog/types'

/**
 * Pool depth has to hold for the kit people actually own, not for the catalog
 * on paper. `home` is the household with a chair, a wall and stairs; `minimal`
 * is a pair of dumbbells and floor space — and it is also what a duo session
 * gets when only one of them owns the band and roller, since shared sessions
 * intersect.
 */
const KITS: Record<string, Equipment[]> = {
  full: [
    'bodyweight',
    'dumbbell',
    'band',
    'roller',
    'bench',
    'step',
    'chair',
    'wall',
    'pullup_bar',
  ],
  home: ['bodyweight', 'dumbbell', 'band', 'roller', 'chair', 'wall', 'step'],
  minimal: ['bodyweight', 'dumbbell'],
}

const ROOT = join(__dirname, '..')
const raw = JSON.parse(readFileSync(join(ROOT, 'content', 'catalog.json'), 'utf8'))

describe('exercise catalog', () => {
  it('validates against the schema', () => {
    const result = catalogSchema.safeParse(raw)
    expect(result.success, JSON.stringify(result.error?.issues?.slice(0, 3))).toBe(true)
  })

  const catalog = catalogSchema.parse(raw)

  it('every exercise has two media frames on disk', () => {
    for (const ex of catalog.exercises) {
      expect(ex.media.images).toHaveLength(2)
      for (const img of ex.media.images) {
        expect(existsSync(join(ROOT, 'public', img)), `${ex.id}: missing ${img}`).toBe(true)
      }
    }
  })

  it('every exercise has at least 2 form cues', () => {
    for (const ex of catalog.exercises) {
      expect(ex.media.instructions.length, ex.id).toBeGreaterThanOrEqual(2)
    }
  })

  it.each(Object.entries(KITS))('pools are deep enough on the %s kit', (kitName, kit) => {
    const performable = catalog.exercises.filter((e) => canPerform(e, kit))
    const warmups = performable.filter((e) => e.role === 'warmup')
    const cooldowns = performable.filter((e) => e.role === 'cooldown')
    expect(warmups.length, `warmups on ${kitName}`).toBeGreaterThanOrEqual(10)
    expect(cooldowns.length, `cooldowns on ${kitName}`).toBeGreaterThanOrEqual(10)

    // Each main movement pattern needs enough candidates to honor a 3-day
    // no-repeat window; tier-1 depth guards the beginner path.
    const mains = performable.filter((e) => e.role === 'main')
    const patterns = ['push_h', 'push_v', 'pull_h', 'pull_v', 'squat', 'hinge', 'lunge', 'core']
    for (const p of patterns) {
      const pool = mains.filter((e) => e.pattern === p)
      expect(pool.length, `${kitName}: pattern ${p}`).toBeGreaterThanOrEqual(3)
      expect(
        pool.filter((e) => e.tier === 1).length,
        `${kitName}: tier-1 pool for ${p}`,
      ).toBeGreaterThanOrEqual(1)
    }
  })

  it('declares gear honestly: every kit is a real, non-empty alternative', () => {
    for (const ex of catalog.exercises) {
      expect(ex.requires.length, `${ex.id} has no kit`).toBeGreaterThanOrEqual(1)
      for (const kit of ex.requires) {
        expect(kit.length, `${ex.id} has an empty kit`).toBeGreaterThanOrEqual(1)
        // A kit listing bodyweight alongside gear is a modelling slip: the kit
        // means "everything here, together", and everyone has their own body.
        if (kit.length > 1) expect(kit, ex.id).not.toContain('bodyweight')
      }
      expect(new Set(ex.requires.map((k) => [...k].sort().join('+'))).size, ex.id).toBe(
        ex.requires.length,
      )
    }
  })

  it('ids are unique', () => {
    const ids = catalog.exercises.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

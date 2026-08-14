import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogSchema } from '../src/core/catalog/types'

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

  it('pools are deep enough to generate varied sessions', () => {
    const warmups = catalog.exercises.filter((e) => e.role === 'warmup')
    const cooldowns = catalog.exercises.filter((e) => e.role === 'cooldown')
    expect(warmups.length).toBeGreaterThanOrEqual(10)
    expect(cooldowns.length).toBeGreaterThanOrEqual(10)

    // Each main movement pattern needs enough candidates to honor a 3-day
    // no-repeat window; tier-1 depth guards the beginner path.
    const mains = catalog.exercises.filter((e) => e.role === 'main')
    const patterns = ['push_h', 'push_v', 'pull_h', 'pull_v', 'squat', 'hinge', 'lunge', 'core']
    for (const p of patterns) {
      const pool = mains.filter((e) => e.pattern === p)
      expect(pool.length, `pattern ${p}`).toBeGreaterThanOrEqual(3)
      expect(
        pool.filter((e) => e.tier === 1).length,
        `tier-1 pool for ${p}`,
      ).toBeGreaterThanOrEqual(1)
    }
  })

  it('ids are unique', () => {
    const ids = catalog.exercises.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

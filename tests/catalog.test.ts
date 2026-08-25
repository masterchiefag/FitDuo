import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canPerform } from '../src/core/catalog/equipment'
import { catalogSchema, type Equipment } from '../src/core/catalog/types'
import { TEMPLATES } from '../src/core/generator/generate'

/**
 * The most distinct movements any single day type asks of one pattern. The
 * generator never repeats a movement within a day (`usedToday`), so this — not
 * a round number — is the depth below which generation throws `ThinKitError`.
 */
const SLOTS_PER_DAY: Record<string, number> = (() => {
  const worst: Record<string, number> = {}
  for (const t of Object.values(TEMPLATES)) {
    const day: Record<string, number> = {}
    for (const p of [...t.supersets.flat(), ...t.circuit]) day[p] = (day[p] ?? 0) + 1
    for (const [p, n] of Object.entries(day)) worst[p] = Math.max(worst[p] ?? 0, n)
  }
  return worst
})()

/**
 * Pool depth has to hold for the kit people actually own, not for the catalog
 * on paper. `home` is the household with stairs; `minimal` is a pair of
 * dumbbells and floor space, which is roughly what a duo session draws on when
 * only one of the two owns the band and roller — a shared movement has to suit
 * *each* person's own kit (`allCanPerform`), which is not the same as checking
 * the intersection of their lists once alternative kits exist.
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

  /**
   * A main exercise is something a person is asked to load and repeat, and the
   * first real session found the app silent on how to move: *"nothing about
   * speed of movement, here or anywhere"* (docs/SESSIONS.md, finding 4). The
   * cue is authored, so nothing but this test can notice a new main arriving
   * without one — and a derived stand-in is exactly what must not happen, since
   * `secondsPerRep` is the estimator's budget number, not coaching.
   */
  it('every main exercise carries an authored tempo cue', () => {
    for (const ex of catalog.exercises.filter((e) => e.role === 'main')) {
      expect(ex.tempoCue, `${ex.id} has no tempoCue`).toBeTruthy()
      // Read mid-set, from meters away: a paragraph here is not a cue.
      expect(ex.tempoCue!.length, `${ex.id}: tempoCue is too long to read mid-set`).toBeLessThanOrEqual(90)
    }
  })

  it.each(Object.entries(KITS))('pools are deep enough on the %s kit', (kitName, kit) => {
    const performable = catalog.exercises.filter((e) => canPerform(e, kit))
    const warmups = performable.filter((e) => e.role === 'warmup')
    const cooldowns = performable.filter((e) => e.role === 'cooldown')
    expect(warmups.length, `warmups on ${kitName}`).toBeGreaterThanOrEqual(10)
    expect(cooldowns.length, `cooldowns on ${kitName}`).toBeGreaterThanOrEqual(10)

    const mains = performable.filter((e) => e.role === 'main')
    for (const [p, needed] of Object.entries(SLOTS_PER_DAY)) {
      const pool = mains.filter((e) => e.pattern === p)
      // A flat ">= 3" was the floor here and it was below what a day actually
      // eats: `usedToday` never repeats a movement, so a pull day needs FIVE
      // distinct pull_h or generation throws. Derived from TEMPLATES so a new
      // day type cannot outgrow the check silently.
      expect(
        pool.length,
        `${kitName}: ${p} needs ${needed} distinct per day`,
      ).toBeGreaterThanOrEqual(needed)
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

  /**
   * The invariant that makes the exercise-scoped `isWeighted` correct, asserted
   * rather than assumed. A movement whose kits disagree about dumbbells —
   * `[['dumbbell'], ['band']]` — cannot have its load decided without knowing
   * whose kit it is, and `isWeighted` would call it unloaded for everyone,
   * including the person holding 15 kg.
   *
   * This is the guard for that accepted risk. Pool depth is NOT: adding a band
   * alternative to a thin pattern makes the pool *deeper*, so a depth test goes
   * green while the load bug ships. Breaking this test is the signal to make
   * load person-scoped, not to widen the test.
   */
  it('no exercise mixes loaded and unloaded kits', () => {
    for (const ex of catalog.exercises) {
      const loaded = ex.requires.map((kit) => kit.includes('dumbbell'))
      expect(
        new Set(loaded).size,
        `${ex.id} has kits that disagree about dumbbells: ${JSON.stringify(ex.requires)} — load must become person-scoped (see isWeighted)`,
      ).toBe(1)
    }
  })

  it('ids are unique', () => {
    const ids = catalog.exercises.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

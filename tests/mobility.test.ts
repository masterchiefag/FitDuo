import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogSchema } from '../src/core/catalog/types'
import {
  MOBILITY_FOCUS,
  generateMobilitySession,
  type MobilityFocus,
} from '../src/core/generator/mobility'

const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'content', 'catalog.json'), 'utf8')),
).exercises

const base = {
  householdId: 'home',
  dateISO: '2026-08-14',
  generatorVersion: 1,
  catalog,
  participantIds: ['p1'],
  equipment: ['bodyweight', 'dumbbell', 'band', 'roller'] as const,
}

const gen = (focus: MobilityFocus, equipment = base.equipment, minutes = 10) =>
  generateMobilitySession({
    ...base,
    focus,
    equipment: [...equipment],
    targetSeconds: minutes * 60,
  })

describe('mobility sessions', () => {
  const focuses = Object.keys(MOBILITY_FOCUS) as MobilityFocus[]

  it('every focus produces a session of mobilise → open → activate', () => {
    for (const focus of focuses) {
      const plan = gen(focus)
      const labels = plan.blocks.map((b) => (b.kind === 'mobility' ? b.label : b.kind))
      expect(labels, focus).toEqual(['Mobilise', 'Open', 'Activate'])
      expect(plan.blocks.every((b) => b.kind === 'mobility')).toBe(true)
    }
  })

  it('never runs meaningfully longer than requested', () => {
    for (const focus of focuses) {
      for (const minutes of [5, 10, 20, 30]) {
        const mins = gen(focus, base.equipment, minutes).estimatedSeconds / 60
        // Overshoot is bounded by the last movement of each phase plus block
        // transitions. Undershoot is legitimate: a shallow pool delivers a
        // shorter honest session rather than padding (see the repeat test).
        expect(mins, `${focus} @ ${minutes}min`).toBeLessThanOrEqual(minutes * 1.2 + 2)
      }
    }
  })

  it('fills the requested slot when the catalog can support it', () => {
    for (const minutes of [5, 10, 20]) {
      const mins = gen('posture', base.equipment, minutes).estimatedSeconds / 60
      expect(mins, `posture @ ${minutes}min`).toBeGreaterThanOrEqual(minutes * 0.85)
    }
  })

  it('pads with at most one extra round — never the same stretch three times', () => {
    for (const focus of focuses) {
      const ids = gen(focus, base.equipment, 30).blocks.flatMap((b) =>
        b.items.map((i) => i.exerciseId),
      )
      for (const id of new Set(ids)) {
        expect(ids.filter((x) => x === id).length, `${focus}: ${id}`).toBeLessThanOrEqual(2)
      }
    }
  })

  it('longer sessions contain strictly more work than shorter ones', () => {
    const short = gen('posture', base.equipment, 5).estimatedSeconds
    const long = gen('posture', base.equipment, 30).estimatedSeconds
    expect(long).toBeGreaterThan(short * 2)
  })

  it('activation work survives even the shortest session', () => {
    const plan = gen('posture', base.equipment, 5)
    const activate = plan.blocks.find((b) => b.kind === 'mobility' && b.label === 'Activate')
    expect(activate).toBeDefined()
    expect(activate!.items.length).toBeGreaterThanOrEqual(1)
  })

  it('is deterministic for the same day and focus', () => {
    expect(gen('posture')).toEqual(gen('posture'))
  })

  it('different focuses select different work', () => {
    const posture = gen('posture').blocks.flatMap((b) => b.items.map((i) => i.exerciseId))
    const lower = gen('lower_back_hips').blocks.flatMap((b) => b.items.map((i) => i.exerciseId))
    expect(posture).not.toEqual(lower)
  })

  it('only prescribes equipment the person owns', () => {
    const byId = new Map(catalog.map((e) => [e.id, e]))
    const plan = gen('posture', ['bodyweight'])
    for (const b of plan.blocks) {
      for (const item of b.items) {
        expect(byId.get(item.exerciseId)!.equipment).toBe('bodyweight')
      }
    }
  })

  it('band and roller work appears when that kit is available', () => {
    const withKit = gen('posture').blocks.flatMap((b) => b.items.map((i) => i.exerciseId))
    const byId = new Map(catalog.map((e) => [e.id, e]))
    const kitUsed = withKit.filter((id) => ['band', 'roller'].includes(byId.get(id)!.equipment))
    expect(kitUsed.length).toBeGreaterThan(0)
  })

  it('posture sessions include real mid-back activation, not just stretching', () => {
    const plan = gen('posture')
    const activate = plan.blocks.find((b) => b.kind === 'mobility' && b.label === 'Activate')!
    expect(activate.items.length).toBeGreaterThanOrEqual(3)
    // The whole point: something must switch the mid-back / cuff on.
    const ids = activate.items.map((i) => i.exerciseId)
    const strengtheners = [
      'band-pull-apart',
      'band-rear-fly',
      'band-external-rotation',
      'scap-retraction',
      'prone-rear-delt-raise',
      'shoulder-external-rotation',
      'superman',
      'db-reverse-fly',
      'chin-tuck',
    ]
    expect(ids.some((id) => strengtheners.includes(id))).toBe(true)
  })

  it('every prescribed exercise carries mobility metadata and media', () => {
    const byId = new Map(catalog.map((e) => [e.id, e]))
    for (const focus of focuses) {
      for (const b of gen(focus).blocks) {
        for (const item of b.items) {
          const ex = byId.get(item.exerciseId)
          expect(ex, item.exerciseId).toBeDefined()
          expect(ex!.mobility).toBeDefined()
          expect(ex!.media.images).toHaveLength(2)
          expect(item.seconds).toBeGreaterThan(0)
        }
      }
    }
  })
})

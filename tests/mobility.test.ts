import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogSchema, type Equipment } from '../src/core/catalog/types'
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

// One kit per participant; the solo default is the single kit under test.
const gen = (focus: MobilityFocus, equipment = base.equipment, minutes = 10) =>
  generateMobilitySession({
    ...base,
    focus,
    kits: [[...equipment]],
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

  it('the posture pool fills a request without repeating a movement, up to what each kit can hold', () => {
    // The content bar. Padding a thin pool by cycling it (which the fill loop
    // will happily do) is the failure this catches — so assert the length too,
    // or an under-filled session would pass by prescribing almost nothing.
    //
    // Two kits, because the duration a kit can honestly serve is a property of
    // the *kit*, not of the generator. A duo movement must be doable by BOTH
    // people, so when only one owns a band the pair effectively trains on
    // bodyweight + dumbbell — and that path gets less content, so it tops out
    // sooner. The binding phase in both cases is `activate` (35% of the budget).
    //
    // Neither goes to 30 min. The full-kit pool holds ~27.7 min of unique work
    // but caps a repeat-free session at ~24.9 min; bw+dumbbell caps at ~16.5.
    // Filling the rest would mean shipping near-duplicate movements, or ones
    // whose demo photos show something other than the cues — see the PR. The
    // honest fix for 30 min is capping the offered duration, not more filler.
    const kits: [string, Equipment[], number[]][] = [
      ['full kit', ['bodyweight', 'dumbbell', 'band', 'roller'], [10, 20]],
      ['duo (bodyweight + dumbbell)', ['bodyweight', 'dumbbell'], [10]],
    ]
    for (const [label, equipment, durations] of kits) {
      for (const dateISO of ['2026-08-14', '2026-11-02', '2027-01-31']) {
        for (const minutes of durations) {
          const where = `${label} ${dateISO} @ ${minutes}min`
          const plan = generateMobilitySession({
            ...base,
            kits: [equipment],
            focus: 'posture',
            dateISO,
            targetSeconds: minutes * 60,
          })
          const ids = plan.blocks.flatMap((b) => b.items.map((i) => i.exerciseId))
          for (const id of new Set(ids)) {
            expect(ids.filter((x) => x === id).length, `${where}: ${id}`).toBe(1)
          }
          expect(plan.estimatedSeconds, where).toBeGreaterThanOrEqual(minutes * 60 * 0.85)
        }
      }
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
        const ex = byId.get(item.exerciseId)!
        // Checked against `requires` directly, NOT via canPerform: calling the
        // predicate the generator used would keep this green through any bug in
        // it, including a widened assumed-fixture set.
        const ASSUMED = ['bodyweight', 'chair', 'wall']
        const usable = ex.requires.some((kit) => kit.every((need) => ASSUMED.includes(need)))
        expect(usable, `${ex.id} needs ${JSON.stringify(ex.requires)}`).toBe(true)
      }
    }
  })

  it('band and roller work appears when that kit is available', () => {
    const withKit = gen('posture').blocks.flatMap((b) => b.items.map((i) => i.exerciseId))
    const byId = new Map(catalog.map((e) => [e.id, e]))
    const kitUsed = withKit.filter((id) =>
      byId.get(id)!.requires.some((kit) => kit.some((eq) => eq === 'band' || eq === 'roller')),
    )
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

  /**
   * Breadth the clock buys (`extendedRegions`).
   *
   * A long session used to spend its extra minutes *repeating* the pool, which
   * is a worse use of thirty minutes than covering more ground. Full Body now
   * reaches for the legs — but only once a phase can afford a whole extra
   * movement, and never far enough to stop being the session people picked.
   */
  describe('breadth scales with the time available', () => {
    const byId = new Map(catalog.map((e) => [e.id, e]))
    const LEG_REGIONS = ['glutes', 'hamstrings', 'quads', 'calves']
    const idsOf = (focus: MobilityFocus, minutes: number) =>
      gen(focus, base.equipment, minutes).blocks.flatMap((b) => b.items.map((i) => i.exerciseId))
    const legsIn = (ids: string[]) =>
      ids.filter((id) => byId.get(id)!.mobility!.regions.some((r) => LEG_REGIONS.includes(r)))

    it('a five-minute Full Body session is exactly the session it always was', () => {
      expect(legsIn(idsOf('full_body', 5))).toEqual([])
    })

    it('a longer Full Body session covers more ground, not the same ground twice', () => {
      expect(legsIn(idsOf('full_body', 20)).length).toBeGreaterThanOrEqual(2)
      expect(legsIn(idsOf('full_body', 30)).length).toBeGreaterThanOrEqual(
        legsIn(idsOf('full_body', 20)).length,
      )
    })

    it('never lets breadth become the session', () => {
      for (const minutes of [5, 10, 20, 30]) {
        const ids = idsOf('full_body', minutes)
        expect(
          legsIn(ids).length / ids.length,
          `full_body @ ${minutes}min: ${legsIn(ids).length}/${ids.length}`,
        ).toBeLessThanOrEqual(0.25)
      }
    })

    /**
     * The point of taking breadth's share *first*, and only in whole
     * movements: what it cannot spend goes back to the focus's own work, so
     * widening a focus can never shorten a session that gains nothing from it.
     */
    it('gives unspent breadth back to the focus', () => {
      for (const minutes of [5, 10, 20, 30]) {
        const full = gen('full_body', base.equipment, minutes).estimatedSeconds
        const posture = gen('posture', base.equipment, minutes).estimatedSeconds
        expect(full, `@ ${minutes}min`).toBeGreaterThanOrEqual(posture * 0.9)
      }
    })

    it('opens the back of the thigh in the sitting-stiffness session, at any length', () => {
      // Not breadth — hamstrings are core regions for this focus, because
      // sitting shortens them the same way it shortens the hip flexors.
      for (const minutes of [10, 20]) {
        expect(idsOf('lower_back_hips', minutes), `@ ${minutes}min`).toContain(
          'seated-hamstring-stretch',
        )
      }
    })
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

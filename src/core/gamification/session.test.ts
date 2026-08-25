import { describe, expect, it } from 'vitest'
import { sessionTotals } from './session'

const set = (userId: string, actualReps: number, weight: number) => ({ userId, actualReps, weight })

describe('sessionTotals', () => {
  it('is tonnage: weight × reps, summed', () => {
    expect(sessionTotals([set('a', 10, 7.5), set('a', 8, 10)], 'a')).toEqual({
      sets: 2,
      reps: 18,
      volumeKg: 155, // 75 + 80
    })
  })

  it('counts a bodyweight session in reps, because its tonnage is zero', () => {
    expect(sessionTotals([set('a', 12, 0), set('a', 10, 0)], 'a')).toEqual({
      sets: 2,
      reps: 22,
      volumeKg: 0,
    })
  })

  /** One duo session logs a row per person; neither may speak for the other. */
  it('counts only the person asked about', () => {
    const sets = [set('a', 10, 10), set('b', 12, 5), set('a', 10, 10)]
    expect(sessionTotals(sets, 'a')).toEqual({ sets: 2, reps: 20, volumeKg: 200 })
    expect(sessionTotals(sets, 'b')).toEqual({ sets: 1, reps: 12, volumeKg: 60 })
  })

  it('is empty for someone with no sets', () => {
    expect(sessionTotals([set('a', 10, 10)], 'b')).toEqual({ sets: 0, reps: 0, volumeKg: 0 })
  })

  it('rounds the halves that 2.5 kg dumbbells produce', () => {
    expect(sessionTotals([set('a', 9, 2.5), set('a', 9, 2.5)], 'a').volumeKg).toBe(45)
  })
})

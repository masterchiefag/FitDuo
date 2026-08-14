import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, weekdayIndex } from './dates'

describe('dates', () => {
  it('weekdayIndex: 0 = Monday', () => {
    expect(weekdayIndex('2026-08-10')).toBe(0) // a Monday
    expect(weekdayIndex('2026-08-14')).toBe(4) // a Friday
    expect(weekdayIndex('2026-08-16')).toBe(6) // a Sunday
  })

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29') // leap year
  })

  it('daysBetween is signed and consistent with addDays', () => {
    expect(daysBetween('2026-08-01', '2026-08-14')).toBe(13)
    expect(daysBetween('2026-08-14', '2026-08-01')).toBe(-13)
    expect(daysBetween('2026-02-27', addDays('2026-02-27', 400))).toBe(400)
  })
})

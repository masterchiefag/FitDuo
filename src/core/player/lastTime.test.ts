import { describe, expect, it } from 'vitest'
import { lastTimeNews, movedUp, targetNote } from './lastTime'

const target = (targetReps: number, weight: number) => ({ targetReps, weight })

describe('lastTimeNews', () => {
  it('is silent when today asks for exactly what was done last time', () => {
    expect(lastTimeNews(target(10, 7.5), { weight: 7.5, reps: 10 })).toBeNull()
  })

  it('is silent for a movement with no history', () => {
    expect(lastTimeNews(target(10, 7.5), undefined)).toBeNull()
  })

  it('speaks when the bell moved', () => {
    expect(lastTimeNews(target(8, 10), { weight: 7.5, reps: 10 })).toEqual({
      weight: 7.5,
      reps: 10,
    })
  })

  /** Chair dips and planks are 0 kg on both sides — reps are the only news. */
  it('speaks on reps for a bodyweight movement', () => {
    expect(lastTimeNews(target(12, 0), { weight: 0, reps: 10 })).toEqual({ weight: 0, reps: 10 })
    expect(lastTimeNews(target(12, 0), { weight: 0, reps: 12 })).toBeNull()
  })

  it('speaks when only the reps moved on a weighted movement', () => {
    expect(lastTimeNews(target(11, 7.5), { weight: 7.5, reps: 10 })).toEqual({
      weight: 7.5,
      reps: 10,
    })
  })
})

describe('movedUp', () => {
  it('is the heavier bell, whatever the reps did', () => {
    // Double progression drops back to the bottom of the range on a weight step.
    expect(movedUp(target(8, 10), { weight: 7.5, reps: 12 })).toBe(true)
  })

  /** What a "too hard" tap produces next session — true, but not a prize. */
  it('is false on a step down', () => {
    expect(movedUp(target(8, 7.5), { weight: 10, reps: 8 })).toBe(false)
    expect(movedUp(target(8, 0), { weight: 0, reps: 10 })).toBe(false)
  })

  it('is the extra rep when the bell is unchanged', () => {
    expect(movedUp(target(11, 7.5), { weight: 7.5, reps: 10 })).toBe(true)
    expect(movedUp(target(12, 0), { weight: 0, reps: 10 })).toBe(true)
  })
})

describe('targetNote', () => {
  /** The whole point: a cold store is a fact, not a blank. */
  it('says first time when nothing has been logged for this movement', () => {
    expect(targetNote(target(10, 7.5), undefined, false)).toEqual({ kind: 'first_time' })
  })

  it('says first time for a hold too — never having held it is still true', () => {
    expect(targetNote(target(1, 0), undefined, true)).toEqual({ kind: 'first_time' })
  })

  /** The silence that was always deliberate stays silent. */
  it('says nothing when today asks for exactly what was done last time', () => {
    expect(targetNote(target(10, 7.5), { weight: 7.5, reps: 10 }, false)).toBeNull()
  })

  it('says nothing for a hold that has history — "last time 1 rep" is not a fact', () => {
    expect(targetNote(target(1, 0), { weight: 0, reps: 1 }, true)).toBeNull()
  })

  it('carries last time and whether today is the harder day', () => {
    expect(targetNote(target(8, 10), { weight: 7.5, reps: 10 }, false)).toEqual({
      kind: 'last_time',
      last: { weight: 7.5, reps: 10 },
      up: true,
    })
    expect(targetNote(target(8, 7.5), { weight: 10, reps: 8 }, false)).toEqual({
      kind: 'last_time',
      last: { weight: 10, reps: 8 },
      up: false,
    })
  })
})

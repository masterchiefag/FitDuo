import { describe, expect, it } from 'vitest'
import { lastTimeNews } from './lastTime'

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

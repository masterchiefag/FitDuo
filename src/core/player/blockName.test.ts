import { describe, expect, it } from 'vitest'
import { blockPosition, muscleWords, workBlockName } from './blockName'

describe('muscleWords', () => {
  it('joins two movements with an ampersand', () => {
    expect(muscleWords(['back', 'shoulders'])).toBe('back & shoulders')
  })

  it('collapses a block that works one muscle twice', () => {
    expect(muscleWords(['chest', 'chest'])).toBe('chest')
  })

  it('keeps performance order, not alphabetical order', () => {
    expect(muscleWords(['triceps', 'biceps'])).toBe('triceps & biceps')
  })

  it('lists three, which is the Finisher at its widest', () => {
    expect(muscleWords(['quads', 'core', 'glutes'])).toBe('quads, core & glutes')
  })

  /** A name, not a list: past three the line stops being readable at distance. */
  it('stops at three', () => {
    expect(muscleWords(['quads', 'core', 'glutes', 'back'])).toBe('quads, core & glutes')
  })

  it('is null when there is nothing to say', () => {
    expect(muscleWords([])).toBeNull()
  })
})

describe('blockPosition', () => {
  it('counts work blocks, 1-based', () => {
    expect(blockPosition('superset', 2, 4)).toBe('Block 2 of 4')
  })

  /** The one block everyone in the session already has a word for. */
  it('leaves the Finisher its name', () => {
    expect(blockPosition('circuit', 4, 4)).toBe('Finisher')
  })
})

describe('workBlockName', () => {
  it('is position plus the block’s own content', () => {
    expect(
      workBlockName({
        kind: 'superset',
        blockNumber: 2,
        blockCount: 4,
        primaries: ['back', 'shoulders'],
      }),
    ).toBe('Block 2 of 4 — back & shoulders')
  })

  it('never says Strength B', () => {
    const name = workBlockName({
      kind: 'circuit',
      blockNumber: 4,
      blockCount: 4,
      primaries: ['quads', 'core'],
    })
    expect(name).toBe('Finisher — quads & core')
  })

  /** A block whose exercises are missing from the catalog still has a position. */
  it('falls back to position alone when the content says nothing', () => {
    expect(
      workBlockName({ kind: 'superset', blockNumber: 1, blockCount: 3, primaries: [] }),
    ).toBe('Block 1 of 3')
  })
})

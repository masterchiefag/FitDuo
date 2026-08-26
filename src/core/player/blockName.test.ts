import { describe, expect, it } from 'vitest'
import { blockPosition, muscleWords, regionWords, workBlockName } from './blockName'

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

describe('regionWords', () => {
  it('speaks the words a person uses about their own body', () => {
    expect(regionWords(['thoracic', 'lower_back'])).toBe('upper back & lower back')
  })

  it('names what the session spends its time on first', () => {
    // A Posture session that borrowed one hip movement for breadth is still
    // about the upper back, whatever order the blocks happened to run in.
    expect(regionWords(['hips', 'thoracic', 'shoulders', 'thoracic', 'shoulders', 'thoracic'])).toBe(
      'upper back, shoulders & hips',
    )
  })

  it('breaks ties by first appearance, never by Map order', () => {
    expect(regionWords(['glutes', 'hips'], 1)).toBe('glutes')
    expect(regionWords(['hips', 'glutes'], 1)).toBe('hips')
  })

  it('is a name, not an inventory', () => {
    expect(regionWords(['thoracic', 'shoulders', 'chest', 'neck', 'hips'])).toBe(
      'upper back, shoulders & chest',
    )
  })

  it('is null when there is nothing to say', () => {
    expect(regionWords([])).toBeNull()
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

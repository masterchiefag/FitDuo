import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * "Is this a block with sets in it?" is asked in fourteen places, and the
 * answer changed when the Activate block arrived.
 *
 * 2026-08-26: it was changed in the two obvious ones — the reducer and
 * `sessionPosition` — and missed in `playerStore`, which counts a session's
 * planned sets. The player then ran a relief session whose progress bar and
 * celebration card both read `8/0 sets`: eight logged against a plan the app
 * believed had none. Typecheck was green (the union is narrower, not wrong),
 * every unit test was green (none of them counts sets the way the store does),
 * and the browser walk found it in one screen.
 *
 * The durable fix is not "remember the third site". It is that the question has
 * exactly one implementation, `isWorkBlock`, and this fails the moment someone
 * writes a second one — which is cheaper than the walk that caught it.
 */
const SRC = join(__dirname, '..', 'src')
const PREDICATE_HOME = join('core', 'player', 'position.ts')

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return tsFilesUnder(p)
    return p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []
  })
}

describe('one work-block predicate', () => {
  it('nothing outside position.ts asks whether a block carries sets by listing kinds', () => {
    const violations: string[] = []
    for (const file of tsFilesUnder(SRC)) {
      if (file.endsWith(PREDICATE_HOME)) continue
      // Tests are exempt: asserting "this particular block is a superset" is a
      // claim about expected data, not a second implementation of the question.
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
      const source = readFileSync(file, 'utf8')
      source.split('\n').forEach((line, i) => {
        // A runtime check that names both kinds in one expression. Type-level
        // `Extract<Block, { kind: 'superset' | 'circuit' }>` is not this: it
        // names a shape, and a shape that excludes Activate is sometimes right.
        if (/kind === '(superset|circuit)'[^\n]*\|\|[^\n]*kind === '(superset|circuit)'/.test(line))
          violations.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(violations, 'use isWorkBlock from core/player/position').toEqual([])
  })
})

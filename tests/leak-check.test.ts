import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Proof-of-bite for the pre-post leak guard.
 *
 * grok-review.sh publishes Grok's output to a PR on a PUBLIC remote. If this
 * check silently stops matching, nothing fails — it just starts leaking. So the
 * tests that matter are the one asserting it CATCHES a real profile value, and
 * the one asserting it stays quiet for shared vocabulary: a guard that fires on
 * "dumbbell" blocks every post and gets deleted within a day.
 */
const ROOT = join(__dirname, '..')
const SCRIPT = join(ROOT, 'scripts', 'dev', 'lib', 'leak-check.mjs')

let sandbox: string

function check(reviewBody: string): string {
  const body = join(sandbox, 'review.md')
  writeFileSync(body, reviewBody)
  return execFileSync('node', [SCRIPT, body, '--root', sandbox], { encoding: 'utf8' }).trim()
}

beforeAll(() => {
  // A real repo layout: the checked-in template + catalog supply the shared
  // vocabulary, and a fake local profile supplies the personal values.
  sandbox = mkdtempSync(join(tmpdir(), 'fitduo-leak-'))
  mkdirSync(join(sandbox, 'content'))
  cpSync(join(ROOT, 'content', 'profiles.example.json'), join(sandbox, 'content/profiles.example.json'))
  cpSync(join(ROOT, 'content', 'catalog.json'), join(sandbox, 'content/catalog.json'))
  writeFileSync(
    join(sandbox, 'profiles.local.json'),
    JSON.stringify({
      people: [{ id: 'p1', name: 'Zebediah Quux', accent: 'amber', painAreas: ['shoulder'] }],
    }),
  )
  writeFileSync(join(sandbox, '.env'), 'VITE_SUPABASE_KEY="sk-not-a-real-key-2f9a"\n')
})

afterAll(() => rmSync(sandbox, { recursive: true, force: true }))

describe('leak check', () => {
  it('catches a real profile name', () => {
    expect(check('The generator mishandles Zebediah Quux on rest days.')).toBe('Zebediah Quux')
  })

  it('catches a secret from .env', () => {
    expect(check('Key sk-not-a-real-key-2f9a is inlined at build time.')).toBe(
      'sk-not-a-real-key-2f9a',
    )
  })

  it('matches case-insensitively', () => {
    expect(check('see ZEBEDIAH QUUX above')).toBe('Zebediah Quux')
  })

  // The false-positive half. These words are in the local profile too, but they
  // are shared vocabulary — present in the checked-in template or catalog.
  it('stays quiet for vocabulary that is also public', () => {
    expect(check('Shoulder mobility work needs a dumbbell; amber is the accent.')).toBe('')
  })

  it('stays quiet for an ordinary code review', () => {
    expect(check('`endsAt` should be absolute; the countdown accumulates drift.')).toBe('')
  })

  it('is quiet when there is no local profile at all', () => {
    const empty = mkdtempSync(join(tmpdir(), 'fitduo-leak-empty-'))
    const body = join(empty, 'review.md')
    writeFileSync(body, 'anything at all')
    expect(
      execFileSync('node', [SCRIPT, body, '--root', empty], { encoding: 'utf8' }).trim(),
    ).toBe('')
    rmSync(empty, { recursive: true, force: true })
  })
})

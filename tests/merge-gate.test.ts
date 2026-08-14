import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * Proof-of-bite for the merge gate.
 *
 * A gate that only ever passes is indistinguishable from a gate that matches
 * nothing and has silently decayed into a no-op. So the test that matters is
 * the one asserting it DENIES — and that it stays quiet for everything else,
 * because a gate that blocks ordinary work gets disabled within a day.
 */
const ROOT = join(__dirname, '..')
const HOOK = join(ROOT, 'scripts', 'dev', 'merge-gate-hook.mjs')

function decide(command: string): 'deny' | 'allow' {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    cwd: ROOT,
  })
  return out.includes('"permissionDecision":"deny"') ? 'deny' : 'allow'
}

describe('merge gate', () => {
  // These only deny while the review tail is unrecorded for HEAD — which is
  // the normal state during development, and the state these assert against.
  it('denies a PR merge', () => {
    expect(decide('gh pr merge 1 --squash --delete-branch')).toBe('deny')
  })

  it('denies a git merge chained behind another command', () => {
    expect(decide('npm test && git merge --ff-only feature')).toBe('deny')
  })

  it('allows a commit message that merely mentions merging', () => {
    expect(decide('git commit -m "note: gh pr merge comes later"')).toBe('allow')
  })

  it('allows ordinary commands', () => {
    expect(decide('npm run test')).toBe('allow')
    expect(decide('git status')).toBe('allow')
  })

  it('allows the merge-ready check itself', () => {
    expect(decide('scripts/dev/merge-ready.sh')).toBe('allow')
  })
})

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The chip-contract hook, proven to bite.
 *
 * Its own clause 6 says a guard trusted because it exists rather than shown to
 * fail is false coverage — so the guard gets the same treatment. This lives in
 * `tests/` and runs with `npm test` rather than sitting in a PR description,
 * because a proof nobody runs is the 2026-08-14 "test that could not fail"
 * again (docs/DECISIONS.md).
 *
 * The WIRING half is the load-bearing one. The first version of this hook was
 * reviewed with a four-case table that ran the script directly and passed —
 * while `settings.json` matched only the exact string
 * `mcp__ccd_session__spawn_task`, so a renamed MCP prefix meant the script was
 * never invoked at all and the body's suffix regex was dead defence. Testing
 * the script alone cannot see that (Grok, PR #32).
 */

const ROOT = join(__dirname, '..')
const HOOK = join(ROOT, '.claude', 'hooks', 'chip-rigor.mjs')

interface HookSettings {
  hooks?: {
    PreToolUse?: { matcher?: string; hooks?: { type?: string; command?: string }[] }[]
  }
}

const settings = JSON.parse(
  readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8'),
) as HookSettings

/** Everything the hook prints for one tool name ('' when it stays silent). */
function run(stdin: string): string {
  return execFileSync('node', [HOOK], { input: stdin, encoding: 'utf8' })
}

function contextFor(toolName: string): string {
  const out = run(JSON.stringify({ tool_name: toolName, tool_input: {} }))
  if (!out) return ''
  return JSON.parse(out).hookSpecificOutput.additionalContext as string
}

describe('the chip contract is wired to the tool call', () => {
  const entry = settings.hooks?.PreToolUse?.find((e) =>
    e.hooks?.some((h) => h.command?.includes('chip-rigor.mjs')),
  )

  it('is registered as a PreToolUse hook at all', () => {
    expect(entry, 'chip-rigor.mjs is not wired in .claude/settings.json').toBeDefined()
    expect(entry!.matcher, 'no matcher').toBeTruthy()
  })

  /**
   * The matcher is the real gate: Claude Code only runs the script when it
   * hits. An exact-string matcher makes the script's own suffix check
   * unreachable, so the two must agree about what a spawn looks like.
   */
  it.each([
    ['the tool as it is named today', 'mcp__ccd_session__spawn_task'],
    ['a renamed MCP server prefix', 'mcp__other__spawn_task'],
    ['no prefix at all', 'spawn_task'],
  ])('matches %s', (_label, toolName) => {
    const matcher = new RegExp(settings.hooks!.PreToolUse!.find((e) =>
      e.hooks?.some((h) => h.command?.includes('chip-rigor.mjs')),
    )!.matcher!)
    expect(matcher.test(toolName), `matcher does not reach ${toolName}`).toBe(true)
    expect(contextFor(toolName), `script stays silent for ${toolName}`).not.toBe('')
  })

  it('never fires on anything else', () => {
    for (const tool of ['Bash', 'Edit', 'Write', 'Task', 'mcp__ccd_session__dismiss_task']) {
      expect(contextFor(tool), tool).toBe('')
    }
  })

  it('is non-blocking on junk input — it must never stand between a chip and the agent', () => {
    expect(run('not json at all')).toBe('')
    expect(run('')).toBe('')
  })
})

describe('the contract still says the things it exists to say', () => {
  const context = contextFor('mcp__ccd_session__spawn_task')

  /**
   * One assertion per clause, so deleting a clause goes red here rather than
   * silently shipping a weaker contract — the clauses ARE the hook, the rest is
   * plumbing. Phrases, not whole sentences: rewording is allowed, dropping the
   * idea is not.
   */
  it.each([
    ['a chip is a hypothesis, not an order', 'HYPOTHESIS, NOT AN ORDER'],
    ['the cold session may disagree and stop', 'expected to disagree'],
    ['"not worth doing" is a complete answer', 'Not worth doing'],
    ['cut from origin/main', 'origin/main'],
    ['quoted facts are snapshots', 'SNAPSHOT'],
    ['check for a fix already in flight', 'gh pr list'],
    ['proven versus assumed', 'PROVEN vs ASSUMED'],
    ['a premise probe', 'PREMISE PROBE'],
    ['state the confidence', 'CONFIDENCE'],
    ['classify bug versus design tradeoff', 'design tradeoff'],
    ['proof of bite for new guards', 'PROOF-OF-BITE'],
    ['frames come from walk mode only', '--mode walk'],
    ['the owner decides the merge', 'DO NOT MERGE'],
  ])('keeps the clause: %s', (_label, phrase) => {
    expect(context).toContain(phrase)
  })
})

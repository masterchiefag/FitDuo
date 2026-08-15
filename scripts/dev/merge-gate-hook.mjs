#!/usr/bin/env node
// PreToolUse(Bash) gate: deny a merge unless the review tail ran at this sha.
//
// This is the mechanical half of the workflow in CLAUDE.md. The prose version
// was skipped within an hour of being written (docs/DECISIONS.md, 2026-08-14),
// which is the documented trigger for escalating a rule into a gate.
//
// Fails OPEN on any internal error: a broken gate must not block real work,
// it just stops being a gate (and says so).
import { execFileSync } from 'node:child_process'

// Match a merge only in COMMAND position — start of the line, or right after a
// shell separator. A substring match also fires on commands that merely mention
// merging inside quotes (a commit message, an echoed test fixture), which
// blocks legitimate work; that false positive showed up the first time this
// gate ran.
const MERGE_RE = /(?:^|[;&|]\s*|\n\s*)(?:gh\s+pr\s+merge|git\s+merge)\b/

let raw = ''
process.stdin.on('data', (c) => (raw += c))
process.stdin.on('end', () => {
  let decision = { continue: true }
  try {
    const input = JSON.parse(raw || '{}')
    const command = input?.tool_input?.command ?? ''
    if (MERGE_RE.test(command)) {
      try {
        execFileSync('bash', ['scripts/dev/merge-ready.sh', '--quiet'], { stdio: 'pipe' })
      } catch (err) {
        const detail = String(err?.stderr ?? '').trim()
        decision = {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'Merge blocked — the review tail has not run against this commit.\n' +
              detail +
              '\n\nRun the missing steps (grok review, /code-review, full suite), record each ' +
              'with scripts/dev/record-step.sh, then `git push` and confirm HEAD == @{u} ' +
              'before merging — the records bind to your local sha and the merge takes the ' +
              'remote tip. Do not bypass this by editing the record files.',
          },
        }
      }
    }
  } catch {
    // Fail open — never let a hook bug wedge the session.
  }
  process.stdout.write(JSON.stringify(decision))
})

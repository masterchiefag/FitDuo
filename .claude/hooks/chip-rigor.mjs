#!/usr/bin/env node
// PreToolUse gate on `spawn_task` — the chip contract, fired by the ACT of
// spawning rather than by the agent remembering to apply it.
//
// ASSUMES the model writes thin chips unless prompted at spawn time. Earned
// 2026-08-25: three chips fired that session (warm-up relevance, walk skill,
// leg mobility content) carried no freshness contract, no proven-vs-assumed
// split, and no permission to disagree — and were only rewritten because the
// owner pointed at ~/dev/sherlock mid-conversation. The next session starts
// cold and would fire the thin version again. A process that depends on recall
// is not a process.
//
// Borrowed from sherlock's .claude/hooks/spawn-task-chip-rigor.mjs, cut to what
// FitDuo has actually been bitten by. Deliberately NOT imported: sherlock's
// other 21 hooks, proactive-invariants rows, the neuron log, incident docs —
// each of those was earned there by a dated recurrence, and FitDuo has no such
// record. Importing them would break sherlock's own discipline as much as
// CLAUDE.md's "name the date it bit".
//
// EVICTION: it appends one line per firing to .claude/hooks/chip-rigor.log
// (gitignored). `wc -l` it. A gate nobody can measure is one nobody can delete,
// and this repo has cut process once already.
//
// Contract: stdin is JSON with `tool_name`; stdout is PreToolUse
// additionalContext. NON-blocking — any parse error, or any other tool, exits 0
// silently. It must never stand between the agent and a legitimate chip.

import { appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => {
  raw += c
})
process.stdin.on('end', () => {
  let toolName = ''
  try {
    toolName = JSON.parse(raw).tool_name || ''
  } catch {
    process.exit(0) // unparseable → no-op, never block
  }
  // Suffix match, so renaming the MCP server prefix cannot silently un-wire it.
  if (!/(^|__)spawn_task$/.test(toolName)) process.exit(0)

  try {
    appendFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'chip-rigor.log'),
      `${new Date().toISOString()}\n`,
    )
  } catch {
    /* telemetry must never break the gate */
  }

  const additionalContext = [
    'CHIP CONTRACT — you are spawning a chip. That session starts COLD: it carries',
    'none of your context and will do only what your prompt says. Put these IN the',
    'prompt; this reminder does not do it for you.',
    '',
    '1. A CHIP IS A HYPOTHESIS, NOT AN ORDER. Say so in the prompt. Tell that session',
    '   it is expected to disagree — with the diagnosis, the fix, the scope, or with',
    '   whether the work is worth doing at all — and to STOP and ask the owner rather',
    '   than implement something it thinks is wrong. He would rather be asked than',
    '   surprised, prefers the simplest thing that works, and wants to make the',
    '   over-engineering call himself. "Not worth doing, here is why" is a complete',
    '   and welcome deliverable.',
    '',
    '2. FRESHNESS. The chip fires against a main that has moved. Bake in, as its',
    '   first steps: `git fetch origin && git checkout -b <branch> origin/main` — cut',
    '   from origin/main, never from whatever HEAD the tree is parked on. Branch in',
    '   the worktree the chip is already given; do NOT add a second one, because two',
    '   checkouts want the same :5173 and this repo has been bitten by that. Then',
    '   `gh pr list --state all --search "<keyword>"`; already landed or in flight',
    '   means STOP and report. Every path, line number, count and quote you write is',
    '   a SNAPSHOT — say so, and tell it to re-read before trusting.',
    '',
    '3. PROVEN vs ASSUMED. A chip staples a real symptom to an unverified cause, and',
    '   the true symptom lends the cause false credibility. Every causal claim carries',
    '   the command that proved it AND its output, or is labelled ASSUMED. Include a',
    '   PREMISE PROBE: the single cheapest command that confirms the core claim, run',
    '   first — a red or absent premise means re-derive, not build. Never write',
    '   "confirmed, do not re-derive".',
    '',
    '4. CONFIDENCE. Say how strong this chip is and what would make it not worth',
    '   doing. A cold session cannot calibrate urgency on its own, and without this',
    '   every chip reads equally urgent.',
    '',
    '5. CLASSIFY. A bug (behaviour diverges from intent, one clearly-right target) can',
    '   be an implement-it chip. A design tradeoff (works as coded, several defensible',
    '   answers) must ask for a PROPOSAL agreed with the owner first — do not spawn a',
    '   build-it chip for a decision he has not seen. Many chips are a proven bug',
    '   wrapped around an unsettled design choice: split them explicitly.',
    '',
    '6. PROOF-OF-BITE for any guard or test it adds: show it RED against the broken',
    '   thing before the fix. A guard trusted because it exists rather than shown to',
    '   fail is false coverage.',
    '',
    "7. FitDuo's non-negotiables, which a cold session will not infer: read CLAUDE.md",
    '   first; pure `src/core` stays pure and byte-deterministic; typecheck + tests +',
    '   e2e green; open the PR THEN one round of scripts/dev/grok-review.sh, answering',
    '   findings in a PR comment; DO NOT MERGE — the owner decides. Any attached frame',
    '   comes from `npm run dev -- --mode walk`, never plain dev: the remote is PUBLIC',
    "   and real profiles publish the household's names and loads.",
  ].join('\n')

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext },
    }),
  )
  process.exit(0)
})

#!/usr/bin/env node
// Does this text quote local personal data? Prints the first offending value,
// or nothing. Used by grok-review.sh to fail CLOSED before posting a review to
// a PR on a PUBLIC remote (Grok runs with --always-approve and can read
// gitignored files; this repo has shipped personal data once already).
//
// Usage: node scripts/dev/lib/leak-check.mjs <file> [--root <dir>]
//
// A value counts as personal only if it does NOT also appear in the checked-in
// template or catalog: otherwise shared vocabulary ("dumbbell", "shoulder")
// blocks every post, and a check that cries wolf gets deleted within a day.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const rootFlag = args.indexOf('--root')
const ROOT = rootFlag === -1 ? process.cwd() : args[rootFlag + 1]
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root')

const read = (p) => {
  try {
    return readFileSync(join(ROOT, p), 'utf8')
  } catch {
    return ''
  }
}

const publicText = (
  read('content/profiles.example.json') + read('content/catalog.json')
).toLowerCase()

const needles = new Set()
const walk = (v) => {
  if (typeof v === 'string') {
    const s = v.trim()
    // <3 chars matches everywhere ("p1", "kg"); template values are shared vocabulary.
    if (s.length >= 3 && !publicText.includes(s.toLowerCase())) needles.add(s)
  } else if (Array.isArray(v)) v.forEach(walk)
  else if (v && typeof v === 'object') Object.values(v).forEach(walk)
}

try {
  walk(JSON.parse(read('profiles.local.json')))
} catch {
  // Absent or malformed: nothing local to leak from it.
}
for (const line of read('.env').split('\n')) {
  const m = line.match(/^\s*[A-Za-z0-9_]+\s*=\s*(.+)$/)
  if (m) walk(m[1].trim().replace(/^["']|["']$/g, ''))
}

const body = (target ? readFileSync(target, 'utf8') : '').toLowerCase()
process.stdout.write([...needles].find((n) => body.includes(n.toLowerCase())) ?? '')

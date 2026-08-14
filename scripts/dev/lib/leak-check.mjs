#!/usr/bin/env node
// Does this text quote local personal data? Prints the first offending value,
// or nothing. Used by grok-review.sh to fail CLOSED before posting a review to
// a PR on a PUBLIC remote (Grok runs with --always-approve and can read
// gitignored files; this repo has shipped personal data once already).
//
// Usage: node scripts/dev/lib/leak-check.mjs <file> [--root <dir>]
//
// Exit 0 = scanned, nothing personal found. Exit 2 = could not scan (bad usage,
// unreadable file). The caller must treat anything non-zero as "do not post":
// the one failure mode a guard like this must never have is silent approval.
//
// Only STRING values are scanned. Bare numbers (weights) would false-positive on
// every rep count and set target in a review; they are out of scope by design.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const rootFlag = args.indexOf('--root')
const ROOT = rootFlag === -1 ? process.cwd() : args[rootFlag + 1]
const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root')

const die = (msg) => {
  process.stderr.write(`leak-check: ${msg}\n`)
  process.exit(2)
}

if (!target) die('no file to scan — usage: leak-check.mjs <file> [--root <dir>]')
if (!ROOT) die('--root given without a directory')

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

// Whole-word, not substring. A substring test whitelists any personal value that
// happens to sit inside catalog prose — measured against the real catalog, that
// silently exempted the names Sam, Ben, Ron, Eve, Tim, Lou and Art ("same",
// "bend", "iron", "every", "time", "cloud", "start"). Names are the whole point.
const word = (s) => new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu')
const isPublic = (s) => word(s).test(publicText)

const needles = new Set()
const walk = (v) => {
  if (typeof v === 'string') {
    const s = v.trim()
    // <3 chars matches everywhere ("p1", "kg"); template values are shared vocabulary.
    if (s.length >= 3 && !isPublic(s)) needles.add(s)
  } else if (Array.isArray(v)) v.forEach(walk)
  else if (v && typeof v === 'object') Object.values(v).forEach(walk)
}

try {
  walk(JSON.parse(read('profiles.local.json')))
} catch {
  // Absent or malformed: nothing local to leak from it.
}

// Every gitignored env file, not just `.env` — .gitignore covers `.env.*`, and
// Vite's own convention puts real values in `.env.local`.
let envFiles = []
try {
  envFiles = readdirSync(ROOT).filter((f) => /^\.env(\..+)?$/.test(f) && f !== '.env.example')
} catch {
  // Unreadable root: publicText is empty too, so nothing is whitelisted away.
}
for (const file of envFiles) {
  for (const line of read(file).split('\n')) {
    const m = line.match(/^\s*[A-Za-z0-9_]+\s*=\s*(.+)$/)
    if (m) walk(m[1].trim().replace(/^["']|["']$/g, ''))
  }
}

let body
try {
  body = readFileSync(target, 'utf8').toLowerCase()
} catch {
  die(`cannot read ${target}`)
}
process.stdout.write([...needles].find((n) => word(n).test(body)) ?? '')

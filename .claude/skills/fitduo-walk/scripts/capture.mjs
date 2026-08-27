#!/usr/bin/env node
// Capture a FitDuo walk frame from the running `fitduo-walk` server.
//
//   node scripts/capture.mjs --out /tmp/fitduo-frames/today.png
//   node scripts/capture.mjs --until "to go" --viewport mobile --theme dark --out /tmp/fitduo-frames/rest.png
//
// --until matches the whole page, so pick copy unique to the screen: "rest" also
// appears in form cues and lands on the work screen. Frames go outside the repo;
// scripts/publish.sh is what puts them on GitHub. See SKILL.md.
//
// Refuses to run against anything but a walk-mode server: the remote is public
// and dev mode injects profiles.local.json, so a frame from `npm run dev`
// publishes the household's names and loads.

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ORIGIN = 'http://localhost:5173' // port 5173 or nothing — localStorage is per-origin
const BANNER = 'example profiles' // rendered by TodayScreen when profiles are NOT real
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 375, height: 812 } }
const CLOCK_RATE = 30 // 250ms tick × 30 = 7.5s < LATE_TIMER_GRACE_MS (15s), so the reducer never pauses
// The required interactions, in the order a session offers them. Regexes, not
// strings: "I’m ready →" carries a typographic apostrophe. Rests are NOT skipped —
// the fast clock burns them, so the walk stays faithful. "Finish here" is last
// and shares the block gate with "Continue →", so it is only ever clicked on the
// final block, which is exactly what ends a session.
const ADVANCE = [
  /^Start duo workout/,
  /^Start (warm-up )?→$/, // the session opening — it holds until somebody taps
  /^Start now →$/,
  /ready →$/,
  /^Done ✓$/,
  /^Continue →$/,
  /^Finish here$/,
]
// A whole 55-minute session at K=30 is ~110s of real time and well under 1000
// steps (one click at 150ms, or one 400ms wait while a timer burns). Both
// numbers are runaway guards, not budgets: hitting either means the driver is
// stuck on a screen, not that the session is long.
const MAX_STEPS = 1500
const DRIVE_TIMEOUT_MS = 300_000

function die(msg, code = 1) {
  console.error(`capture: ${msg}`)
  process.exit(code)
}

function parseArgs(argv) {
  const out = { viewport: 'desktop', theme: 'light' }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    const val = argv[i + 1]
    if (!key || val === undefined) die(`bad argument near "${argv[i]}"`)
    out[key] = val
  }
  return out
}

// @playwright/test lives in the MAIN repo's node_modules; a worktree has none.
// --git-common-dir points at the main .git even from inside a worktree.
function loadPlaywright() {
  const here = dirname(fileURLToPath(import.meta.url))
  let gitCommon
  try {
    gitCommon = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: here,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    die(`cannot locate the repo from ${here} — run capture.mjs from its checked-out path`)
  }
  const entry = resolve(gitCommon, '..', 'node_modules/@playwright/test/index.mjs')
  if (!existsSync(entry)) die(`@playwright/test not found at ${entry} — run npm install in the main repo`)
  return createRequire(import.meta.url)(entry)
}

// Virtual clock as an ACCUMULATOR, not a multiplier of elapsed time, so the rate
// can change mid-run without the clock jumping. Installed via addInitScript so
// it survives reloads.
function clockScript(rate) {
  return `(() => {
    const RealDate = Date
    const realNow = RealDate.now.bind(RealDate)
    let last = realNow()
    let virt = realNow()
    let k = ${rate}
    const tick = () => { const r = realNow(); virt += (r - last) * k; last = r; return virt }
    function FakeDate(...args) {
      if (!(this instanceof FakeDate)) return RealDate(...args)
      return args.length === 0 ? new RealDate(tick()) : new RealDate(...args)
    }
    FakeDate.prototype = RealDate.prototype
    FakeDate.now = tick
    FakeDate.parse = RealDate.parse
    FakeDate.UTC = RealDate.UTC
    globalThis.Date = FakeDate
    globalThis.__setClockRate = (r) => { tick(); k = r } // 0 freezes before a screenshot
  })()`
}

const args = parseArgs(process.argv.slice(2))
if (!args.out) die('--out <path.png> is required')
const viewport = VIEWPORTS[args.viewport]
if (!viewport) die(`--viewport must be desktop or mobile (got "${args.viewport}")`)
if (!['light', 'dark'].includes(args.theme)) die(`--theme must be light or dark (got "${args.theme}")`)

const { chromium } = loadPlaywright()
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport,
  colorScheme: args.theme,
  deviceScaleFactor: 1,
})
await context.addInitScript(clockScript(CLOCK_RATE))
const page = await context.newPage()

try {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
} catch {
  await browser.close()
  die(`no server at ${ORIGIN} — start it with: npm run dev -- --mode walk`, 2)
}

// THE HARD RULE. Trust the rendered page, not the flag the caller claims to
// have passed: a plain `npm run dev` already sitting on 5173 would otherwise
// sail through and publish real names and loads to a public branch.
await page.waitForSelector('h1', { timeout: 15_000 }).catch(() => {})
const today = (await page.evaluate(() => document.body.innerText)).toLowerCase()
if (!today.includes(BANNER)) {
  await browser.close()
  die(
    `REFUSING to capture: ${ORIGIN} is not a walk-mode server.\n` +
      `  Today did not render the "Example profiles — not your data" banner, which means\n` +
      `  real profiles are loaded and a frame would publish the household's names and loads.\n` +
      `  Restart the server with:  npm run dev -- --mode walk`,
    2,
  )
}

if (args.until) {
  const target = args.until.toLowerCase()
  let reached = false
  const deadline = Date.now() + DRIVE_TIMEOUT_MS
  for (let step = 0; step < MAX_STEPS && !reached && Date.now() < deadline; step++) {
    const text = (await page.evaluate(() => document.body.innerText)).toLowerCase()
    if (text.includes(target)) {
      reached = true
      break
    }
    let clicked = false
    for (const label of ADVANCE) {
      const button = page.getByRole('button', { name: label }).first()
      if (await button.isVisible().catch(() => false)) {
        await button.click().catch(() => {})
        clicked = true
        break
      }
    }
    await page.waitForTimeout(clicked ? 150 : 400) // no button? a timer is running; the fast clock burns it
  }
  if (!reached) {
    await browser.close()
    die(`never reached "${args.until}" — gave up after ${MAX_STEPS} steps / ${DRIVE_TIMEOUT_MS / 1000}s`)
  }
}

await page.evaluate(() => globalThis.__setClockRate?.(0)) // freeze, so the timer reads the same in every frame
await page.waitForTimeout(300)

mkdirSync(dirname(resolve(args.out)), { recursive: true })
// NOT fullPage: the app scrolls an inner <main>, not the document, so fullPage
// just returns the viewport anyway. Scroll <main> first if you need what's below.
await page.screenshot({ path: resolve(args.out) })
console.log(`captured ${args.out}  (${args.viewport} ${args.theme}${args.until ? ` @ "${args.until}"` : ''})`)

await browser.close()

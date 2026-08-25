---
name: fitduo-walk
description: Captures FitDuo walk screenshots and attaches them to a PR. Use when a PR touches UI, generator, content or copy and CLAUDE.md step 5 needs a browser walk with frames attached; when screenshots are needed at desktop 1280x800 and mobile 375x812 in light and dark; when driving the player past warm-ups, rest timers or block gates would otherwise take a real 55 minutes; or when frames must reach a PR body and `gh` cannot upload images. Enforces walk mode so real names and loads are never published.
---

# Walking FitDuo and attaching the frames

Two commands. Both drive an **already-running** walk server on port 5173.

Start it from the `fitduo-walk` config in `.claude/launch.json` — under Claude
Code that means the preview tooling rather than a shell. The config runs the
command CLAUDE.md documents, which is also what `scripts/capture.mjs` prints
when nothing is listening:

```
npm run dev -- --mode walk
```

**If 5173 is already held, find out whose tree it serves before reusing it.**
Work here happens in worktrees, and a walk server started from a different one
is still bound to 5173 — reuse it and the frames show that branch's code, not
yours. The banner check proves walk *mode*, never which checkout:

```
lsof -a -p "$(lsof -ti :5173 | head -1)" -d cwd -Fn | sed -n 's/^n//p'
```

Reuse it only if that path is this checkout. Otherwise stop it and start
`fitduo-walk` here — never work around a held port by changing port.

## 1. Capture

```
node .claude/skills/fitduo-walk/scripts/capture.mjs --out /tmp/fitduo-frames/today.png
node .claude/skills/fitduo-walk/scripts/capture.mjs --until "to go" --viewport mobile --theme dark --out /tmp/fitduo-frames/rest-mobile-dark.png
```

**Write frames outside the repo.** `scripts/publish.sh` is what puts them on GitHub, via
a branch that never merges; frames sitting in the working tree just wait for the
next `git add` to commit binaries onto the PR branch — the exact thing the
orphan branch exists to avoid. (`frames/` is gitignored as a backstop.)

- `--out` (required) — png path, directories created for you.
- `--until "<on-screen text>"` — drive the app until the page contains this text
  (case-insensitive; `text-transform: uppercase` comes back uppercase, the script
  lower-cases both sides). Omit to shoot Today.

  **It is a substring of the whole page, so pick copy unique to the screen you
  want.** `--until "rest"` looks obvious and is wrong: two catalog cues contain
  the word (`"Lower until your upper arms rest on the floor"` on Dumbbell Floor
  Press, `"palms resting on the floor"` on Prone Chest Lift), so on any day those
  come up you capture the *work* screen and file it as the rest frame. The rest
  screen's own copy is `"… 3 sets to go"` — match `"to go"`, which appears
  nowhere else in the app or the catalog. Other safe targets: `"Continue →"` for
  a block gate, `"Done ✓"` for a work screen.
- `--viewport desktop|mobile` — 1280×800 or 375×812. Both are required by CLAUDE.md.
- `--theme light|dark` — both are required by CLAUDE.md.

CLAUDE.md wants the **Today frame** attached too, as the receipt that the walk
ran in walk mode: it carries the red "Example profiles" banner.

## 2. Publish

```
.claude/skills/fitduo-walk/scripts/publish.sh /tmp/fitduo-frames/ pr-<number>
```

**Use the PR number as the suffix.** The push is a force-push, so two walks that
pick the same suffix overwrite each other and 404 the older PR's images.

Pushes `walk-frames/<suffix>` and prints `![...](https://raw.githubusercontent.com/...)`
lines to paste into the PR body. The branch never merges, so `main` stays free
of binaries; deleting it later only breaks the images. Accepted by the owner on
2026-08-16 (PR #21) with "delete the branch whenever".

## The hard rule: walk mode or nothing

`vite.config.ts` injects `profiles.local.json` when `mode === 'development'`, and
**the GitHub remote is public**. A frame from a plain `npm run dev` server
publishes the household's real names and loads — *gitignored is not the same as
unpublished* (2026-08-16). A Grok prompt can be told to anonymise; a screenshot
cannot.

`scripts/capture.mjs` therefore checks the rendered page, not the flag you believe you
passed: it loads Today and **exits 2 unless the "Example profiles — not your
data" banner is there**. A dev server already sitting on 5173 fails this. Do not
add an override.

Port 5173 or nothing — `localStorage` is keyed per origin, so a fallback to
:5174 is an app with no streak, no XP and an empty History.

## Why the clock is an accumulator

A 55-minute session has to walk in minutes. `scripts/capture.mjs` overrides the page
clock with `virt += (real() - last) * K` — an **accumulator**, not a multiplier
of elapsed time, so the rate can change mid-run without the clock jumping. It
goes in via `context.addInitScript` so it survives reloads.

`K = 30` by default and the script sets `K = 0` before every screenshot, so a
frozen timer reads the same in every frame. K up to ~50 is safe: the reducer
pauses when a tick lands more than `LATE_TIMER_GRACE_MS` (15s, `src/core/player/reducer.ts:30`)
past a deadline, and the jump is one 250ms tick × K.

## Gotchas that cost time on every rebuild

- **`@playwright/test` resolves from the main repo's `node_modules`, never from a
  worktree** — a worktree has none. `scripts/capture.mjs` finds it via
  `git rev-parse --git-common-dir`; don't hardcode a path.
- **`fullPage: true` is useless** — the app scrolls an inner `<main>`, not the
  document, so full-page equals viewport. To shoot what is below the fold, set
  `document.querySelector('main').scrollTop` first.
- Seeding history for a frame? Write `localStorage` + `fetch('/content/catalog.json')`,
  dated **4+ days back**, or the no-repeat window drops those movements from
  today's plan.
- Driving one context to completion and starting a second session the same day
  yields a **warm-store** frame (same seed, same movements, but `lastTime`
  populated) next to the cold ones.

## What this skill does not do

- **It does not start the server.** Bring up `fitduo-walk` first; `scripts/capture.mjs`
  only drives a server that is already listening on 5173.
- **It does not seed history.** A frame that needs streaks, XP or a warm store
  needs that written first (see the gotchas below); the script always starts
  from a cold, fresh browser context.
- **It does not run the 33% check or write the PR body.** It produces PNGs and
  prints markdown lines. Downscaling is still **required** — see below; what
  stays a judgement call is only which frames tell the story and how the walk
  paragraph reads.
- **It does not capture below the fold.** One viewport frame per invocation.

## The one-third-scale check

The legibility criterion (SESSIONS.md finding 2, 2026-08-25) is checked by
downscaling each 1280×800 frame and reading the result:

```
sips -Z 427 in.png --out in-33.png
```

Post **both** sizes, so the criterion is visible in the PR rather than asserted.

## Iterating on this skill

`evals/trigger-evals.json` holds the prompts this skill should and should not fire
on. When it triggers on the wrong thing, fix the `description` and move the line
to the list it belongs in — the description is the only part always in context,
so it is the whole of the triggering behaviour.

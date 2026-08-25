---
name: fitduo-walk
description: Capture FitDuo browser-walk screenshots and attach them to a PR. Use whenever a PR touches UI, generator, content or copy — CLAUDE.md step 5 requires a walk (desktop then 375, light and dark) with frames attached. Covers driving the player with an accelerated clock, and publishing frames via an orphan branch because `gh` cannot upload images.
---

# Walking FitDuo and attaching the frames

Two commands. Both assume the walk server is already up on **port 5173**:

```
npm run dev -- --mode walk
```

## 1. Capture

```
node .claude/skills/fitduo-walk/capture.mjs --out /tmp/fitduo-frames/today.png
node .claude/skills/fitduo-walk/capture.mjs --until "to go" --viewport mobile --theme dark --out /tmp/fitduo-frames/rest-mobile-dark.png
```

**Write frames outside the repo.** `publish.sh` is what puts them on GitHub, via
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
.claude/skills/fitduo-walk/publish.sh /tmp/fitduo-frames/ pr-33
```

**Use the PR number as the suffix.** The push is a force-push, so two walks that
pick the same suffix overwrite each other and 404 the older PR's images.

Pushes `walk-frames/my-branch` and prints `![...](https://raw.githubusercontent.com/...)`
lines to paste into the PR body. The branch never merges, so `main` stays free
of binaries; deleting it later only breaks the images. Accepted by the owner on
2026-08-16 (PR #21) with "delete the branch whenever".

## The hard rule: walk mode or nothing

`vite.config.ts` injects `profiles.local.json` when `mode === 'development'`, and
**the GitHub remote is public**. A frame from a plain `npm run dev` server
publishes the household's real names and loads — *gitignored is not the same as
unpublished* (2026-08-16). A Grok prompt can be told to anonymise; a screenshot
cannot.

`capture.mjs` therefore checks the rendered page, not the flag you believe you
passed: it loads Today and **exits 2 unless the "Example profiles — not your
data" banner is there**. A dev server already sitting on 5173 fails this. Do not
add an override.

Port 5173 or nothing — `localStorage` is keyed per origin, so a fallback to
:5174 is an app with no streak, no XP and an empty History.

## Why the clock is an accumulator

A 55-minute session has to walk in minutes. `capture.mjs` overrides the page
clock with `virt += (real() - last) * K` — an **accumulator**, not a multiplier
of elapsed time, so the rate can change mid-run without the clock jumping. It
goes in via `context.addInitScript` so it survives reloads.

`K = 30` by default and the script sets `K = 0` before every screenshot, so a
frozen timer reads the same in every frame. K up to ~50 is safe: the reducer
pauses when a tick lands more than `LATE_TIMER_GRACE_MS` (15s, `src/core/player/reducer.ts:30`)
past a deadline, and the jump is one 250ms tick × K.

## Gotchas that cost time on every rebuild

- **`@playwright/test` resolves from the main repo's `node_modules`, never from a
  worktree** — a worktree has none. `capture.mjs` finds it via
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

## The one-third-scale check

The legibility criterion (SESSIONS.md finding 2, 2026-08-25) is checked by
downscaling each 1280×800 frame and reading the result:

```
sips -Z 427 in.png --out in-33.png
```

Post **both** sizes, so the criterion is visible in the PR rather than asserted.

# FitDuo 💪

A Duolingo-style guided dumbbell workout PWA built for **exactly two people** — a couple working out at home, sharing one laptop.

The app is the trainer: it generates a fresh ~50–60 min session every day, guides both people through it side by side with timers and audio cues, and turns showing up into streaks, XP, levels, and achievements.

## Why it exists

We follow an online trainer with dumbbells at home. Great workouts, zero personalization and zero reason to come back tomorrow. FitDuo keeps the guidance but adds what a video can't: targets that adapt to each person's own weights and feedback, a shared session where both of us get credit, and Duolingo's engagement loop.

## What it does

- **Daily generated workouts** — seeded and deterministic, with day-type rotation (push / pull / legs / upper / full body), rolling-week muscle balance, and a no-repeat window so nothing goes stale.
- **Duo sessions** — one shared flow on one screen, each person's own weight and rep targets shown side by side; one tap logs the set for both at their own numbers.
- **Per-person progression** — "too easy / just right / too hard" after each block moves each person's weights independently, bounded by the dumbbells they actually own.
- **Gamification** — XP, levels, streaks (rest days are neutral; one automatic freeze per week), and 13 achievements — all *derived* from an append-only event log, never stored as counters.
- **Offline-first PWA** — the full session runs with no network; the app shell and all exercise media are precached.

## Stack

React 19 + TypeScript (strict) · Vite · Tailwind v4 · Zustand · Dexie · Supabase (append-only event store + RLS) · Workbox · vitest + fast-check + Playwright

The interesting constraint: `src/core/` is **pure** — the workout generator, the session state machine, and all gamification math have no React, no I/O, and no `Date.now()`/`Math.random()`. That's what makes them exhaustively testable, and a lint-enforced test keeps it honest.

## Commands

```bash
npm run dev        # dev server on :5173
npm run test       # vitest (core logic incl. property tests)
npm run typecheck  # tsc -b
npm run e2e        # Playwright smokes
npm run build      # typecheck + production build (PWA output)
```

## Docs

- [docs/PLAN.md](docs/PLAN.md) — the full product + architecture plan and milestone roadmap
- [CLAUDE.md](CLAUDE.md) — architecture map and conventions

## Credits

Exercise data and demonstration images from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense / public domain). Movement patterns, difficulty tiers, rep ranges, tempos, and coaching cues are our own authoring.

# FitDuo

Duolingo-style guided dumbbell workout PWA for exactly two users (a couple sharing one laptop during workouts). Plan: [docs/PLAN.md](docs/PLAN.md) (canonical; mirror of `~/.claude/plans/i-want-to-experiment-piped-emerson.md`).

**Start here:** [docs/PLAN.md](docs/PLAN.md) for what to build next (sequencing is at "Revised sequencing"); [docs/DECISIONS.md](docs/DECISIONS.md) for why things are the way they are, and the rule for where new learnings go.

**Execution model:** Opus executes milestones from docs/PLAN.md, **one change at a time**. Milestone tail, in order: `npm run typecheck && npm run test -- --run && npm run e2e` → **verify the change in a real browser** → `/code-review` (medium) → Grok second opinion `scripts/dev/grok-review.sh diff <range>` → fix findings → commit. Plan revisions get a Grok pass *before* execution starts — it has twice caught design bugs that would have shipped.

**Two standing filters on any new request:**
- *Is it generic?* Express it as content or a rule (a catalog field, a typed input, one entry in the adjuster pipeline), never a branch keyed to one person's circumstances. See PLAN §A0/A1.
- *Is it a lesson?* Encode it at the cheapest durable rung — code fix > regression test > area doc > this file. Prose in CLAUDE.md is the most expensive option, not the default.

## Commands

- `npm run dev` — Vite dev server (port 5173)
- `npm run test` — vitest (core logic incl. property tests); `npm run test -- --run` for one-shot
- `npm run typecheck` — `tsc -b` (strict, noUncheckedIndexedAccess)
- `npm run lint` — oxlint
- `npm run e2e` — Playwright smokes (starts dev server itself)
- `npm run build` — typecheck + production build (includes PWA/service-worker output)

## Architecture

Pure deterministic core wrapped in boring infra. Server (Supabase, from M4) is an append-only event store; XP/streaks/achievements are always **derived** from the event log, never stored.

| Path | What | Rule |
|---|---|---|
| `src/core/` | generator, player reducer, gamification, catalog types, date math | **PURE. May import only `src/core` + zod. No React/Dexie/Supabase/DOM, no `Date.now()`/`Math.random()` in logic** — enforced by `tests/core-purity.test.ts` |
| `src/infra/` | Supabase client, Dexie, outbox sync, audio, wakelock | all I/O lives here |
| `src/app/` | React screens/components/stores | thin projection of core state |
| `src/sw.ts` | Workbox injectManifest service worker | update via prompt, never mid-workout |
| `content/` | curated exercise catalog.json + WebP media | zod-validated; content changes are a deploy, not a migration |
| `e2e/` | Playwright specs | golden-path smokes only |

## Conventions & gotchas

- All dates in streak/schedule logic are **local `YYYY-MM-DD` strings** via `src/core/dates.ts` — never UTC, never cross-day `Date` arithmetic.
- Timers are wall-clock anchored: state stores absolute `endsAt`; UI renders `endsAt − now`. Never accumulate countdowns.
- Duo sessions: one shared flow; a single `SET_DONE` logs a set for every participant at their own target.
- Client-generated UUIDv7 keys on all event rows → sync is idempotent upsert.
- Workout generation is seeded (`household|date|version`) and must stay byte-deterministic: sort candidates `(score desc, id asc)` before any PRNG pick.
- Verify UI at desktop viewport first (the real workout device is a laptop in Chrome), then 375×812 responsive pass; check light + dark.
- **A green suite is not a working app.** The unit tests cover the pure core; they cannot see a session that silently completes itself in the browser (this exact bug shipped once — see DECISIONS.md). Drive the real UI before calling a change done.
- Personal data (names, weights, pain areas, equipment) lives in gitignored `profiles.local.json`, never in the repo — **the GitHub remote is public**. `content/profiles.example.json` is the checked-in template.

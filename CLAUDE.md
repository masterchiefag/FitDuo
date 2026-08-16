# FitDuo

Duolingo-style guided dumbbell workout PWA for exactly two users (a couple sharing one laptop during workouts). Plan: [docs/PLAN.md](docs/PLAN.md). History and hard-won lessons: [docs/DECISIONS.md](docs/DECISIONS.md).

**Progress means shipped product.** A session that ends with no product diff should be the exception, not the norm. Process changes (this file, scripts, templates) are near-frozen: propose them to the user, don't build them.

## Workflow

1. Branch → build → **verify in a real browser** — a green suite is not a working app; the one bug that shipped was caught by driving the UI, not by review (docs/DECISIONS.md).
2. `npm run typecheck && npm run test -- --run && npm run e2e` green.
3. **One round of `scripts/dev/grok-review.sh diff` — mandatory, every PR.** Take what's real, decline the rest *with the reason in the PR*, ship. One round, not a loop: reviewer silence is never the goal, a working app is. Verification and review catch different things — the browser catches behaviour nobody modelled, review catches a number whose only witness is the code that computed it (2026-08-16, docs/DECISIONS.md).
4. Open a PR with one paragraph: what, why, what you verified in the browser, and what the review found. Merge with `gh pr merge --merge` (never squash/rebase — `main` keeps every commit).

## Commands

- `npm run dev` — Vite dev server (port 5173)
- `npm run test` — vitest; `npm run test -- --run` for one-shot
- `npm run typecheck` — `tsc -b` (strict, noUncheckedIndexedAccess)
- `npm run lint` — oxlint
- `npm run e2e` — Playwright smokes (starts dev server itself)
- `npm run build` — typecheck + production build (PWA/service-worker output)

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
- Duo sessions: one shared flow; a single `SET_DONE` logs a set for every participant at their own target. Never intersect the two weight arrays — eligibility is "each participant can perform it with their own kit".
- Client-generated UUIDv7 keys on all event rows → sync is idempotent upsert.
- Workout generation is seeded (`household|date|version`) and must stay byte-deterministic: sort candidates `(score desc, id asc)` before any PRNG pick.
- Verify UI at desktop viewport first (the real workout device is a laptop in Chrome), then 375×812 responsive pass; check light + dark.
- Personal data (names, weights, pain areas, equipment) lives in gitignored `profiles.local.json`, never in the repo — **the GitHub remote is public**. `content/profiles.example.json` is the checked-in template.

## Three filters on any new request

- *Is it generic?* Express it as content or a rule (a catalog field, a typed input, one adjuster), never a branch keyed to one person's circumstances. See PLAN §A0/A1.
- *Is it a lesson?* Encode it at the cheapest durable rung — accept and note it > code fix > regression test > doc. Prose in this file is the most expensive option, not the default.
- *Is it worth building at all?* Name the date it bit (grep docs/DECISIONS.md). A mechanism defending against something that has never happened here costs every future change and buys a feeling.

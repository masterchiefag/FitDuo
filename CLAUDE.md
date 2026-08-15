# FitDuo

Duolingo-style guided dumbbell workout PWA for exactly two users (a couple sharing one laptop during workouts). Plan: [docs/PLAN.md](docs/PLAN.md) (canonical; mirror of `~/.claude/plans/i-want-to-experiment-piped-emerson.md`).

**Start here:** [docs/PLAN.md](docs/PLAN.md) for what to build next (sequencing is at "Revised sequencing"); [docs/DECISIONS.md](docs/DECISIONS.md) for why things are the way they are, and the rule for where new learnings go.

## Workflow — every change goes through a PR

Direct commits to `main` are for bootstrap only. One change at a time:

1. **Branch** — `git checkout -b <slug>`.
2. **Frame it** — fill the PR template's *"Are we solving the right problem?"* section. Cheapest step to skip, most expensive to skip. `merge-ready.sh` checks it is filled.
3. **Build**, and **verify in a real browser** — a green suite is not a working app.
4. **Push, then open the PR** and run the tail against the final sha. Push *before* the tail and after every fix inside it: each step records and attests your **local** sha, so an unpushed commit gets a review comment citing a sha the remote does not have (2026-08-15).
   - `git fetch && scripts/dev/grok-review.sh diff` (defaults to `origin/main..HEAD`; local `main` is stale in a worktree) → fix → re-run → read it → `scripts/dev/grok-review.sh post` → `scripts/dev/record-step.sh grok` (`post` refuses a review not run against `HEAD`)
   - `/code-review` (medium) → fix → `scripts/dev/record-step.sh self-review`
   - `npm run typecheck && npm run test -- --run && npm run e2e` → `scripts/dev/record-step.sh suite`
5. **Verify, then merge.** Confirm `git rev-parse HEAD` equals `git rev-parse @{u}` — the records bind to your local sha and `gh pr merge` takes the remote tip, so an unpushed fix merges the version nobody reviewed with the gate green (docs/DECISIONS.md, 2026-08-15). Then `gh pr merge --merge` — never `--squash` or `--rebase`; `main` keeps every commit (docs/DECISIONS.md). Blocked by `scripts/dev/merge-gate-hook.mjs` unless all three are recorded **at the current sha** — any new commit invalidates them, deliberately.

`main`'s gate-verified line is `git log --first-parent`; branch commits below it were never verified at merge time.

Grok and `/code-review` reliably find *different* classes of problem; run both. Plan revisions get a Grok pass before execution starts. Record each step the moment it runs — batching `record-step.sh` at the end is how a step gets recorded that never ran.

**When review stops.** The framing section's done-criterion decides, never reviewer silence. It must name an external fact (*"step 4 says push before the tail"*); a criterion phrased as a clean round or no remaining objections is illegal, because that is the loop with a new name. After round one, post a verdict on **every** finding in the PR before re-reviewing:

| Finding | Action |
|---|---|
| Names a concrete failure *this land* will cause, in work the **original** framing named | Fix it, or decline in one line under `Declined` — the failure, and why it is accepted |
| Anything else — stale comments, labels, wording, nits | **Decline.** Do not fix. |
| *"This should not exist"* / stop adding | Stop adding: revert the unframed work, or land without it. Building a replacement here is forbidden — see filter 3. |

Widening the framing mid-PR to absorb a finding **is** unframed work, and unframed work is not a reviewable delta: revert it or make it its own PR. Later rounds may only check a fix, or overturn a decline by naming a concrete failure that decline accepted — re-raising a declined item on any other ground is out of scope, and is a finding against the reviewer. **The default is land; building is what needs authorisation** — two agents left alone share a thoroughness loss function and will always agree to do more.

**Scope by surface, not by path.** Prose — `docs/`, `.github/`, and a CLAUDE.md edit that shortens or restates — gets one Grok round, then land. Anything executable (`src/`, `content/`, `tests/`, `e2e/`, **`scripts/dev/`**) and any CLAUDE.md change that *widens* a rule gets the full tail. `scripts/dev/` is explicitly not prose: the two worst binding bugs on record live there.

**Escalate to the user only for:** a new gate, hook or script; `post` when the transcript may quote personal data; overturning a rung-0 accept; or product scope PLAN.md does not already decide. Not for *"is this comment stale"* — that is a decline.

**Why it is a gate and not a paragraph:** this tail existed as prose in this file and was skipped within the hour under delivery pressure (see docs/DECISIONS.md). Prose preventions fail under velocity; mechanical ones hold. `tests/merge-gate.test.ts` is the gate's proof-of-bite — keep it passing, or the gate has silently become a no-op.

**Three standing filters on any new request:**
- *Is it generic?* Express it as content or a rule (a catalog field, a typed input, one entry in the adjuster pipeline), never a branch keyed to one person's circumstances. See PLAN §A0/A1.
- *Is it a lesson?* Encode it at the cheapest durable rung — accept it and write it down > code fix > regression test > area doc > this file. Prose in CLAUDE.md is the most expensive option, not the default.
- *Is it worth building at all?* **Name the date it bit** — grep docs/DECISIONS.md. A mechanism defending against something that has never happened here costs every future PR and buys a feeling. A review finding names a risk; it does not authorise a mechanism, and "accept it, say so in the PR" is a real answer. A finding that says *this should not exist* is worth more than one that says *this is broken*: act on it with the same force. **Never build a new mechanism inside the PR that discovered the need for it** — fixes bypass the framing step in a way features cannot; make it its own PR and let step 2 judge it.

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

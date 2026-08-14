# FitDuo — Duolingo-style Guided Workout PWA (v1 Plan)

## Context

Atul and his wife work out at home ~daily (50–60 min sessions incl. warm-up and stretch) with dumbbells only, currently following an online trainer. They want their own app that **guides the workouts itself** — Duolingo-style engagement (streaks, XP, levels, daily freshness) — with the two of them as the first and only users. Nutrition and mental health are explicitly **out of scope** for v1.

Decisions already made with the user:

| Decision | Choice |
|---|---|
| Core product | App guides the workout (it is the trainer) |
| Platform | PWA, **laptop-first (Chrome on their Mac — the machine this repo lives on)**; responsive so phones work for streak-checking and away sessions |
| Workout mode | **Simplified duo**: they train together sharing one laptop screen — one session flow, both people's targets shown, a single Done per set logs both (with a quick adjust tap for exceptions), both get credit. Solo = one-participant session |
| Couple dynamic | Individual streaks + XP; each sees the other's progress |
| Personalization | Per-person: available weights, per-exercise memory, difficulty feedback → progression |
| Exercise demos | Open-licensed media library, bundled locally |
| Programming | Daily **generated** workouts from a curated exercise pool |
| Session shape | 50–60 min incl. warm-up + cool-down; days/week configurable in onboarding |

Quality bar: a reasonably polished v1 in one pass, not a month of bug fixes. That drives the architecture: a small, deterministic, heavily-tested pure-logic core; boring reliable infra; and the engineering workflow Anthropic recommends for agentic coding in mid-2026 (plan-first, CLAUDE.md, verification gates, code review per milestone).

## v1.1 revision — direction-check feedback (2026-08-14)

Atul's feedback after trying the M2/M3 build, now the top of the backlog. **Execution model change: Opus executes milestones; Fable maintains this plan and reviews; Grok gives a second opinion on plan revisions and milestone diffs via headless CLI** (pattern borrowed from `~/dev/sherlock`'s `scripts/dev/grok-review-pr.sh`, simplified — no PRs in this repo).

### R1 — Follow-along player (highest priority; do before M4)
*(Amended after Grok review — the four safety rules below are load-bearing, not optional.)*

The player currently waits for a "Done" click per set. Rework to fully auto-flowing, like following a real trainer — **zero required keyboard/mouse interaction from Start to celebration** — with these semantics:

- Generator emits per-`WorkItem` `workSeconds` (max across participants of `setSeconds`) and a 15s `changeover` item between different exercises within a round (dumbbell swap). **Both are added to `estimatePlanSeconds`** (3 supersets + finisher ⇒ ~15 changeovers ≈ 4 min the fitter must see) and `generatorVersion` bumps to 2.
- Reducer: `work` becomes a **timed** phase (`endsAt`). Flow on expiry: auto-log sets → next item → changeover → work; end of round → rest; end of block → block transition. `SET_DONE` = "finish early"; new `EXTEND_WORK` (+15s); new `ADJUST` event stores per-person override targets **in reducer state** (not React state), read by both expiry and finish-early when logging.
- **Safety rule 1 — fast-forward never crosses work.** `TIMER_FIRED` on an expired work phase with `now − endsAt > 15s` (backgrounded tab, closed lid, resume-after-kill) transitions to **paused at that set** — it must not auto-log sets nobody did. Only the live visible tick (small gap) advances work. Keep the reducer test "fast-forward cannot cross a work phase" as the invariant, updated for the grace window.
- **Safety rule 2 — expiry is not proof of success.** Auto-logged sets carry `assumed: true`. Assumed sets count for session XP/sets/volume (the follow-along assumption, like a class), but are **excluded from PR detection and from progression's "all sets hit → +1 rep" rule** — silent sessions hold steady; progression advances only on explicit feedback taps or explicitly confirmed/adjusted sets. No fake PRs, no ratchet from assumed data.
- Rest lengths stay parameterized per block (the budget fitter tunes within 45–150s).
- UI: countdown ring on the work screen + rep pacing hint ("~1 rep / 3s"), 3-2-1 beeps before every transition (already built), Pause/Skip/adjust remain the only interactive controls.
- **Resolved (2026-08-14): they each own a set of dumbbells.** Duo sets are therefore **simultaneous** — one shared timer, `workSeconds = max(setSeconds)` across participants, one auto-log per person at their own target. No alternate-work mode in v1.
- Tests: reducer table + fuzz updated for timed work, grace-window pause, assumed-set flags; e2e drivers keep clicking "finish early" so suites stay fast.
- **This section supersedes the "Session player" description in Architecture and the player bullets in Product spec wherever they conflict** (those still describe click-to-advance work).

### R2 — Coach voice (trainer that talks; do after R1)
- **R2a (v1): Web Speech API `speechSynthesis`, template-driven** — free, offline with local voices. The coach speaks lines composed from data the app already has: exercise intro with both people's targets ("Next up: Goblet Squat — Atul 10 kilos, Partner 5"), the existing form cues read aloud during the set, rest announcements, completion encouragement. **A cue-priority queue arbitrates audio: 3-2-1 beeps always win; speech is cancelled, never queued behind a transition.** Settings: voice picker, speech rate, mute. *No editorial authoring in R2a* — per Grok, hand-written per-exercise mistake/encouragement copy for ~70 exercises is its own project.
- **R2b (later): authored coach copy + pre-generated natural TTS** — write real intro/common-mistakes/encouragement lines per exercise, render through a paid TTS API at build time into bundled audio. The template pipeline from R2a is the durable substrate.

### R3 — Better form media (the 2-frame images are the dataset's limit)
free-exercise-db ships exactly two still photos per exercise — that's all it has. Layered fix:
- **R3a (v1): curated "Watch form ▶" YouTube links only** — an editorial `videoUrl` per main exercise, embed opened in an overlay, online-only, clearly optional. **Opening the video pauses the session** (otherwise the follow-along timer completes the set while they watch). Shown on rest/changeover screens. *wger video bundling is dropped* (blows the precache budget for partial coverage).
- **R2a synergy**: spoken form cues carry much of what the images can't show.
- **R3b (post-launch): self-recorded clips** — Settings flow to replace any exercise's demo with a laptop-camera recording (MediaRecorder → webm, stored locally then synced via Supabase Storage). You know the movements from your trainer; over a few weeks the app becomes personally demonstrated.

### Grok-review amendments to later milestones (these override conflicting text below)
1. **Drop stored `xp_awarded`/`sets_completed` columns** from `workout_sessions` — they contradict "XP is only derived" and will drift. The partner card derives from the partner's session + set rows client-side (trivial volume; RLS read already allows it).
2. **M4 RLS test, stated precisely:** unauthenticated/foreign clients can do nothing; *partner* inserts of sessions/sets ARE allowed (household-trust duo requires it); no delete works for anyone; session status only advances except the defined same-day-restart transition.
3. **Same-day restart is a defined transition:** re-opening a day whose session was abandoned reuses the row (`abandoned → in_progress`), keeps already-logged sets, and appends new ones. Unique `(user_id, workout_date)` stays.
4. **Cross-device plan adoption includes session identity:** the second device drops its locally generated session id, adopts the server row's id and plan, and rebases its outbox onto that row.
5. **One household schedule** (not per-person): drives day-type rotation AND both streaks. Onboarding sets it once, editable in Settings.
6. **Cut from v1:** activity feed + emoji cheers, web push notifications, per-person schedules. M4 = auth + sync + derived partner card + onboarding. M5 loses push; keeps offline/install/polish/Lighthouse.

### Revised sequencing
R1 → R2a → R3a → M4 (slimmed: auth/sync/partner card/onboarding) → M5 (PWA polish, no push) → M6 (launch). R2b, R3b, activity feed, push are post-launch. Every milestone tail: `typecheck + test + e2e` → `/code-review` (medium) → **Grok review of the milestone diff** (`scripts/dev/grok-review.sh diff <range>`) → fix findings → commit.

## Product spec (v1)

### Onboarding (once per person)
- Name, avatar/color, goal (tone up / build strength / general fitness).
- Available dumbbell weights (multi-select, e.g., 2.5/5/7.5/10 kg — supports adjustable sets via a range).
- Weekly schedule: which days are workout days (drives streak rules; rest days never break a streak). Default 5 days/week.
- Self-rated starting level (beginner / intermediate) → initial difficulty tier.

### Home screen ("Today")
- Today's workout card: day type (e.g., "Upper Body Push"), duration estimate, **Start duo workout** button (with a "just me" alternative). Rest days show a stretch-only optional session.
- On the shared laptop: **both people's cards side by side** — streak flame, XP bar to next level, weekly progress dots each. On a phone (logged in individually): your card first, partner card below with a gentle nudge — not a leaderboard.

### Guided session player (the core experience — designed for a shared laptop screen)
- Session start: "Who's working out?" → **Both (duo)** / just one of you. Duo is the default and the designed-for case.
- Flow: warm-up block → 2–3 main circuit blocks → cool-down stretch. Progress bar for the whole session. One shared timer and flow.
- Per exercise: large demo media + form cues (laptop screen real estate), and **a target panel per person** — each shows that person's reps × weight from their own progression ("Last time 7.5 kg → try 10 kg"), color-coded per person, editable.
- Per set, **one big Done button** advances the set for both of you — each person's set is logged at their own target (reps × their weight). A small "adjust" tap opens a quick editor if someone did fewer reps or a different weight. Solo sessions show one panel, same button.
- Rest timer with countdown, audio beeps, "next up" preview, skip / +15s controls.
- Pause anytime; session survives app/browser kill (resume prompt).
- After each main exercise: one-tap difficulty feedback **per person** (Too easy / Just right / Too hard) → feeds each person's progression independently.
- Completion screen: celebration animation, **both** XP breakdowns, streak updates, achievements, PRs — a shared moment, which is the point.

### Gamification
- **XP**: base per completed session + bonuses (full completion, streak multiplier, personal record, first session of the week). Partial sessions earn partial XP.
- **Levels**: smooth curve (details in Architecture), level-up moment on completion screen.
- **Streaks**: individual; advance on completing a scheduled day; rest days neutral; one streak-freeze auto-applied per week for a missed scheduled day.
- **Achievements** (~12 for v1): first workout, 7/30-day streaks, level milestones, total-volume milestones, early-bird, weekend warrior, "both of you worked out today", etc.
- **Partner visibility**: home-screen partner card + a small "Activity" list (partner completed X, hit a PR) with one-tap emoji cheer.

### Personalization & progression
- Per-exercise memory: last used weight/reps per person.
- Progression rule: "too easy" + completed all sets → suggest next available weight or +reps; "too hard" → drop weight/reps; "just right" → hold, nudge reps up slowly. Bounded by the person's available dumbbells.
- Weekly variety: generator guarantees muscle-group balance across the rolling week and no-repeat windows so days feel fresh (Duolingo-like) without sacrificing training sense.

### Explicitly out of scope for v1
Nutrition, mental health, social beyond the two of you, native apps, Apple Health/wearables, AI-generated coaching text, video streaming. The data model must simply not block these later.

## Architecture

**Guiding principle:** a small, pure, deterministic TypeScript core (generator, player state machine, gamification) that is 100% unit-testable, wrapped in boring managed infra (Supabase + Vercel), with append-only event data so nothing can drift. The pure core is ~60% of the engineering risk and needs zero infrastructure — it gets finished and trusted before the first screen exists.

### Stack
- **Frontend:** React 19 + TypeScript strict (`noUncheckedIndexedAccess`), Vite, Tailwind v4, Motion (framer-motion) for celebrations, plain CSS/SVG timer rings. Plain SPA — no SSR/Next, so the whole app is offline-cacheable.
- **PWA:** vite-plugin-pwa in `injectManifest` mode (Workbox) — hand-written service worker; update flow is "prompt", never mid-workout.
- **State:** Zustand binding a pure reducer from `core/` (no XState); TanStack Query for server state; Dexie (IndexedDB) for local persistence; Zod at every I/O boundary.
- **Backend:** Supabase free tier — Postgres + RLS + auth + realtime. **Password auth, not magic links** (magic links open in the browser, not the installed PWA — classic iOS trap). Two accounts, public signups disabled, long session expiry. No edge functions: the server is a dumb RLS-guarded event store; all logic is client-side pure functions.
- **Hosting:** Vercel (static output + a cron pinging Supabase every 3 days so the free project never pauses from inactivity).

### Data model (Supabase; full SQL in `supabase/migrations/0001_init.sql`)
- `profiles` — display name, `partner_id` (points at each other), timezone, `available_weights numeric[]`, `schedule` jsonb (workout days) + `schedule_history` (so editing your schedule never rewrites past streaks).
- `workout_sessions` — one per user per **local date** (`unique(user_id, workout_date)`); stores the shared generated `plan` jsonb (same `plan_hash` for both users on a duo day) + that user's target overlay + `generator_version` + `mode ('duo'|'solo')`, status `planned→in_progress→completed/abandoned`, and write-once completion snapshot (`sets_completed`, `xp_awarded`). A duo session simply writes two rows — streaks/XP stay purely per-person with no special casing.
- `set_logs` — append-only, one row per completed set, **client-generated UUIDv7 keys** (idempotent sync).
- `exercise_feedback` — one rating per exercise per session (`too_easy|right|too_hard`).
- **Deliberately absent:** `xp_events`, `streaks`, `achievements`, `exercises` tables. XP/level/streak/achievements are **derived by pure functions over the event log** (2 users × ~365 sessions/yr = trivial to replay; no stored counters, no drift). The exercise catalog is versioned static JSON bundled with the app — content updates are a deploy, not a migration.
- **RLS (household trust model):** read = own or partner's rows; **insert/update = own or partner's rows** — required because a duo session on the shared laptop is authenticated as one account but logs sets for both people. Acceptable for a two-person household of spouses; the real safety property is **no delete policies anywhere** (append-only enforced by the DB) and no third account can ever exist (signups disabled). Service-role key never ships to the client. Integration test asserts RLS is enabled per-table and an unauthenticated/foreign client can do nothing.

### Workout generator (`src/core/generator` — pure, no I/O, no `Date.now()`, no `Math.random()`)
- **Duo-aware by design:** exercise *selection* (structure, day type, which movements) is generated once per **household** — seed = `fnv1a32(householdId|dateISO|generatorVersion)` — from merged history (novelty/muscle-balance over the union, tier ceiling = min of the two users' ceilings, equipment = intersection-satisfiable) so both do the same workout together. Per-person *targets* (weight × reps per exercise) are then computed from each person's own progression state as an overlay. A solo session is the same pipeline with a one-person household view.
- **Determinism:** mulberry32 PRNG from the seed, fixed call order; candidate lists sorted `(score desc, id asc)` before any pick. Same (household, date, progression states) ⇒ byte-identical plan. Cross-device tiebreaker: first device to open the day upserts the plan row; others adopt the stored plan (compare `plan_hash`, server wins).
- **Day-type rotation** from days/week: 3→full A/B/C, 4→upper/lower×2, 5→push/pull/legs/upper/full, 6→PPL×2. Bonus workout on a rest day = next rotation slot.
- **Structure:** warm-up (7 timed moves ≈ 6 min) → 2 superset blocks + 1 circuit finisher (pattern-slotted per day type, ≈ 44 min) → cool-down (5 stretches ≈ 5 min).
- **Selection scoring:** `3·novelty + 2·muscleNeed(rolling 7-day sets vs 10-set weekly target) + 1·patternFit`; hard constraints: tier ≤ user ceiling, equipment satisfiable, 3-day no-repeat window (deterministic relaxation ladder 3→2→0 if the pool empties). PRNG picks among top-3 candidates — variety without chaos.
- **Progression (double progression over the user's actual dumbbells):** too_hard → step down one available increment; too_easy → step up (or +2 reps if no heavier weight); right + all sets hit → +1 rep, rolling over to weight-up at top of rep range. Bodyweight progresses on reps.
- **Time budgeting:** pure per-set estimator (setup + reps × tempo × unilateral factor); deterministic bounded adjustment loop (rest 60/75/90s, finisher rounds, ±1 rep) until `estimatedSeconds ∈ [3000, 3600]`. Property test guarantees the invariant.

### Session player (`src/core/player` — pure reducer; UI is a projection)
- States: `warmup → work → rest → block_transition → cooldown → complete`, plus `paused`; events carry `now`; reducer emits effects (`LOG_SET`, `CUE`, `PERSIST_SNAPSHOT`).
- **Simplified duo:** the reducer holds one flow with a `participants` array; a single `SET_DONE` emits one `LOG_SET` effect **per participant** at that person's target (an optional `overrides` field on the event carries adjustments), then starts rest. Feedback events are per-person one-taps on the rest screen. Solo is a one-participant array — same reducer, no second code path, no cross-person coordination states.
- **Wall-clock anchored timers:** state stores absolute `endsAt` deadlines; the shell's interval only renders `endsAt − now` and fires `TIMER_FIRED`. On `visibilitychange`, fast-forward deterministically through any missed phases. Zero drift by construction; fuzz-tested.
- **Audio:** WebAudio oscillator beeps (no assets), unlocked synchronously inside the START tap (iOS requirement); 🔊/🔇 indicator; visual timer always primary. **Wake lock** on start, re-acquired on visibility; toast fallback.
- **Kill-safe:** snapshot to Dexie on every effectful transition + 5s heartbeat; on launch, offer "Resume workout?"; resume fast-forwards expired timers. Set logs write to the outbox immediately, so completed work is never lost; "completed" = user finishes with ≥60% of planned sets.

### Offline + sync (`src/infra`)
- **Precache everything:** app shell + the entire curated media set (~70 exercises × 2 frames, re-encoded WebP ≈ 5–8 MB). A full workout — generation, player, logging, own stats — is 100% offline; only login, partner panel, and sync itself need network.
- **Outbox pattern:** optimistic write to Dexie mirror + queue; flusher on focus/online/post-workout; idempotent upserts keyed by client UUID (`Prefer: resolution=ignore-duplicates`). Single-writer-per-user + append-only union-merge ⇒ no conflict UI needed; sessions advance status monotonically.
- `navigator.storage.persist()` requested; Supabase is canonical, so worst-case eviction = re-sync, never data loss.

### Gamification math (`src/core/gamification` — `deriveStats()` over the event log)
- **XP:** 50 base + 2×sets + 25 full-clear + 15×PR (new Epley e1RM, cap 2/session) + streak milestone bonuses (+50@7, +150@30, +500@100). Abandoned sessions keep their per-set XP.
- **Levels:** `xpForLevel(L) = 250·(L−1)^1.6` — L2 in ~2 sessions, L5 ≈ 3 weeks, L10 ≈ 10 weeks.
- **Streaks:** local-date strings only (never UTC); completed scheduled day advances; rest days neutral; bonus rest-day workout counts; **one auto streak-freeze per ISO week** applied during replay (no stored state); schedule edits replay against `schedule_history`.
- **Achievements:** 13 pure predicates (first workout, 7/30/100-day streaks, 25/100 sessions, PRs, 10-ton volume, early bird, perfect week, comeback, "Better Together" = both partners completed the same day). Unlock dates fall out of replay; only a cosmetic "celebration shown" flag lives in Dexie.

### Project structure
```
content/            catalog.json (~70 curated exercises, zod-validated in CI) + WebP media + curate.ts script
src/core/           ★ PURE — generator/ player/ gamification/ catalog/ dates.ts  (ESLint import-zone enforced)
src/infra/          supabase/ db(Dexie)/ sync(outbox)/ audio.ts wakelock.ts
src/app/            screens (Today, Player, History, Stats, Partner, Settings), stores, components
src/sw.ts           Workbox injectManifest service worker
supabase/migrations/  schema + RLS
e2e/                Playwright smokes
```
**Purity enforcement** (highest-leverage guardrail): ESLint `no-restricted-imports` — `src/core/**` may import only from `src/core`.

### Testing
- **Vitest, ~100% branch on `core/`:** property-based (fast-check) generator invariants — duration ∈ [50, 60] min, determinism, no-repeat honored, weights ∈ available set, all IDs resolve; player-reducer fuzz (random event sequences + arbitrary backgrounding gaps never reach invalid states); gamification golden-file replays (freeze edges, mid-streak schedule changes, near-midnight/DST fixtures).
- **CI catalog check:** every day-type slot has ≥5 tier-1 candidates (kills generation dead-ends pre-release); every entry has media + cues.
- **Playwright, 3 smokes** (WebKit + Chromium): login→today; complete a seeded mini-workout→XP/streak update; offline mid-session→sync on reconnect.
- **1 RLS integration test** against local Supabase.

### Top risks → mitigations (short form)
Laptop-first Chrome as the primary target defuses most classic PWA risks (audio unlock, wake lock, storage eviction, push are all well-supported on desktop Chrome); they remain as *secondary-device* concerns for phones.
1. **free-exercise-db media quality** → manual editorial pass over only ~70 exercises with crop/re-encode; text cues so no image is load-bearing; user spot-check gate at M1.
2. **Generator dead-ends** (duo constraints tighten pools: min tier + merged no-repeat) → relaxation ladder + CI pool-size check + property fuzz including duo inputs.
3. **Timezone/DST streak bugs** → local-date strings computed at write time, pure string date math, golden fixtures.
4. **Supabase free-tier pause** → Vercel cron ping; offline-first degrades gracefully anyway.
5. **Duo-session auth subtlety** (one logged-in account writes both people's rows) → covered by the household-trust RLS above; append-only limits blast radius.
6. **Phone-side iOS quirks** (audio unlock, wake lock, eviction — only when used on phones) → unlock in START tap with visible 🔊 state; wake-lock re-acquire on visibility (wall-clock reducer means a slept screen loses zero state); `storage.persist()`; canonical data server-side. Verified once on a real iPhone before M6.

## Milestones (each ends verified + committed, and each ends with something to SEE on localhost)

- **M0 — Scaffold & workflow.** Vite + React + TS(strict) + Tailwind + PWA plugin; vitest + Playwright wired; git init; CLAUDE.md; `.claude/settings.json` + launch config; CI-grade npm scripts (`dev`, `test`, `typecheck`, `lint`, `e2e`); core data types (`Exercise`, `WorkoutPlan`, `Block`, player state types) defined up front so later milestones share one contract. **Localhost checkpoint:** app shell with navigation runs.
- **M1 — Exercise content pipeline.** Script to pull free-exercise-db, filter to dumbbell/bodyweight/stretch, curate ~70 exercises into a typed JSON catalog (id, name, movement pattern, muscles, equipment, difficulty tier, rep range, tempo estimate, media paths, form cues, role: warmup/main/cooldown); re-encode media to WebP (~5–8 MB total) for bundling; a catalog browser page. **Localhost checkpoint:** browse all exercises with images + cues; you spot-check quality (~15 min).
- **M2 — Vertical-slice MVP ⭐ (the direction-check gate).** Today screen + the full guided **duo** session player, running a hand-authored fixture `WorkoutPlan` (real types, real media, hardcoded content): side-by-side per-person targets with a single shared Done button (+ adjust tap), wall-clock timers, rest countdowns, audio beeps, pause/resume, kill-safe snapshot, per-set logging to local storage, per-person difficulty-feedback taps, completion celebration with fake-but-plausible XP/streaks for both of you. No generator, no accounts, no sync — pure look-and-feel. **Localhost checkpoint: you and your wife do a real workout together in Chrome on this laptop and decide whether the direction is right — before any backend exists.** Iterate here until it feels good; everything after this hardens what M2 proved.
- **M3 — Pure core: generator + progression + gamification.** Deterministic seeded day-workout generator (day-type rotation, muscle balance, no-repeat windows, 50–60 min time budgeting); progression engine; XP/level/streak/achievement derivation over event logs; wire the M2 player to consume generated plans and real local stats. Verify: full vitest suite incl. property tests. **Localhost checkpoint:** dev page rendering 14 consecutive generated days for both profiles; your *actual* generated workout runs in the player.
- **M4 — Accounts, sync & partner view.** Supabase password auth (signups disabled, two accounts) + migrations + RLS; Dexie mirror + outbox sync; real home screen (today card, streak/XP, partner card); activity feed + cheers; onboarding flow. Verify: RLS integration test denies cross-user writes. **Localhost checkpoint:** two browser profiles as the two of you; complete a workout in one, watch the partner card update in the other.
- **M5 — PWA polish.** Offline support (precache shell + media), install experience (icons, splash, A2HS guidance), web push reminders where supported (iOS ≥16.4 installed PWA; graceful fallback), empty/error/loading states, light+dark, motion polish, Lighthouse pass. Verify: airplane-mode workout completes and syncs later; Lighthouse ≥90 PWA/a11y.
- **M6 — Real launch.** Deploy to Vercel; create both real accounts; seed real weights/schedules; install as a PWA in Chrome on the workout laptop (plus phones optionally, for streak-checking); first real duo workout; fix anything found same-day. Verify: installed laptop app, one completed real duo session, both people's data visible from a second device.

Sequencing rationale: M2 deliberately jumps ahead of the pure core so the product's feel is validated with the cheapest possible build. The risk of UI-before-core is contained because M0 fixes the shared types and M2's fixture plan is exactly the shape the generator will later emit — swapping hardcoded for generated in M3 is a data-source change, not a rewrite.

## What I'll need from you (the user)
- A **Supabase** account (free tier) and a **Vercel** account (free) — both sign-up-with-GitHub; I'll walk you through the two paste-a-key moments at M4/M6. (Per my operating rules I won't create accounts or handle credentials myself.)
- ~15 min at M1 to spot-check the curated exercise list/media quality; the **M2 direction-check workout** (both of you, together, in Chrome on this laptop); a glance at M3's two weeks of generated workouts.
- Your dumbbell inventory + preferred workout days, at M6.

## Verification (overall)
- `npm run typecheck && npm run test && npm run e2e` green at every milestone.
- Golden path exercised in the browser pane at desktop viewport (primary device) plus a 375×812 responsive pass after every UI milestone; final check on a real phone via the deployed URL.
- Determinism check: same household+date+state generates identical workouts across two devices.
- /code-review per milestone; /security-review before M6 deploy (focus: RLS, auth).

## Engineering workflow (Anthropic-recommended practices, mid-2026)

This is how the executing model (Opus/Fable) should work, set up in M0:

1. **Git from commit zero.** `git init`, `.gitignore`, small commits per milestone slice with descriptive messages. Each milestone ends on a clean, working commit.
2. **CLAUDE.md** at repo root, written for an agent: exact commands (dev, test, typecheck, lint, seed), architecture map (one paragraph + directory table), the "pure core vs shell" rule, and gotchas (iOS PWA quirks, Supabase env vars). Kept short; updated when conventions change — not a changelog.
3. **`.claude/` project config**: `settings.json` allow-listing the project's routine commands (npm test/typecheck/lint/dev) to cut permission friction; a `run` launch config (`.claude/launch.json`) so the app can be started and visually verified in the browser pane.
4. **Plan-first, verify-per-milestone.** Execute this plan milestone by milestone. After each: typecheck + tests green, then a real end-to-end check in the browser (not just tests), then commit. Never stack two unverified milestones.
5. **Test the core, not the pixels.** The generator, progression, streak/XP/achievement logic are pure TypeScript with zero React/Supabase imports — covered by vitest incl. property-based checks (time budget always 50–60 min, no-repeat invariants hold, determinism: same seed+state ⇒ same workout). UI gets a thin Playwright smoke pass over the golden path (onboard → start workout → complete → see XP/streak). TypeScript `strict: true` from day one.
6. **/code-review before declaring a milestone done** (medium effort), fixing confirmed findings; a final `/security-review` pass before deploy (RLS policies, auth flows).
7. **Visual verification loop.** Use the browser pane at **desktop viewport first** (the real workout device is this laptop's Chrome), then a responsive pass at 375×812 for phone use; screenshot-check light/dark. Polish is a verification step, not a hope.
8. **Seed & fixtures.** A seed script creates both user profiles and a demo history so every feature is reviewable with realistic data immediately.

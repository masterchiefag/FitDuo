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

Atul's feedback after trying the M2/M3 build, now the top of the backlog. **Execution model change: Opus executes milestones; Fable maintains this plan and reviews; Grok gives a second opinion on plan revisions and milestone diffs via headless CLI** (pattern borrowed from `~/dev/sherlock`'s `scripts/dev/grok-review-pr.sh`, simplified — reviews post to the PR as a plain comment, without that script's PENDING/polling machinery).

### A1 — Product, not a bespoke tool for one person (standing filter, added 2026-08-14)
Atul's instruction: *push back when a request is too specific to be useful to anyone else.* FitDuo should end up a product other households can use, so every request gets this filter before it is built:

**Build it when** the underlying need is common (time available, an aggravated joint, equipment on hand, a stiffness complaint) — then express it as **content or a rule**, never a branch. Duration, pain areas, equipment, and mobility focus all pass: each is now a typed input or a catalog field, so serving one more person is data, not code.

**Push back when** it would hardcode one person's circumstances into logic — a named routine, a fixed exercise order "because my shoulder", a rule keyed to a specific user. The generic form is almost always available one level up: not "avoid overhead press", but *exercises declare what they load and flagged areas go lighter*.

**Deliberately NOT generalised yet** (premature generalisation kills projects before they are used daily): multi-household support, an onboarding flow that asks what this plan currently hardcodes, gym equipment beyond the household fixtures (chair/wall/step) added in PR #3, and goal-based programming. The mechanisms are generic; the *reach* stays two users until the daily experience is good. A0 means widening reach later is content and config, not a rewrite.

**Known personal residue, to remove before anyone else uses this:** the free-text `notes` field in `profiles.local.json` (inert prose, machine-unreadable — the structured `painAreas` is the real mechanism), and the fact that household id, schedule, and the two profiles are still constants.

### A0 — Generic mechanisms, not special cases (architectural principle; governs R1/R4/R5)
The features below (short session, mobility day, readiness, pain adaptation, swaps) must **not** become five bespoke code paths with hardcoded tables. Four shared mechanisms carry all of them, and every future "can it also do X?" should land as data or one new rule — never generator surgery.

**1. Exercises declare what they load — structured, not prose.**
```ts
type BodyArea = 'shoulder' | 'lower_back' | 'knee' | 'wrist' | 'elbow' | 'neck' | 'hip'
loads: { area: BodyArea; stress: 'high' | 'moderate' }[]
```
Defaulted from movement pattern during curation, overridable per exercise. *Everything* reads this one field: the caution line in the UI, pain-flag load reduction, substitution ranking, and later "why did you pick this for me". No pattern→pain lookup tables anywhere in the generator.

**2. One ordered target-adjustment pipeline.**
Per-person targets are the base progression target passed through a list of small pure adjusters:
```ts
interface AdjustContext { exercise, person, readiness, painFlags, sessionMode, history }
interface Adjuster { id: string; apply(t: PersonTarget, c: AdjustContext): PersonTarget }
```
Order: `progression` → `readiness` → `painLoad` → `sessionMode` → **`weightSnap`** (must be a dumbbell that person owns) → **`repClamp`** (stay inside the exercise's rep range). The last two always run last, so **no rule can ever emit an unliftable or out-of-range prescription** — that invariant is a property test, not a convention. Adding "deload week", "travel mode", or "first session back" later = one entry in the list plus its unit test.

**3. Substitution by similarity, not a swap table.**
`findSubstitute(exercise, { avoidAreas, person, catalog })` ranks candidates by same pattern → primary-muscle overlap → tier proximity → equipment that person owns, excluding anything loading an avoided area. One function serves pain swaps, "I hate this one", a missing dumbbell, and the generator's own variety fallback.

**4. Session shapes and day splits are content, not code.**
`content/session-modes.json` (full / short / mobility: target duration band, block skeleton, whether load is allowed, streak + XP weighting) and `content/day-templates.json` (the pattern slots per day type — currently a hardcoded `TEMPLATES` map in `generate.ts`). A new split or session type becomes a content edit plus schema validation, the same way exercises already work.

Consequence for sequencing: **R1 lands the pipeline's terminal invariant** — `weightSnap` and `repClamp`, as a property test that no rule can emit an unliftable or out-of-range prescription — alongside the phase changes it guards, because R1 is where targets start being prescribed with nobody confirming them. The ordered adjuster *list* waits for R5, which supplies the first adjuster after `progression`; built now it would be an interface wrapping a single entry, which is the shape of a mechanism defending against something that has not happened yet (CLAUDE.md, filter 3). R4 and R5 then add *data and rules*, not new engines.

### R1 — Follow-along player (highest priority; do before M4)

The player waits for a "Done" click per set. Rework to auto-flowing, like following a real trainer: **zero required interaction from Start to celebration**. Folds in the short strength session (both touch session shape). Invariants — each is a test, not a note:

- `work` becomes a timed phase (`workSeconds` = max across participants); a 15s changeover phase sits between *different* consecutive exercises **within a round** — never on the round boundary, where rest already sits. `estimatePlanSeconds` must count changeovers, or `fitToBudget` plans ~3 min/day blind.
- **Late timers never cross a work phase and never auto-log a late set** — fast-forward stops at the boundary and pauses. (The grace window already exists in `reducer.ts`; extend it so `work` terminates the chain.)
- **The block gate replaces each block's final `work → block_transition` edge** (not a rest expiry — the last round has no rest): a hold with per-person, per-exercise easy/hard chips and one big Continue. Unrated + Continue records `'right'` — a human confirmed the block. Unanswered for 5 minutes → pause. This is the presence check: one tap per block, ~4 per session.
- **Assumed sets:** unadjusted auto-logs carry `assumed: true`, count as target-hit for progression (the follow-along contract — the app called the reps, you did them), and are excluded from PR detection. A log that consumed an `ADJUST` override is `assumed: false` with the override's actuals. **Every `LOG_SET` path — expiry and finish-early `SET_DONE` — consumes then clears the pending override**; `ADJUST` is scoped to the current work item and cleared on leaving it (Skip included).
- `SKIP` during work still advances **without logging** — it must not ride the expiry path once expiry auto-logs.
- Short session: the duration band becomes a function of `targetSeconds` (mobility already takes it); short gets its own `mode` and XP rule, full streak credit. "Cut it short" completes at the block boundary — do **not** implement the dormant "≥60% of planned sets" rule to justify it; completion is the `ABANDON` flag.
- Persist-on-Start is M4 work (no plan row exists yet). Music goes in a separate app, not a second tab — backgrounding trips the pause rule; note it in Settings.

**Done when the browser drive passes:** a full hands-off session Start→celebration touching nothing but Continue; one mid-set correction that logs correctly and doesn't leak to the next exercise; a 20-minute session run to the end. Supersedes the Architecture player section and Product-spec player bullets where they conflict.

### R2 — Coach voice (a trainer that talks, then one that listens)
Staged from one-way speech to genuine conversation. Each stage is independently useful and shippable; the later ones need network and (for R2c) an API key.

- **R2a (v1): the coach talks — `speechSynthesis`, template-driven.** Free, offline with local voices. Speaks lines composed from data the app already has: exercise intro with both people's targets ("Next up: Goblet Squat — Atul 10 kilos, [partner] 5"), the existing form cues read aloud during the set, rest announcements with what's coming, completion encouragement, and **the feedback prompt** ("How was that block? Easy, good, or hard?") which is what keeps progression moving. **A cue-priority queue arbitrates audio: 3-2-1 beeps always win; speech is cancelled, never queued behind a transition.** Settings: voice picker, rate, mute. No per-exercise editorial copy at this stage — templates only.
- **R2b: the coach listens — voice commands (`SpeechRecognition`, Chrome).** This is the one that matters for follow-along, because *your hands are holding dumbbells and you cannot reach the laptop mid-set.* A small, fixed vocabulary recognized during a session: "pause", "resume", "skip", "more time", "easy / good / hard" (logs feedback for whoever spoke — with two people, a "who said that?" tap-free ambiguity we resolve by asking each person in turn during the feedback prompt), "how many left". Fixed vocabulary is far more reliable than open dictation over music and breathing. Push-to-talk fallback via spacebar. **Privacy note: Chrome's speech recognition sends audio to Google's servers — it is opt-in in Settings, off by default, and only listens during an active session.**
- **R2c (post-launch): actual conversation — LLM-backed coach.** Mic → transcript → Claude API (with the session state, both profiles, and today's plan as context) → spoken reply *and structured actions*: "my shoulder's hurting today" ⇒ sets the pain flag and substitutes the pressing slot (R5); "swap this exercise" ⇒ regenerates that slot; "why am I doing this one?" ⇒ explains the movement's purpose. Needs network and an API key; costs a few cents a month for two users. Must degrade cleanly to R2b commands when offline. This is the version that actually feels like a trainer in the room.
- **R2d: pre-generated natural TTS** — authored per-exercise coaching copy rendered through a paid TTS voice at build time, replacing the robotic local voice. No longer "optional polish": the outside-in research ([docs/RESEARCH.md](RESEARCH.md)) found no beloved fitness product built on synthetic TTS — browser TTS is the likely ceiling on attachment. **Trigger: if the coach voice is still on after ~4 weeks of real R2a sessions, R2d is the highest-value polish available; if it gets muted, R2d dies and the research says why.**

### R3 — Better form media (the 2-frame images are the dataset's limit)
free-exercise-db ships exactly two still photos per exercise — that's all it has. Layered fix:
- **R3a (v1): curated "Watch form ▶" YouTube links only** — an editorial `videoUrl` per main exercise, embed opened in an overlay, online-only, clearly optional. **Opening the video pauses the session** (otherwise the follow-along timer completes the set while they watch). Shown on rest/changeover screens. *wger video bundling is dropped* (blows the precache budget for partial coverage).
- **R2a synergy**: spoken form cues carry much of what the images can't show.
- **R3b (post-launch): self-recorded clips** — Settings flow to replace any exercise's demo with a laptop-camera recording (MediaRecorder → webm, stored locally then synced via Supabase Storage). You know the movements from your trainer; over a few weeks the app becomes personally demonstrated.

### R4 — Session lengths & modes (short session + mobility)
Two new session types generated from the same engine, both counting for the streak. Rationale: a 50–60 min session or nothing is the fastest way to break a streak, and the streak is the engagement engine.

- **Short session — ✅ mechanism shipped for mobility 2026-08-14; reuse it for strength.** `targetSeconds` is now a first-class generator input (mobility offers 5/10/20/30 min and fills the budget). R1 applies the same input to the strength generator instead of inventing a second mechanism (mechanics in the R1 section). Full streak credit, proportionally less XP (it's honest, and the streak — not XP — is what protects motivation). Offered on Today as a secondary button, and as a mid-session **"cut it short"** which is an *explicit completion transition*, not an abandon: it truncates the plan at the current block boundary, **rewrites the session's planned-set count to what was actually programmed through that block**, and completes.
- **Mobility & Relief session (~10 min) — ✅ SHIPPED 2026-08-14** (band + roller support, priority-ranked content, mobilise→open→activate; player now uses a unified blockIndex-keyed timed phase) — a *recovery* session for stiffness, chosen by region: **shoulders & upper back**, **lower back & hips**, or **full body**. All-timed blocks (60–75s holds, breathing cues), no load, no progression. Counts for the streak as a recovery day; earns reduced XP; explicitly **does not** count as a strength day for muscle-balance history.
  - Content work: add a `region` tag to mobility/cooldown catalog entries and curate ~10 more from free-exercise-db's stretching set (thoracic/spinal rotation, lat and pec stretches, scapular work, upper-back and neck releases, hip flexor and piriformis). The dataset has 108 stretching entries, so this is editorial selection, not new sourcing.
  - Implementation note: a mobility plan is *entirely timed blocks*, which the player already handles natively — after R1 this is generator + content work with no new state machine.

### R5 — Readiness check & pain-aware generation
A trainer asks how you're feeling and works around your bad shoulder. Two coupled features, both cheap, both preventing the classic week-six abandonment.

- **Readiness (per person, per session, optional):** one tap on Today — *Fresh · Normal · Beat up*. It is a **target adjuster only**: `beat up` steps that person's weight down (or moves reps to the bottom of the range), `fresh` allows the top. It **must not touch rounds or rest lengths** — those are shared by one timer and one `rounds` field, so a per-person change would either desync the duo flow or silently deload both people. Session-level shortening is a household choice at Start (the short mode in R4), not a personal readiness effect. Recorded as an append-only event; derived-stats model untouched.
- **Exercise cautions (catalog content, benefits everyone):** each main exercise carries a `cautions` list of body areas it loads — overhead pressing ⇒ `shoulder`; loaded hinge and bent-over rows ⇒ `lower_back`; jumping and deep lunges ⇒ `knee`; push-ups and planks ⇒ `wrist`. Mostly derivable from the movement pattern with per-exercise overrides, so authoring is cheap. Shown in the exercise detail regardless of any flag ("Take care if your shoulder is sensitive — keep the ribs down, stop if it pinches"), because that's useful coaching for anyone.
- **Pain flags adapt the load, per person — they do not delete the exercise.** Flag *shoulder · lower back · knee · wrist · elbow* from Today or mid-session ("this hurts"). While a flag is live (default 10 days, dismissible, renewable), for **that person only**:
  - their target on cautioned exercises drops — one weight step down, reps toward the bottom of the range — and the caution line is surfaced prominently on their panel during the set;
  - **their partner's targets are untouched.** The household still trains the same movement together; only the affected person goes lighter. This is exactly what the per-person target overlay already exists to do, so it needs no change to selection.
  - Today shows a quiet banner ("Going lighter on Atul's shoulder work — 6 days left") so a flag never silently persists.
  - Escalation is opt-in, not automatic: if it still hurts light, the in-session "this hurts" tap offers **swap this exercise — for the household** (both people move to the substitute). Per-person swaps are deliberately *not* supported in v1: two different movements running on one shared timer means two demos, two durations, and a split coach line, which is a second player, not an overlay.
  - After ~2 weeks of a continuously renewed flag, the app suggests seeing a professional **once**, without nagging, and never offers a diagnosis or rehab protocol. FitDuo adjusts load and gets out of the way; it does not treat injuries.
- **Permanent per-person blocklist** ("never show me this again") in Settings — deferred to post-launch per Grok; the in-session swap covers the real cases first.

### R6 — The session says what it knows (the journey work; do before R2a)

Added 2026-08-16 from [JOURNEY.md](JOURNEY.md), which argued the problem and has
no backlog of its own. **The player requires nothing and therefore notices
nothing**; every motivational mechanism we have sits on screens visited outside
the session, while 95% of user-time is the 55 minutes inside it. This item is the
visual half of the fix — no voice, no new engines, only signals the code already
computes.

**Why before R2a, not after:** deciding what the *screen* says is deciding what
the *coach* will say. R2a then speaks lines that have already been read, argued
about and revised in a form you can edit. Building the voice first means
iterating on speech to settle content, which is the expensive order.

Three surfaces, from JOURNEY Part 5. **Ship them as separate slices, each one a
real session the household can train with** — three surfaces changing at once
makes the feedback undifferentiated.

- **R6a — the dead third** (rest + changeover, ~33% of every session at every
  duration; the only surface where nothing competes with a rep). Position ("block
  2 of 4 · 12 sets to go"), what to grab per person, and one earned fact:
  *last time 7.5 kg × 10* beside today's target, **shown only when it differs**.
  **That fact is baked into `WorkItem` at generate time**, beside the targets
  already frozen there — never read from `deriveProgression` in the player, which
  keys to the exercise's most recent *session*: the first `LOG_SET` makes today
  that session, so last would equal today and the fact would vanish for the rest
  of the block. A plan-borne value also survives a killed tab, which a
  Start-time snapshot does not (persist-on-Start is still M4). For bodyweight
  movements `weight` is 0 on both sides, so the comparison is **reps**, or those
  exercises silently never have news. Includes marking the Finisher as the peak — distinct
  treatment, the preceding gate announcing it as *framing only, never a control
  competing with the ratings*, and its own gate acknowledging it ended.
- **R6b — the landing** (cool-down → complete). Peak–end says these five minutes
  and the last screen *are* the memory. Cool-down framed as the ending rather
  than admin; the completion screen says something about the body — volume moved
  this session — not only the scoreboard.
- **R6c — the entry** (Today → Start). Deferred until R6a/b have been trained
  with: the card reads as an invoice today, but that is the least-evidenced of
  the three claims.

**Constraints, from JOURNEY Parts 2 and 6** — these are why the item is cheap and
must stay cheap: nothing motivational *inside* a set (a form cue is instruction,
which reduces load; motivation spends attention); no copy that can only be true
for one of two people on one screen; **no rep counter derived from planned
tempo** (`workSeconds` carries `setupSeconds`, doubles for unilateral, and is
maxed across two different rep targets, so it would lie); no "heaviest ever"
(see the witness decision below); no new achievements; no XP anywhere inside the
session.

### Three decisions this plan now makes (2026-08-16)

**1. Personal records stay dormant, and the rest-screen fact is the whole
celebration.** R1's follow-along contract logs uncorrected sets `assumed: true`
and `bestE1rm` ignores them, so PRs, the +15 XP bonus and `first_pr`/`pr_10` are
unreachable. **Do not "fix" this by trusting assumed sets** — the exclusion is
correct, and a gate tap means "we are here", not "I did ten". PRs revive the day
a witness exists (R2b's "I did eight", or an upward adjust); PR-keyed
achievements stay locked and are not renamed to fake it.

A first draft added a separate *moved up* moment for the weight rising. **Cut** —
R6a's rest screen is already showing last time beside today, which *is* the prize
for good work being better work (principle 2). A second celebration of the same
comparison is reward inflation, which Part 6 refuses.

**2. The 20-minute session stays peakless in v1.** `fitToBudget` drops the
`Finisher` at 20 minutes on all 20 measured dates, so the shortest session ends
Strength C → cool-down — and that is the session done on the worst day, whose
memory peak–end says matters most. The case for fixing it is real. It is still
declined, for three reasons found by checking rather than reasoning:

- **A 1-round Finisher is not a peak.** `estimatePlanSeconds` bills rest as
  `(rounds − 1) × restSeconds`, so a 1-round block has **no rest at all** — and
  JOURNEY measured the 60s-vs-75s rest gap as the Finisher's only dependable
  signal, the label being already on the pill, the gate and Preview. The fix
  would have shipped a name, not a climax.
- **The levers do not exist.** `MIN_ROUNDS = 2` floors every work block and
  trimming runs back-to-front, which is *why* the Finisher goes first. Getting to
  one round needs a new floor plus a drop-order change, or a `targetSeconds`
  branch — the duration special case §A0 exists to forbid. "Small generator
  work" was asserted, not measured.
- **Nobody has trained a 20-minute session.** JOURNEY's own default was to leave
  it, precisely because this is generator surgery; flipping that from zero
  sessions of evidence, in the same revision that defers the endgame *because*
  deciding from zero sessions repeats designing-before-training, is incoherent.

**Revisit when a real 20-minute session has been done and reported flat.** R6a
and R6b are trained at 35/55, which already have a peak, so nothing is blocked.

**3. Act 3 sustains the effort; whether it escalates the *information* waits for
one real session.** Intensity stays flat — the peak is the Finisher, and arriving
spent means there is no peak. That half is decided.

The other half — rest screens carrying progressively more as the session goes on —
is **deliberately not in R6a**. Two reasons: it is a second idea inside a slice
whose job is position, grab, last-time and the Finisher mark, and the obvious
content for it (*what the household has done today*) is per-person volume on one
shared screen, which principle 7 forbids in the same breath. Ship the plain
version, train with it, and let "did the middle sag?" be answered by someone who
was in it.

**Deferred with a trigger, not decided: the endgame.** JOURNEY notes the level
curve flattens near week ten and nothing takes over. Deciding that now, from zero
sessions of real use, would be the same mistake this plan already made once by
designing before anyone trained. Revisit after eight weeks of real sessions.

### F0 — First-session gate (added 2026-08-25): the foundation, as a finite list

Nine PRs merged since R1 and zero real sessions. Asked directly, the owner said
**"the app is not there yet"** — and named the gaps as *trust in the workouts*
and *the switching cost of leaving a routine that works*, *not* missing
features. Meanwhile the plan had been assuming training was already happening:
R6a called itself "the first thing the household actually trains with." The
repo measured progress in merges; the only users measured it in whether they
would hand it their bodies. Those diverged silently for nine days.

The owner's instinct — *the foundation should be better before we build the
voice* — is right on exactly one condition: **foundation is a finite checklist
with an exit test.** The unbounded version ("better" with no definition) is the
trap this section exists to prevent: the bar drifts up with the effort
invested, each polished PR makes "not yet" feel *more* true, and the app stays
unused forever. Foundation is therefore these three items and nothing else:

- **F0.1 — Trust pass.** Render 14 consecutive generated days for both
  profiles (the M3 dev page exists for this) and both of you review them
  against what your trainer would program: exercise choice, loads, weekly
  balance, anything that makes you wince. Findings land as content edits or
  one rule change each; anything larger is queued behind the gate, not built
  inside it. The right tool is `/preview` under plain `npm run dev` — real
  profiles are the correct object for a trust review — so **frames from this
  pass never leave the laptop**: findings land as content/rule diffs on the PR,
  never screenshots (gitignored is not unpublished, 2026-08-16). Exit: both of
  you can say "I'd do this week."
- **F0.2 — Lowest-stakes first sessions.** Not a trainer-replacement day: start
  wherever the stakes are lowest — a mobility session on a rest day is a fine
  on-ramp — but **the gate's exit requires one *generated strength* session**
  (short, 20–30 min, is fine), because the named blocker is trust in the
  generated workouts and a mobility session never touches the generator's
  strength programming. First-contact rule applies (DECISIONS 2026-08-16): the
  users drive, the author watches what they ask.

*(A trainer-reference doc was in this gate's first draft and was moved out on
review: it is R2a homework, not trust or switching, and blocking usage on a
writing task is the drift this gate exists to prevent. It returns below as R2a
prep — as `docs/TRAINER.local.md`, gitignored, because a household's training
notes on a public remote is the 2026-08-16 leak class again.)*

**Exit test for the whole gate: F0.1 passed *and* one real generated-strength
duo session completed, observations recorded in DECISIONS.md.** Then R2a
starts. **The clock starts the day this revision merges; the report — pass or
the honest reason why not (schedule, trust, or the product itself) — is due in
DECISIONS.md within 14 days of that date**, because a "not there yet" that
survives a *finished* checklist is a different and more important problem than
any item on it.

### 11-star takeaways (2026-08-25) — what the exercise actually changes

The premium-to-mass framing (YC's Dalton & Michael, Chesky's 11-star exercise)
was run against this plan; most of it the plan already does. Four things it
adds, each deliberately small:

1. **`docs/TRAINER.local.md` (gitignored) — done 2026-08-25**, and better than
   planned: instead of an evening of recollection, five recorded sessions
   (~4 h) were transcribed locally and distilled with timestamped evidence.
   It is a *crib sheet for which facts the templates speak and in what tone* —
   R2a stays template-driven over data the app already has, as §R2a specifies;
   authored per-exercise copy remains R2d. Everything load-bearing from it is
   lifted, sanitized, into §"The trainer corpus" below — the local file holds
   the receipts and must never be committed (real names throughout).
2. **Post-R5 acceptance test (not R2a's):** once readiness and pain context
   exist, the coach should say at least one thing per session that isn't on
   the screen. R2a is judged by its own spec — targets, cues, transitions, the
   feedback prompt — because before R5 the app knows nothing the screen
   doesn't.
3. **The couple is the thesis, not an implementation detail.** No product at
   any price offers a trainer for two bodies in one shared session — a human
   trainer can't split attention that way; software can. Standing note for
   copy and coach lines, not a new engine.
4. **Keep R2a and R5 adjacent in the sequence.** Voice becomes a *person* on
   the day it reacts to how you are today; resist inserting anything between
   them.

### The trainer corpus (2026-08-25): R2a's line spec, and the borrowing rule

`docs/TRAINER.local.md` is evidence, not plan — it is gitignored, so nothing in
it can be load-bearing for the repo. This section carries everything the plan
needs from it, sanitized (no names, no quotes); the local file has the
timestamped receipts, section numbers cited below.

**The borrowing rule.** The trainer coaches a dozen people over live video,
knowing nobody's equipment. Before copying any practice, ask: **is this craft,
or a workaround for her constraints?** Craft ports; workarounds don't — we know
both people's kit, history, and ratings, which she structurally cannot.

Worked example, ruled by the owner 2026-08-25: **the block-gate rating stays.**
The corpus shows she never asks for difficulty ratings (local §3.7) — but she
never needs to: she *watches* a dozen bodies, and her difficulty signal is
visual and continuous. The app is blind (local §8 — every form correction in
the corpus was a judgement made by eye), so the rating is the app's replacement
for her eyes, and it is load-bearing for per-person progression. What the
corpus adds is the missing *first half*: effort intent spoken **before** the
set ("leave two in reserve" / "last set — empty the tank"), which is her actual
craft; the retrospective rating is our instrument. They compose — intent before
is what makes the rating after meaningful. The same rule declines RPE numbers
in the UI and time-window sets (her scaling workarounds for unknown kit, local
§12.2), while keeping what sits under them: the pre-set intent line, speaking a
person's own rating back to them, and an explicit permission-for-a-short-set
line so a printed rep target never reads as pass/fail.

**R2a v1 speaks five line types — scoped against the player that exists**
(evidence: local §10; contact-checked in PR #25's review round):

1. **Approach ladder** through rest and the block gate — name the *within-block*
   next item at ~40/20/10 s; never announce across a gate what the gate hasn't
   shown. Data: `endsAt` + current block.
2. **Per-set effort intent, before the set** — "leave two in reserve" / "last
   set — empty the tank" — keyed to round index; the fiercest phrasing is
   reserved for the Finisher, the scheduled peak. The owner's nudge lives
   here, pre-set, where it is true for both people — never mid-set.
3. **Warm permission to rest** when a set closes, keyed for duo to both sides
   done.
4. **Last time, spoken** — history *used*, not displayed. Data:
   `WorkItem.lastTime`, already computed.
5. **Completion leads with the welfare beat** — an actual "how are you
   feeling?", numbers demoted below it.

The corpus's other six line types are a **ranked backlog, each with its blocker
named** — they earn their way in with evidence, not enthusiasm:

- *Countdown resolving into a name* — speech must land after the 3-2-1 beeps;
  beeps always win and are never delayed for a sentence.
- *One repeated cue in-set* — spends attention during work; wait for real
  sessions to show the silence hurts (JOURNEY's own constraint).
- *Load self-audit* — asks the block gate's question mid-session; at most once
  per session if ever.
- *Finish-time diagnostic* — needs a witness: fires only on a real early Done,
  phrased at household level (one duo Done logs both people).
- *Tempo spoken* — needs an authored **[catalog]** tempo cue; `secondsPerRep`
  is the time-budget estimator's number (warm-ups carry `1`) and speaking it
  would lie.
- *Permission for a short set* — invites reps the log won't record while
  auto-logs are `assumed: true`; waits for R2b's witness.

**Three decisions carried out of the corpus** (full reasoning: local §12):

1. **Hurt days are a household choice at Start — three doors, all already
   built.** No automatic swap: one person's pain flag must never delete the
   partner's strength day (R5's own constraint). The flag surfaces an offer on
   Today: do the mobility session *together*; train together with the flagged
   person going lighter (R5's existing per-person overlay); or split into two
   solo sessions — the solo flow has existed since M2, run sequentially on the
   shared laptop or on two devices once M4 syncs. The copy never pushes
   splitting: training together is the product. A walk button stays unbuilt —
   unobservable, so it is self-reported streak credit.
2. **No RPE, no time-windows; yes to what's underneath them** — the three
   keeps named in the borrowing rule above.
3. **Progression as a question, not an announcement** — committed 2026-08-25,
   specced as §R8 below; sequenced after R5 so R2a and R5 stay adjacent
   (takeaway #4), and landing as its own slice with a mock because it changes
   the changeover card's UI, not just copy.

**Queues fed by the corpus** — data and rules, per §A0, built when their slice
comes up, never before:

- **[catalog]** `primaryCue` (the one line worth repeating), `feelItHere`
  (where you should feel it), `loadCharacter` (heavy / light / bodyweight-fine
  — "go heavy" is directional per movement, not global); widen `setupNote`
  past 24/95.
- **[generator]** size blocks to fit rather than appending optional tails; a
  randomized-call finisher (teach a small vocabulary, then call a live
  sequence — the one place in the corpus where software can be *more*
  engaging than the human, and a natural fit for the Finisher R6a already
  marks as the peak); terminal-rep hold as an intensity variant.
- **[R5]** pain variants offered *before* the block, two options keyed to the
  flag (local §6 is the R5 source material).

**Two facts that sharpen F0** (local §11): the two users face different
incumbents — one leaves a live class that names her and fixes her form, the
other leaves recordings that know nothing — so the F0 trust verdict may split,
and the gate plans for the harder verdict, as its exit already requires. And
the household currently never trains together at all: the duo session is not
an optimization of their routine, it is the first shared workout they would
ever do. That is §11-star takeaway #3 stated as fact.

### R7 — The exercise intro: two kinds of changeover (2026-08-25; after F0, before R2a)

The owner's finding, checked against the corpus and confirmed: **15 seconds is
not enough to get a person ready for a movement** — but the trainer doesn't
have one changeover, she has two. The first time a movement appears she spends
2–3 minutes on a fixed teaching sequence; every later transition to it is the
fast form. Lengthening *every* changeover instead would cost real training:
changeovers fire between every different consecutive pair within a round —
twenty-plus per session — and 45 s each is ~10–15 minutes `fitToBudget` would
claw back out of actual work.

- **The intro (~30–45 s)** fires on an exercise's first appearance in the
  session, **scaled by familiarity**: per-exercise history already exists, so a
  movement this person has done many times gets the short form even on first
  appearance, and a genuinely new one gets the teaching. Content is
  catalog-carried: what it is, the muscles it targets (`primaryMuscles`), one
  authored why-it-helps sentence (95 lines of content work, drafted for owner
  review), what to be careful about (the structured `loads` field — this is
  the caution surface §A0 already promised), where you should feel it
  (`feelItHere`, from the [catalog] queue), then each person's load call.
  Skippable via the same Continue affordance as the gate.
- **The repeat changeover stays 15 s**: grab, targets, go.
- **The estimator bills the intro** — R1's lesson: any phase
  `estimatePlanSeconds` doesn't count makes `fitToBudget` plan blind.
- **The intro is also recovery** (owner's note, 2026-08-25): its seconds are
  real rest, which is why the longer first-encounter pause costs nothing
  physically. No offsetting rest reduction anywhere — if real sessions show
  early rounds feeling over-rested, that is a DECISIONS finding, not a
  pre-built adjuster.
- Resolves the corpus's open question about "concept blocks": the intro *is*
  the concept block, right-sized and attached to the movement it explains.
- **Screen before voice** — same logic that put R6 before R2a: train with the
  visual intro, then R2a speaks lines the screen already proved.

### R8 — Progression as a question (2026-08-25; after R5)

Evidence first, in the user's own words — *last time 10 kg × 10, and you
called it easy* — then an offer with two **equal** answers: try 12.5, or stay
at 10. Fires only when evidence exists (same load twice, rated easy or
just-right), per person, both people in the same session; silence otherwise is
what keeps it meaningful. The ± steppers stay as the always-available third
answer, so the proposal never traps anyone. It closes the loop the block gate
opens — the 😴/👌/🥵 rating currently vanishes into the generator; quoting it
back is the cheapest way the app can prove it was paying attention. And an
accepted offer is a **real witness** — a human confirmed an intent — which is
the first honest revival path for personal records since R1's follow-along
contract switched them off. Lands as its own slice with a mock; changes the
changeover card, so it is UI work, not copy.

### The persona — workshopped 2026-08-25; the brief is [docs/PERSONA.md](PERSONA.md)

A trainer that talks needs to be *someone*; template lines written without a
persona produce a notification system that talks. The workshop ran 2026-08-25
(owner + an outside-in research pass over the category — evidence, sources
and confidence levels durable in [docs/RESEARCH.md](RESEARCH.md)). Decisions,
binding for
R2a's lines, R2d's voice choice, and R2c's system prompt — full character and
evidence in the brief:

- **Honestly synthetic, knowing training partner** — warm, dry, factual;
  never performs emotion a synthetic voice can't carry (the research's
  sharpest finding: no beloved fitness product is built on TTS performing
  sentiment; TTS stating true specifics is liked). Authority from knowing the
  household's history, not from command.
- **Unnamed until R2b** — the name arrives the day the coach can hear it,
  and becomes the wake word. No gender; v1 settings stay voice / rate / mute
  (a verbosity dial — the Down Dog pattern — is deferred with end-user
  customization).
- **First names + "you two"; "champs" earned-only** (rare milestones, never
  wallpaper).
- **Intent-led effort with the edge only at scheduled peaks** (strength);
  sensation-over-range (mobility). One persona, two registers.
- **Sparse, named, data-grounded praise; silence is a selected variant;
  repetition budget halved** (two listeners) — variant pools and per-line
  cooldowns are R2a template architecture, not polish.
- **Never-list:** no unwitnessed claims, no guilt, no medical claims, no
  ranking the couple, no performed emotion.
- **Mechanism per §A0:** the persona compiles to a typed data object the
  templates render — one authored persona in v1; end-user customization later
  is content plus a settings screen. **The corpus's five R2a line types bound
  what the coach says; the brief is register and ritual within them, never
  additional line types** — and the peak nudge is pre-set intent, never
  mid-set speech.

### Data-model amendments — apply to `supabase/migrations/0001_init.sql` **before R1 lands**, not during M4
R5 ships before M4, so the schema must already carry what R1/R4/R5 produce or the first sync silently drops it (losing `assumed` flags means fake PRs and ratchets return).
- `set_logs.assumed boolean not null default false`.
- `workout_sessions.mode text not null default 'full'` — `full | short | mobility`.
- **Drop `unique (user_id, workout_date)`.** It makes a morning mobility session block the evening strength session, and it only ever existed to make "today's session" easy to find. Sessions are keyed by their UUID; "today" is the most recent session for that local date; streaks ask "does *any* completed session exist on this date". Same-day restart stays as the `abandoned → in_progress` transition.
- **Drop the write-once `xp_awarded` / `sets_completed` snapshot columns** — they contradict "XP is only derived" and will drift. The partner card derives from the partner's session + set rows client-side (trivial volume; RLS read already allows it).
- New append-only `person_events` table for `readiness` and `pain_flag` records (`user_id, kind, payload jsonb, effective_from, expires_on, logged_at`) — same derived-from-the-log discipline as everything else, no mutable state.
2. **M4 RLS test, stated precisely:** unauthenticated/foreign clients can do nothing; *partner* inserts of sessions/sets ARE allowed (household-trust duo requires it); no delete works for anyone; session status only advances except the defined same-day-restart transition.
3. **Same-day restart is a defined transition:** re-opening a day whose session was abandoned reuses the row (`abandoned → in_progress`), keeps already-logged sets, and appends new ones. Unique `(user_id, workout_date)` stays.
4. **Cross-device plan adoption includes session identity:** the second device drops its locally generated session id, adopts the server row's id and plan, and rebases its outbox onto that row.
5. **One household schedule** (not per-person): drives day-type rotation AND both streaks. Onboarding sets it once, editable in Settings.
6. **Cut from v1:** activity feed + emoji cheers, web push notifications, per-person schedules. M4 = auth + sync + derived partner card + onboarding. M5 loses push; keeps offline/install/polish/Lighthouse.

### Revised sequencing (one change at a time, each verified before the next starts)
1. ~~**R1**~~ — ✅ follow-along player shipped 2026-08-16 (PR #9), incl. the short strength session and the estimate fix (PR #10).
2. ~~R4 mobility~~ — ✅ shipped early 2026-08-14, ahead of R1, because it needed no player rewrite (all-timed blocks)
3. ~~**R6a**~~ — ✅ shipped 2026-08-16 (PR #22): a rest screen worth reading, and the Finisher marked as the peak.
4. ~~**R6b**~~ — ✅ merged 2026-08-25 (PR #23): cool-down as an ending, completion as more than a receipt.
5. **F0** — the first-session gate (§F0): trust pass + one real generated-strength session, 14-day clock running since 2026-08-25. **No feature work starts until its exit test passes** — the next slice is a session, not a PR.
6. **R7** — the exercise intro: two kinds of changeover (§R7), screen-first.
7. **R2a** — coach speaks the five v1 line types (§trainer corpus), in character per [docs/PERSONA.md](PERSONA.md) (persona workshopped ✅ 2026-08-25) — the gate rating stays, per the borrowing rule; Settings: voice picker, rate, mute (verbosity dial deferred with customization).
8. **R5** — readiness check + pain-aware generation + the three-door hurt-day offer (§corpus decision 1) — kept adjacent to R2a deliberately (§11-star takeaways #4).
9. **R8** — progression as a question (§R8), its own slice with a mock.
10. **R6c** — the entry (Today → Start), once R6a/b have been trained with
11. **R3a** — "Watch form ▶" video links
12. **R2b** — voice commands (hands-free control) — and the first real witness, which is what revives personal records (decision 1 above) and unlocks the witness-blocked backlog lines (§trainer corpus)
13. **M4** — accounts/sync/partner card/onboarding (slimmed) → **M5** PWA polish (no push) → **M6** launch

Post-launch: R2c conversational coach, R2d authored TTS, R3b self-recorded clips, activity feed, push.

Every milestone goes through the PR tail in [CLAUDE.md](../CLAUDE.md#workflow--every-change-goes-through-a-pr) — that is the single canonical version, and `merge-ready.sh` enforces it. Plan revisions of any size also go through Grok (`scripts/dev/grok-review.sh file docs/PLAN.md`) before execution starts.

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
- `profiles` — display name, `partner_id` (points at each other), timezone, `available_weights numeric[]`, **`equipment text[]`** (what that person owns — load-bearing since PR #3: generation filters on it per participant, and dropping the column silently deletes band/roller/step work from every session), `schedule` jsonb (workout days) + `schedule_history` (so editing your schedule never rewrites past streaks).
- `workout_sessions` — one per user per **local date** (`unique(user_id, workout_date)`); stores the shared generated `plan` jsonb (same `plan_hash` for both users on a duo day) + that user's target overlay + `generator_version` + `mode ('duo'|'solo')`, status `planned→in_progress→completed/abandoned`, and write-once completion snapshot (`sets_completed`, `xp_awarded`). A duo session simply writes two rows — streaks/XP stay purely per-person with no special casing.
- `set_logs` — append-only, one row per completed set, **client-generated UUIDv7 keys** (idempotent sync).
- `exercise_feedback` — one rating per exercise per session (`too_easy|right|too_hard`).
- **Deliberately absent:** `xp_events`, `streaks`, `achievements`, `exercises` tables. XP/level/streak/achievements are **derived by pure functions over the event log** (2 users × ~365 sessions/yr = trivial to replay; no stored counters, no drift). The exercise catalog is versioned static JSON bundled with the app — content updates are a deploy, not a migration.
- **RLS (household trust model):** read = own or partner's rows; **insert/update = own or partner's rows** — required because a duo session on the shared laptop is authenticated as one account but logs sets for both people. Acceptable for a two-person household of spouses; the real safety property is **no delete policies anywhere** (append-only enforced by the DB) and no third account can ever exist (signups disabled). Service-role key never ships to the client. Integration test asserts RLS is enabled per-table and an unauthenticated/foreign client can do nothing.

### Workout generator (`src/core/generator` — pure, no I/O, no `Date.now()`, no `Math.random()`)
- **Duo-aware by design:** exercise *selection* (structure, day type, which movements) is generated once per **household** — seed = `fnv1a32(householdId|dateISO|generatorVersion)` — from merged history (novelty/muscle-balance over the union, tier ceiling = min of the two users' ceilings, equipment = every participant can perform it *with their own kit* — NOT the intersection of their equipment lists, see docs/DECISIONS.md 2026-08-14 PR #3) so both do the same workout together. Per-person *targets* (weight × reps per exercise) are then computed from each person's own progression state as an overlay. A solo session is the same pipeline with a one-person household view.
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

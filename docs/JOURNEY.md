# The journey: why training drains, and what would energize it

Third document, beside [PLAN.md](PLAN.md) (what we are building) and
[DECISIONS.md](DECISIONS.md) (what we learned). This one holds **why the
experience works or doesn't, and what we refuse to build.**

[journey-map.html](journey-map.html) is the same argument as a readable page
(published as a private artifact). **This file is canonical** — the page is a
summary and carries no claim that isn't here.

It exists because R1 landed the mechanics — Start to celebration, hands free,
~4 taps — and the session still doesn't feel *energizing*. That is a design
problem, and it will not be solved by adding XP to more places. So: answer four
questions honestly, derive principles from the answers, audit the shipped app
against them, and write down the tempting things we will not do.

**This doc does not sequence work.** No ordering, no tickets. Where a fix is
obvious it points at the PLAN item that already owns it. PLAN.md stays the only
backlog.

**Evidence key.** Every claim is tagged, because n = 2 users, one real session,
and no analytics:

| Tag | Means |
|---|---|
| **[observed]** | someone actually said or did this, with a date |
| **[measured]** | computed by running our own code, not by arithmetic about it |
| **[research]** | established finding in exercise psychology; named so it can be checked |
| **[inferred]** | reasoning. Could be wrong. Most of this doc |

---

## Part 1 — Four questions

### 1. Why is it hard to keep training?

**The cost is immediate and vivid; the payoff is delayed and invisible.**
Adaptation shows up in 6–10 weeks. Discomfort shows up in 30 seconds. Nothing in
the daily loop pays you back on the same day *unless the session itself is
designed to*. **[inferred]** That sentence is the entire design brief; everything
below is a way of paying someone back today.

**How you feel *during* it predicts adherence better than why you started.**
Ekkekakis' dual-mode theory: in-task affect predicts 6–12 month adherence better
than intentions, beliefs or self-efficacy — and affect turns sharply unpleasant
once you spend real time above the ventilatory threshold. **[research]** The
consequence is uncomfortable for a training app: a program that is accidentally
maximal every day is not merely hard, it is *writing the memory that predicts
quitting*. Hard days have to be chosen, not accidental.

**You remember the peak and the ending, not the average.** Peak–end rule.
**[research]** So the cool-down and the completion screen are not administrative
trailers — they are the moment the session's memory gets written, and that memory
is what shows up tomorrow when someone decides whether to start.

**Progress you cannot perceive does not motivate.** People quit *while
progressing*, because nothing told them they were. **[inferred]** Our numbers all
exist and mostly aren't shown (Part 3).

**Goals expire; identity doesn't.** "Lose 5 kg" ends, or visibly stalls, and the
motivation ends with it. "I'm someone who trains" survives a bad week — which is
the thing a defanged streak is genuinely good at. **[research/inferred]**

**All-or-nothing breaks the chain.** 55-minutes-or-nothing is the fastest route
to a broken streak. Already understood and already fixed: PLAN §R4's short
session takes full streak credit and proportionally less XP.

### 2. Why does a workout feel *draining* rather than just hard?

Hard and draining are different, and conflating them is how programs get
gentler when they should get clearer. Draining has specific causes:

- **Effort without meaning.** The same set costs less when you know what it is
  for. Unexplained work is toil. **[inferred]**
- **Effort without a visible endpoint.** Not knowing how much is left raises
  perceived exertion at an identical workload — the pacing / teleoanticipation
  literature. **[research]** People pace to a known end; hide it and the same
  work feels worse.
- **Cognitive load.** Deciding, counting, remembering weights, driving the app —
  executive function drawn from the same tank as the effort. **[inferred]** The
  best thing a trainer gives you is that *you stop thinking*, and follow-along is
  the one item on the trainer list R1 already nailed.
- **Dead time that isn't recovery.** Boring gaps don't restore momentum, they
  dissipate it, so the next set starts cold. **[inferred]** A third of our
  session is that gap — see Part 3.
- **A program that never asks how you are.** Identical work on five hours' sleep
  costs more, and costs more again because nothing acknowledged it.
  **[inferred]** PLAN §R5 owns this.

### 3. Why do some trainers bring out your best, and others make you hate it?

This is the design brief in the most useful form available, because everyone has
felt both. What the good ones do:

1. **They watch.** Attention is the product. Someone counts your reps, notices
   rep 8 slowed, notices you favoured a side. Being seen changes effort — and it
   is not the same thing as being judged.
2. **They calibrate to the day, not to the plan.** "You look flat, we're doing
   quality at the lighter bell." The plan bends and the session still counts.
3. **They ask for one more at the right moment** — within reach, and *not every
   set*, because an ask that comes every time stops being an ask.
4. **They tell you why**, in one sentence. Meaning converts toil into work.
5. **They narrate the progress you can't see.** "That's more than a month ago."
   You forgot; they didn't.
6. **Their praise is specific, and therefore information.** "Nice" after every
   set discounts to noise inside a week. "Your knees stopped caving on that last
   one" is worth ten of them.
7. **They own the clock and the logistics**, so you never wonder what's next.
8. **They engineer the ending**, so you leave feeling capable rather than wrecked.

And the ones you come to dread: the same routine forever; volume as a substitute
for attention; every day maximal; work you were never given a reason for; and no
acknowledgement that you did it.

### 4. So how does it become something you look forward to?

- **Design for the memory, not the session** — one engineered peak of competence,
  and an ending that lands.
- **Keep the average pleasant.** Hard parts short, framed and finite.
- **Make progress visible weekly**, not only per-session, because that is the
  timescale on which it actually exists.
- **Autonomy inside the frame.** Self-determination theory: competence, autonomy,
  relatedness. **[research]** A prescribed program is strong on competence and
  *zero* on autonomy — precisely the profile of a program that works and is
  abandoned anyway. The frame should keep making the decisions; one real choice
  should live inside it.
- **Zero decisions before the start, about one inside it.**
- **Keep a smaller version that always counts**, so the identity never breaks.
- **Visibly respond when someone tells you something**, or they stop telling you.

---

## Part 2 — Principles

Seven, each with the failure it prevents. These are meant to be quotable in a
future PR when something plausible should be declined.

1. **Notice before you reward.** A point awarded by a system that didn't watch is
   worth less than a sentence from one that did. *Prevents: solving an attention
   problem with an economy.*
2. **The prize for good work is better work.** Progression, a harder variant, a
   heavier bell — not a badge. *Prevents: reward inflation, which has to keep
   inflating.*
3. **Never spend attention the set itself needs.** Anything motivational competes
   with the rep being performed. It belongs in rest, changeover, gate, or the
   ending. *Prevents: the mid-set toast that feels helpful and costs a rep.*
4. **Say the thing the app already knows** — but only if it's true (see the
   signal table in Part 3, where three of five tempting facts turn out not to be
   known at all). *Prevents: a number whose only witness is the code that
   computed it (DECISIONS, 2026-08-16).*
5. **A light day is a feature, not a failure.** Hard days are chosen. *Prevents:
   the accidental every-day-maximal program that trains people to dread it.*
6. **Design the ending, because that's what gets remembered.** *Prevents:
   finishing a good session on a numbers card.*
7. **One screen, two bodies.** A trainer move that can only address one person —
   counting along, "one more", "you look flat" — goes in copy both can hear, or
   nowhere. The player is one flow with one timer and two target overlays.
   *Prevents: designing a coach for a solo app and shipping it to a couple.*

---

## Part 3 — The shipped app, audited

### Where the session's time actually goes **[measured]**

Walking the real reducer over a real generated plan (55-minute setting, two
example profiles, 30 sets, 4 blocks):

| Phase | Time | Share |
|---|---|---|
| `work` — sets | 24 min | 48% |
| `rest` | 12 min | 24% |
| `timed` — warm-up + cool-down | 10 min | 19% |
| `changeover` | 4 min | 8% |
| `block_transition` | ~0 min | 1% |

**A third of the session — 17 minutes — is `rest` + `changeover` + transition.**
It holds across every duration the picker actually offers
(`STRENGTH_DURATIONS = [20, 35, 55]`, [planner.ts:143](../src/app/lib/planner.ts:143)):
**20 min → 28%** (5.6 of 20.1), **35 min → 34%** (12.1 of 36.0), **55 min → 33%**
(16.6 of 50.4). The shorter the session, the *less* of it is dead — which is its
own small argument for the short mode. Today that time
renders as a coloured ring, a thumbnail and a `+15s` button. It is simultaneously
**the largest uncommitted surface in the product and the only place where a
motivational idea does not compete with a rep** (principle 3). Everything the
trainer list wants to say has to fit here, at the gate, or in the ending.

### What R1 traded away, and the bill

R1's follow-along contract is right: the app calls the reps, so you stop
thinking. The cost is written honestly in the code — `assumed: true` on every set
logged without a human confirming it
([types.ts:98](../src/core/player/types.ts:98)).

Follow the flag downstream and it has a consequence nobody chose: **personal
records are now close to unreachable.** `bestE1rm` deliberately ignores assumed
sets ([derive.ts:206](../src/core/gamification/derive.ts:206)) — an unwitnessed
number must not set the bar real sets have to clear, which is correct. But after
R1 every uncorrected set is assumed ([reducer.ts:141](../src/core/player/reducer.ts:141)),
and the only thing that produces a *witnessed* set is an `ADJUST`, which is
usually someone recording a miss. So the PR path, the +15 XP PR bonus, and the
`first_pr` / `pr_10` achievements are all effectively switched off. **[inferred
from the code; not yet observed in a real log]**

This is the thesis in one mechanism: **the app traded witness for flow, and the
reward system went quiet as the price.** It also means the fix is not "add
rewards" but "restore witness" — the two are the same lever. Recorded here;
PLAN.md owns whether and when it changes.

### The trainer list, scored

| # | Trainer behaviour | FitDuo today |
|---|---|---|
| 1 | Watches | **No.** Logs what it prescribed |
| 2 | Calibrates to the day | **No.** PLAN §R5 owns it |
| 3 | Asks for one more | **No** |
| 4 | Says why | **No.** Never explains a session or a movement's purpose |
| 5 | Narrates unseen progress | **No.** The data exists; nothing renders it |
| 6 | Specific praise | **No.** "Block done! 🎉" |
| 7 | Owns clock and logistics | **Yes** — and does it well. R1's win |
| 8 | Engineers the ending | **Partly.** Cool-down exists; the last screen is a numbers card |

One of eight, and it happens to be the one that a program can do without a voice.
The other seven are exactly the ones PLAN §R2a (the coach that talks) is
positioned to deliver — which is a good sign for the sequencing, and the reason
this doc doesn't propose a new one.

### What is actually visible, where

Engagement lives on screens visited *outside* the session: Today (streak, level,
XP bar), Stats (level, streak, best streak, workouts, volume, 13 achievements —
[StatsScreen.tsx:47](../src/app/screens/StatsScreen.tsx:47)), and the completion
screen (XP, sets, streak). **PRs are derived and rendered nowhere at all.** The
55 minutes in between carry none of it, which is defensible for XP (principle 3)
and indefensible for meaning and progress.

### Octalysis, as a blind-spot check

Yu-kai Chou's framework is used here to check the four answers for blind spots,
not as the spine — the trainer list is more concrete and points the same way.

- **CD2 Development & Accomplishment** — the only drive really built (XP, levels,
  achievements, streak, PRs), and it *saturates*: `250·(L−1)^1.6` puts L10 at
  roughly ten weeks ([derive.ts:44](../src/core/gamification/derive.ts:44)),
  after which points stop carrying information. Left-brain, extrinsic.
- **CD3 Empowerment of Creativity & Feedback** — near zero, and it is the drive
  that never saturates. The user makes no meaningful choice all session. This is
  the same hole the trainer list finds at rows 1, 3 and 5.
- **CD1 Epic Meaning** — absent. Nothing says what a session is *for* (row 4).
- **CD7 Unpredictability & Curiosity** — thin. The generator produces real
  variety; the player used to hide it entirely, and partly still does between
  the gate and the next block.
- **CD4 Ownership** — latent. "My numbers, my kit, my history" is real and
  invisible.
- **CD8 Loss & Avoidance** — the streak, already defanged with weekly freezes and
  recovery-day credit. Keep it defanged.
- **CD5 Social Influence & Relatedness** — **deliberately deferred.** Two people
  in one room is a genuine asset and it is not what we are solving now.

The profile is a CD2 monoculture with one black-hat drive, which is the standard
recipe for "works for three weeks, then feels like a chore."

### Which signals we actually have **[measured / inferred]**

The tempting move is "surface what the pure core already computes." Three of the
five most attractive candidates turn out to be false, which is exactly why this
table is in the doc rather than a list of features:

| Signal | What it honestly supports | What it cannot |
|---|---|---|
| `muscleNeed`, rolling 7-day | **"Why this movement, in this slot"** — it is the `need` term in `scoreOf`, which ranks candidates *inside* an already-chosen pattern ([generate.ts:194](../src/core/generator/generate.ts:194)) | **not** "why this day". The day type is a fixed rotation over scheduled-day position ([generate.ts:59](../src/core/generator/generate.ts:59)) — a pull Wednesday is pull because it is the second scheduled day, not because your back is behind. Today already states the honest reason via `DAY_TYPE_LABEL` |
| `lastWeight` / `lastTargetReps` | **"Last time 7.5 → try 10"** on the target panel. In the PLAN product spec since v1; never built | — |
| `secondsPerRep`, `setupSeconds`, `sides` | the *planned* tempo | **not** a live rep counter. `workSeconds = setupSeconds + reps × secondsPerRep × sides`, maxed across two people with different rep targets ([generate.ts:234](../src/core/generator/generate.ts:234)). A counter derived from it would show "rep 2" while you're still picking up the bells, and cannot be either person's count on a shared timer |
| `bestE1rm` | nothing yet | **"heaviest ever"** — the well is empty by construction until the witness problem above is solved |
| the generator's scored top-3, then a PRNG pick | — | **not** a free user choice. The seed is `household\|date\|targetSeconds\|version`, a human pick is not in it, every pick moves `workSeconds` and `fitToBudget`, and with no persisted plan row (M4) a re-Start silently regenerates something else |

---

## Part 4 — The journey, moment by moment

From the real state machine in [reducer.ts](../src/core/player/reducer.ts).
Deliberately **no intervention column** — where a fix is obvious, the row names
the PLAN item that already owns it, or is tagged `not scheduled`. A design doc
that lists interventions per row is a second backlog, and this repo has been
bitten by unframed additions before (DECISIONS, 2026-08-15).

**`not scheduled` is the honest default, and R2a is not a dumping ground.** Its
scope is: speak both people's targets, the cues, what is coming, and the gate
prompt. That is already a full milestone. The first draft of this table quietly
assigned it warm-up framing, rest-screen facts, mid-set asks *and* spoken
corrections — which is exactly how v1 grows a coach that watches, and this app
cannot watch.

| Moment | Thinking | Needs | Gets today | Failure mode | Principle | Owner |
|---|---|---|---|---|---|---|
| **Today (cold)** | "Do I have it in me?" | A pull, and no decisions | Duration picker, exercise names, `~50 min`, streak/level cards | Reads as an invoice: a cost, a list, and a time quote | 4, 5 | `not scheduled` |
| **Start** | Committed | Immediate motion | Straight into warm-up | — (works) | 7 | — |
| **Warm-up** (7 × 40s, 4.7 min) | "Get on with it" | To be told what today is *for* | Images, ring, cues | The one moment framing is free, and nothing is framed. Note the real budget: 40 seconds an item, not the 10 minutes the measured table shows for warm-up **plus** cool-down | 4 | `not scheduled`. The *day type* is already stated honestly on Today; a movement's **purpose** is R2c, not R2a |
| **Changeover** (15s) | "Which bells?" | The instruction | "Grab 7.5 kg", next movement, ring captioned *to start* | — (works; was a real bug, fixed) | 7 | — |
| **`work`** (~48s × 30) | rep 5: "how many left?" rep 9: "one more?" | Pace, a witness, an ask | Countdown of *seconds*, Done ✓, ±reps, +15s | Nobody counts; the reps are recorded whether done or not; effort with no witness decays | 1, 3 | **`not scheduled`, and note the tension:** principle 3 says nothing motivational belongs *inside* the set, and principle 7 says a count true for one person is a lie for the other. R2a's scope here is reading the targets and cues, not coaching mid-rep. The witness question stays open |
| **Done ✓ early** | "Finished" | Acknowledgement | Silent advance | The most positive action in the session produces nothing | 1 | `not scheduled` |
| **`SKIP`** | "Not this one" — it hurts, *or* the space is wrong, *or* they hate it | To be asked which, and answered | Silent advance, nothing logged | Highest-signal action a user takes, thrown away — and it leaves guilt with no absolution | 1 | R5 owns **only** the "it hurts" branch; the other two are `not scheduled`. A skip is not a pain flag — treating it as one would write the pain list from "no room for lunges" |
| **`ADJUST`** | "That was too heavy" | To see it change something | Panel rings; feeds progression next session | Heard, never spoken back. Correct plumbing, invisible response | 1 | `not scheduled` — speaking a correction back is not in R2a's scope |
| **`rest`** (12 min/session) | "Breathe… how much more?" | Recovery, anticipation, one earned fact | Green ring, thumbnail, +15s | A quarter of the session on its own — **a third once changeover and transition are counted with it**, and that combined surface is the only place where nothing competes with a rep | 3, 6 | `not scheduled`. The one earned fact with real backing — "last time 7.5 → try 10" — is a **panel that was in the v1 product spec and never built**, not a spoken line |
| **`block_gate`** (×4) | "Block done. How was it?" | A coach's sentence | Rating chips, Continue, Finish here | The only human moment in an hour, spent on a form | 1, 6 | R2a |
| **Finish here** | "That's enough today" | Permission, not penalty | Completes honestly, no penalty | — (works, and quietly important) | 5 | — |
| **Cool-down** (5 × 60s, 5 min) | "Done — finishing up" | The peak–end *end*: the last five minutes are the ones that get remembered | Five silent 60-second holds, same `timed` view as the warm-up | **The row this doc nearly omitted, which would have been the whole argument failing on itself.** Principle 6 says design the ending; the ending is *here*, five minutes before the receipt, and it is the least designed screen in the session | 6 | `not scheduled` |
| **`complete`** | "Was that worth it?" | The memory, closed | 🎉, XP, sets, streak | Peak–end says the *ending* is the memory — and this screen is the last frame of it, currently a receipt | 6 | `not scheduled` |
| **Next morning** | "Did that do anything?" | Continuity | Today card, streak +1 | Yesterday is gone; nothing connects the two | 4 | `not scheduled` |
| **Week six** | "Is this still working?" | Visible weekly progress | Level curve flattening, volume total | CD2 saturates here; nothing takes over | 2 | `not scheduled` |
| **Month six** | "Who am I now?" | Identity, mastery | — | **No endgame exists.** Same abandonment PLAN §R5 names from the injury side | 2, 5 | `not scheduled` |

Two observations from the first real session (2026-08-16) sit behind this table
and are **already fixed** — kept because they are evidence about a *class*:

- *"First time I saw it I thought it had started the set"* **[observed]** — one
  ring meant two things. Fixed with tone + caption
  ([PlayerScreen.tsx:118](../src/app/screens/PlayerScreen.tsx:118)).
- *"I keep seeing lateral raises and chair dips only"* **[observed]** — said by
  someone stopped at a gate, one tap from two different movements. Fixed with
  `NextUpPreview` ([PlayerScreen.tsx:246](../src/app/screens/PlayerScreen.tsx:246)).

Both are **perception failures, not reward failures**: the work was varied and
the ring was correct, and neither fact reached the person. Two data points is
almost nothing, but it is all we have and it points the same way as Part 1.

---

## Part 5 — What we will not build

Each of these is plausible, cheap, and wrong. Decline by citation.

- **XP toasts, points or confetti during a set.** Overjustification: attaching
  payment to something already done willingly weakens the willingness — and these
  two already train daily. Violates principles 1 and 3.
- **A live rep counter derived from planned tempo.** It would lie by the setup
  time, double-count unilateral work, and cannot be either person's count on a
  shared timer. Same class as the estimate bug of 2026-08-16: a number whose only
  witness is the code that computed it.
- **More achievements.** 13 is already more than two people will notice. Badge
  inflation devalues the ones that mean something.
- **Praise after every set.** Discounts to noise inside a week (trainer trait 6).
  Specific and occasional, or not at all.
- **Streak anxiety** — loss-framed reminders, "don't break it now", a visibly
  crumbling flame. The streak stays defanged: freezes, recovery credit, short
  sessions counting in full.
- **Variable-ratio / surprise rewards on physical effort.** Slot-machine
  scheduling on a thing that hurts is how you build dread, not anticipation.
- **A mascot with feelings about your absence.**
- **A leaderboard.** (Whenever CD5 is picked up: two people in a relationship,
  never a scoreboard. PLAN already says "not a leaderboard".)

---

## Part 6 — Goals, and what would falsify this

**Working, at month six:** they still train without the streak being the reason;
sessions end with someone saying a sentence about the session rather than about
the app; nobody has asked "what am I doing this for?" in a while; a bad day
produces a short session instead of a skipped one.

**What would falsify the thesis** — worth writing down before we start believing
it:

- They keep training happily and ignore every piece of rest-screen content we
  add. *Then the dead time was fine and boredom was never the problem.*
- Removing or breaking the streak collapses adherence. *Then the black-hat drive
  was load-bearing all along and Part 1's identity claim is wrong.*
- The sessions they rate best are the ones this doc predicts should feel worst
  (long, silent, maximal). *Then affect-during is not the operative variable
  here, whatever the literature says about populations.*
- Voice lands and nothing else matters. *Then this doc over-theorised something
  R2a solves on its own — the cheapest outcome and a perfectly good one.*

The honest summary of our evidence: **one session, two people, two observations,
one measured time-split, and a code path traced to a consequence nobody
intended.** Everything else here is reasoning, and should be treated as the
weakest part of any argument it appears in.

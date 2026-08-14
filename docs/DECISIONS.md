# Decisions & learnings

Append-only. Newest first. This file exists so a **fresh session** (or another
person) inherits the *why*, not just the code — and so lessons get encoded once
instead of relearned.

**Placement rule** (borrowed from `~/dev/sherlock/docs/conventions/learning-loops.md`,
whose central finding was: *every prose-only prevention eventually failed under
velocity; every mechanical one held*). When something is learned, route it down
this ladder and **stop at the first rung that fits**:

1. **Eliminate** — change the code or content so the right thing is automatic.
2. **Test / gate** — a regression test is worth more than a paragraph. Anything
   that bit once and is mechanically checkable becomes a test, not a rule.
3. **On-demand doc** — a fact needed only when working in one area goes in
   `docs/` or next to that code.
4. **Always-on** (`CLAUDE.md`) — last resort. Every line is a permanent tax on
   every future session, so it must be cross-cutting AND needed *before* you know
   what you're working on.

The failure mode is writing everything into CLAUDE.md because it's frictionless.
CLAUDE.md should get *shorter* as the test suite grows.

---

## 2026-08-14 — Merge commits on `main`, and Grok reviews posted to the PR

Both of these were defaults nobody chose. Squash merging was simply what the
first two PRs happened to use; the Grok script didn't post because it was
written when this repo had no PRs (its header still said so).

**`main` merges with `gh pr merge --merge`.** The point is that a bug fix and
the commit explaining it survive as separate, blamable commits. Squash collapses
a branch into one commit, so `git blame` on a fixed line reports the squash, not
the fix — you lose the line's own history exactly where it's most wanted.
GitHub does keep merged branch commits at `refs/pull/N/head` forever, so squash
isn't total loss, but a trail that requires the GitHub UI isn't one `git log`
can follow.

*The cost, accepted knowingly:* the review tail verifies one sha, so with merge
commits `main` now also contains intermediate branch commits that were never
gate-verified and may not typecheck. `git bisect` can land on them.
**`git log --first-parent` is the gate-verified line of `main`** — use it for
history, and `git bisect --first-parent` when bisecting. Under squash these were
the same set; they no longer are.

**Enforced by nothing — on purpose, and this is a live bet.** The first draft of
this change added a hook branch denying `--squash`; the second reached for the
GitHub repo setting that disables squash and rebase outright. Both were dropped.
The escalation rule in this file is *earned*, not pre-emptive: the review tail
became a gate because it had already been skipped within an hour. Merge method
has never been skipped, it is one decision per PR rather than a step you drop
while tired, and every gate has a running cost — the merge gate already
false-positived on a commit message that merely said "merge", and needs
`tests/merge-gate.test.ts` alive forever or it decays into a no-op.

So this stays prose in CLAUDE.md, and the honest position is that prose is
weaker: **nothing currently prevents a squash merge from the CLI or the GitHub
UI.** If a branch does get flattened, that is the evidence, and the fix is the
repo setting (`gh repo edit --enable-squash-merge=false --enable-rebase-merge=false`)
— rung 1, no code — not a hook branch.

**Grok reviews post to the PR** (`gh pr comment`, anchored to the reviewed sha).
Deliberately *not* the `~/dev/sherlock` machinery — PENDING→COMMENT submission,
review-id snapshots, head-sha polling. That wrapper exists because two agents
ran in separate terminals with a human as the bus (7–25 min of stall per PR).
Here Grok and Claude share a session and the review is on stdout before anyone
acts on it, so posting buys **no latency** — only the durable trace that
`record-step.sh grok` was missing: it recorded that a review happened and kept
nothing of what it said, while the review itself is gitignored scratch.
Copying the full wrapper would have been ~250 lines solving a problem we don't
have.

*One thing here did earn a mechanism.* The remote is public and Grok runs with
`--always-approve`, so it can read `profiles.local.json` and quote it into a
comment — and this repo has already shipped personal data once by reading
"gitignored" as "unpublished". That is a bit that has bitten, silent when it
fails, and mechanically checkable, so posting is checked against local profile
and env *string* values (bare numbers would fire on every rep count) and fails
closed (`scripts/dev/lib/leak-check.mjs`, proof-of-bite in
`tests/leak-check.test.ts`). Deliberately not an opt-out flag: a flag does not
get set under the same velocity that skipped the review tail. The check only
counts a value as personal if it is absent from the checked-in template and
catalog — a guard that fires on "dumbbell" blocks every post and gets deleted
within a day.

*Two things self-review caught in that guard, both worth remembering.* The
whitelist compared by **substring**, which exempted any value sitting inside
catalog prose — measured against the real catalog, that silently exempted the
names Sam, Ben, Ron, Eve, Tim, Lou and Art ("same", "bend", "iron", "every",
"time", "cloud", "start"). A privacy guard with a hole exactly at short first
names is worse than none, because it is trusted. And it **failed open**: with an
unreadable or missing target it printed nothing, which the caller could not
distinguish from "scanned, clean". *For a guard, the interesting question is not
"does it catch?" but "what does it do when it cannot run?"*

---

## 2026-08-14 — PR #1: the review tail, applied to itself

The tail (frame → build → browser-verify → Grok → self-review → suite → merge)
was documented, then skipped within the hour under delivery pressure. Two code
commits shipped unreviewed. Running the reviews afterwards found **21 real
issues** across four rounds, including a privacy leak and a data-model mistake
that compounded daily.

**What the escalation cost, and what it bought.** Prose → gate: a sha-bound
record plus a PreToolUse hook that denies a merge, with `tests/merge-gate.test.ts`
as its proof-of-bite. The gate then invalidated Grok's own approval mid-PR
because code landed after it — which is the entire point.

**Grok and `/code-review` overlapped on one finding out of twenty-one.** They
see different classes: Grok reasons about the product and the data model over
time ("stamp `mode` before the log fills"; "a 10-minute stretch marking the day
Done invites skipping the workout"), while `/code-review` finds mechanical
defects in the diff. Running one is not a substitute for the other.

**The most useful thing that happened: a test that could not fail.** Grok
pointed out that no test covered mobility XP. I wrote one, then mutation-tested
it — reverted the code to the buggy version and the suite still passed. The
test was theatre: the mobility session has no sets, so both implementations
agreed. The test that bites is *two strength sessions in one day*, where
day-keying pays each for all ten sets. **New rule: when a test is written to
cover a specific bug, reintroduce the bug and watch it fail.**

Bug classes worth remembering from this PR:
- *Fixing at the wrong altitude.* Mode-aware XP was bolted onto date-keyed
  replay; it paid a whole day at whichever session came first. The fix was to
  make replay session-keyed, not to add another `mode ===` branch.
- *A boundary that stops being true.* Set ownership used `startedAt + 6h`. Once
  pausing could span hours, an overnight finish orphaned its own sets. The
  right primitive was `endedAt`, which was being discarded.
- *Reachability, not just correctness.* Resume worked — on a route reached only
  from inside a session. Closing the lid landed on Today, where the next Start
  silently discarded it.
- *Gitignored is not the same as unpublished.* `profiles.local.json` stayed out
  of the repo and went straight into the production bundle.

## 2026-08-14 — Session 1 (planning through mobility sessions)

### Decisions (and why)

| Decision | Why |
|---|---|
| **Duo sets are simultaneous**, one shared timer, `workSeconds = max` across participants | They each own a set of dumbbells. If they shared one pair, sets would alternate and the time budget would be a sum, not a max. |
| **Pain adaptation lives in the per-person target overlay, never in exercise selection** | Excluding overhead press for Atul's shoulder would have removed his wife's overhead pressing too. *Generalises: anything that varies per person belongs in the target overlay; only genuinely shared choices belong in selection.* |
| **Duration is a generator input, not a property of a session type** | "10 min before a workout, 25 when skipping one" — the same need the strength short-session was going to solve separately. One mechanism (`targetSeconds`) now serves both. |
| **XP / streaks / achievements are always derived from the event log, never stored** | Stored counters drift. Two users × ~365 sessions/yr replays instantly, so there is no reason to cache. |
| **Personal data (names, weights, pain areas, equipment) never enters the repo** | The GitHub repo is public. Lives in gitignored `profiles.local.json`; moves to Supabase at M4. |
| **Mobility sessions shipped before R1**, out of plan order | They are entirely timed blocks, so they needed no player rewrite — sequencing follows dependency, not plan numbering. |
| **Cut from v1**: activity feed, emoji cheers, web push, per-person schedules, permanent blocklist | Two people on one laptop need auth, backup, and a good daily flow — not a social layer. (Grok review.) |

### Bugs, and the class of mistake behind each

- **The app banked a workout nobody did.** Navigating away mid-session
  fast-forwarded every timed phase and logged a *completed* 9-minute session in
  94 seconds, with streak and XP. **All 53 tests were green.** Mobility sessions
  made it worse: with no strength sets there is no work phase to halt the chain.
  → *Class: unit tests verify the reducer, not the app.* Browser verification is
  load-bearing, not a nicety. Encoded as: the late-timer grace rule
  (`LATE_TIMER_GRACE_MS`) plus a regression test asserting an all-timed plan
  cannot self-complete.
- **One "too easy" tap raised the weight every session, forever.** Progression
  read the latest feedback *for the exercise across all time* rather than the
  latest *within that exercise's last session*, so a single rating compounded
  silently. → *Class: "most recent ever" is almost never what you mean; scope it.*
- **Two XP formulas, already divergent.** The completion screen recomputed XP
  with different full-clear semantics than the authoritative replay. → *Class: two
  sources of truth for one number drift immediately.* Fixed by showing the
  *delta of the derived value* rather than a parallel calculation.
- **A safety rule that would have fired in every normal session.** "Pause after
  two consecutive work phases with no interaction" — a superset is exactly two
  untapped work phases, so it would have stopped ~2 minutes into every real duo
  workout. → *Class: check safety rules against the happy path, not only the
  failure path they were written for.* (Caught by Grok before it was built.)
- **Cross-midnight sessions split in half.** Sets were bucketed by their own
  local date while completion used the session's date. → *Class: derive
  event-time facts once, at write time; don't recompute them at replay time.*

### Practices that earned their keep (keep doing these)

- **Grok cross-review of plan changes before executing them**
  (`scripts/dev/grok-review.sh`). Two rounds caught three design bugs that would
  have shipped, including the one that broke every session. ~10 minutes for a
  design flaw caught before code exists.
- **`/code-review` at each milestone.** Caught the progression ratchet.
- **Verifying in the browser, not just the suite.** Caught the fake-session bug
  that 53 green tests missed.
- **A bug found by hand is two bugs** — the bug, and the missing signal. Every
  one above left a regression test behind.

### Known debt / residue

- `notes` free-text in `profiles.local.json` is inert prose; `painAreas` is the
  real mechanism. Remove before anyone else uses this.
- Household id, schedule, and the two profiles are still constants.
- `TEMPLATES` (day-type slots) is still a hardcoded map in `generate.ts`; PLAN A0
  wants it in `content/day-templates.json`.

# Decisions & learnings

Append-only. Newest first. This file exists so a **fresh session** (or another
person) inherits the *why*, not just the code — and so lessons get encoded once
instead of relearned.

**Two or three whys, then stop.** Before routing anything, ask why it happened
and why nothing caught it — but stop while the answer is still concrete. Chains
run to four or five whys arrive at systemic causes whose only available fix is
new machinery; that is how a two-person project acquires a team's apparatus one
reasonable step at a time. If the honest answer at why-three is a mechanism,
that is a finding to record, not a licence to build one.

**Calibrate before borrowing.** The conventions in `~/dev/sherlock` are priced
against ~300 merged PRs/month and real production incidents. This is two users
on one laptop. Import the taxonomy — the ladder below, the classes of
mistake — not the apparatus. *Earned 2026-08-15: three consecutive PRs here
changed the review machinery and none changed the product.*

**Placement rule** (borrowed from `~/dev/sherlock/docs/conventions/learning-loops.md`,
whose central finding was: *every prose-only prevention eventually failed under
velocity; every mechanical one held*). When something is learned, route it down
this ladder and **stop at the first rung that fits**:

0. **Accept it** — name the risk, write it in the PR, build nothing. A real
   answer, and the default when the risk has never actually materialised here.
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

**The ladder assumes you should be on it at all.** Before routing, ask: *when did
this bite?* Grep this file for the date. The gates here that earn their cost
defend against incidents with a date attached; a mechanism defending against an
imagined one is paid for by every future PR and buys a feeling of safety.

---

## 2026-08-15 — The merge that landed the first draft

`merge-ready.sh` went green and `gh pr merge` merged a tree nobody had reviewed:
the branch was pushed once at its first commit and never again, so twelve rounds
of fixes stayed local while the remote tip — and so the merge — kept the first
draft.

Not a gate defect so much as an instruction one. Every tail step records against
`git rev-parse HEAD`; `gh pr merge` acts on the remote branch. Nothing in the
written workflow ever connected the two, so the gate could be perfectly correct
about a sha that was not the one being merged. **`main` was then wrong while
every record said it had been reviewed** — worse than an unreviewed merge,
because it reads as a verified one.

Fixed in CLAUDE.md step 5 as prose, not a hook: push and confirm `HEAD` equals
`@{u}` before merging. Rung 0 on purpose — this has bitten once, the check is
two commands, and this repo's merge gate has now produced exactly one false
pass, which is not the record that earns more machinery.

*Class:* the same one already written below about `post` stamping `HEAD` instead
of the reviewed sha — **a record of a check is only worth as much as the thing
it is bound to.** Fixed there for the review sha, left open for the merge.

And the sweep that sentence asks for immediately found a third: the review range
defaulted to `main..HEAD`, but work happens in worktrees where local `main` sits
in the primary checkout and never moves, so it had drifted two merges behind
`origin/main` — every review on the PR that wrote this covered an
already-merged commit. Defaulted to `origin/main..HEAD`. **Three steps of one
pipeline, each binding to whichever ref was nearest to hand rather than the one
carrying the consequence** — which is the whole class in one line, and why the
sweep is the instruction rather than any of the three fixes.

---

## 2026-08-15 — Eight review rounds on PR #3, and what the count meant

PR #3 converged after eight Grok rounds and every round found something real —
the tail was doing work the build should have done.

**The rule:** *past round two, the round count is a signal about the PR, not
about the reviewer.* The instinct at round three is that the reviewer is
thorough and the answer is to keep fixing. Stop and ask which shape you are in;
the prescriptions are opposite.

- **Shape A — your fixes are generating the findings.** The entry below ("A
  15-line change that took six commits") is the worked example. Prescription:
  **stop building.** This includes *editing* a load-bearing rule, not only
  adding one — the blast radius that makes a rule worth changing is what makes
  changing it expensive mid-PR.
- **Shape B — the findings were all in commit one; a review reads one diff at a
  time.** PR #3's `d867ce8` was 20 files carrying five separable concerns: the
  core type change, generator equipment filtering, content re-cues, the curation
  pipeline, and a Settings screen. Three of its rounds found things latent in
  that first commit and unrelated to any fix — including a `>= 3` pool floor on
  a line `d867ce8` itself edited without asking whether 3 was still right (a
  pull day consumes five). Prescription, the opposite of Shape A: **go read the
  concerns nobody has looked at yet** — the findings are already in your diff.

**Why the count runs up, underneath both shapes — the load-bearing part.**
Sherlock's `learning-loops.md` principle 3: *a done-criterion stated up front and
machine-checkable; never compensated for by manual verification.* Where a PR has
no such criterion, the reviewer is the only oracle, and review terminates when
the reviewer runs out of objections rather than when the work is done. Prose is
the worst case — its surface is unbounded, and any edit creates new claims to
check. **A change whose done-criterion cannot be machine-checked should be small
enough to read once, or it will be reviewed forever.**

**"One concern per PR" — considered, not adopted.** It does not survive contact
with PR #3: the type change, the eligibility predicate and the generator wiring
ship together or `main` carries a `requires` field the generator ignores. A rule
stated more strongly than it can be followed gets discarded whole. It stays an
observation — when a PR does carry several concerns, audit the quiet ones before
the reviewer does.

**A pre-code design pass for core-type changes — deferred, n = 1.** Three of PR
#3's rounds were design findings a short note would have caught cheaply, and
CLAUDE.md's trigger (*plan revisions get a Grok pass before execution starts*)
never fired because PR #3 never touched PLAN.md. Still one occurrence: every
other core-type change here either predates the workflow or had its design in
PLAN.md first. Widen the trigger on the second, not on this one.

**Verify substantively, not literally.** The candidate second occurrence was a
commit that changed core types without touching PLAN.md — true, and irrelevant:
PLAN.md had been revised for exactly those types twenty minutes earlier, so the
design *was* reviewed before it was code. The literal question (*does this commit
touch both files?*) is what `git show` answers in a second, which is why it gets
asked; the substantive one (*was this design unreviewed before it became code?*)
costs two more commands. Same shape as grepping today's catalog for a count that
belongs to one commit. **A claim that survives only the cheap question has not
survived anything** — this one moved a rule in CLAUDE.md before it was caught.

**Where the diagnostic lives.** One comment in the PR template's *framing*
block, read while the concerns are being named — the only point where the count
can still be changed. Nothing else. A first version also printed it from
`grok-review.sh` on every round; it fired a dozen times on the PR that added it,
changed no decision once, and was deleted. *Class: a reminder you have already
learned to skim is not a safeguard, and its firing count is the evidence.*

**Accepted, not fixed (rung 0):** `grok-review.sh` uses `tee`, so `post`
publishes only the last round — by construction the clean one, which defeats
half of why posting exists. And `file` mode never checks its path resolves.

## 2026-08-14 — A 15-line change that took six commits, and why

Worth recording as a failure of *process*, not of code — every commit below was
individually justified.

The ask was two things: post Grok reviews to the PR, merge instead of squash.
That shipped in one commit. A review then found a privacy risk **in that
addition**, and it was discharged by building a leak scanner. The scanner
generated its own findings — substring holes, fail-open behaviour, a whole-value
needle that missed `"First Last"`, and finally the discovery that it was a no-op
in a worktree — each discharged by building more. Then the machinery around
posting did the same. Six commits, four Grok rounds, cleanup diff ~5× the
original change. The scanner was deleted in the end; the correct answer had been
"accept the risk and write it down" from the first minute.

**Grok said stop, three times, in its `scope traps` section** — *"do not rebuild
the leak scanner", "do not import the Sherlock machinery"*. Those were read as
advice while every correctness finding was treated as an obligation. That
asymmetry is the whole failure. **A finding that says *this should not exist* is
worth more than one that says *this is broken*, and must be acted on with the
same force.**

Two structural causes, both now addressed in prose (deliberately not a gate —
gating this would be self-parody):

- **Fixes enter unframed.** The template forces *"are we solving the right
  problem?"* once, for the PR's stated intent. Everything harmful here arrived
  later as a *fix to a finding*, and a fix carries an implicit authorisation a
  feature does not. Had the scanner been its own PR, the framing section would
  have killed it in five minutes. Hence: **never build a new mechanism inside
  the PR that discovered the need for it.**
- **The ladder had no rung 0.** It routed *where* to encode a lesson and
  presupposed one must be encoded. "Accept it" is now rung 0.

The sentence *"escalation is earned, not pre-emptive"* was written into this file
during the same session that violated it, within the hour — the exact failure
mode this file already documents for CLAUDE.md prose. Which is the honest limit
of this entry too: it will not stop the next session by itself. The thing most
likely to stop it is the user saying "aren't we over-engineering?" — and the
lesson is to treat that as decisive on the first ask, not the third.

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
Here Grok and Claude share a session, so posting buys **no latency** — only the
durable trace that `record-step.sh grok` was missing: it recorded that a review happened and kept
nothing of what it said, while the review itself is gitignored scratch.
Copying the full wrapper would have been ~250 lines solving a problem we don't
have.

### The leak scanner that was built, reviewed, and deleted

The remote is public and Grok runs with `--always-approve`, so it *can* read
`profiles.local.json` and quote it into a public comment. The response was a
scanner (`leak-check.mjs`) that compared the review against local profile and
env values and failed closed. Two review rounds took it apart:

- It compared by **substring**, so any personal value sitting inside catalog
  prose was exempted. Measured against the real catalog that silently exempted
  the names Sam, Ben, Ron, Eve, Tim, Lou and Art ("same", "bend", "iron",
  "every", "time", "cloud", "start").
- It **failed open**: with an unreadable target it printed the same empty string
  it prints for "scanned, clean".
- After both were fixed, Grok found the one that ended it: real profiles store
  `name: "First Last"`, so a review saying *"Zebediah's target is wrong"* — the
  exact sentence the guard exists to stop — never matched the whole-value
  needle. And `profiles.local.json` does not exist in a **worktree** at all
  (gitignored files stay in the primary checkout), so in the way this repo
  actually runs reviews, the name half had no needles and was a no-op. The
  sandboxed tests passed anyway, because they built a layout we never run in.

Each fix was one more round of the same arms race: tokenize names but not
`notes` (or every review trips on "after"), resolve the primary worktree,
decide about `.env.*`. **Deleted.** Personal data is kept out by a privacy
paragraph in the Grok prompt instead.

*The lesson is not "guards are bad" — it is that a guard is only worth building
when it can be complete.* The gitignore that keeps profiles out of git is
complete: files are in or out. A text scanner over free-form prose never is, and
a partial privacy guard is worse than none, because it converts an obvious risk
that people stay alert to into a quiet one they trust. Ask "what does it do when
it cannot run?" and "what does it miss?" before writing the first line, not in
review.

*Residual risk, stated plainly:* nothing mechanically stops a review from
quoting a name, and **nothing downstream catches it either**. Posting is a
separate command (`grok-review.sh post`), but the merge tail has Claude run both
steps, so that is a separate *step*, not a human sign-off — do not let this
paragraph grow back into claiming otherwise. What the split actually buys: the
raw transcript is surfaced at a moment of its own instead of going straight out.
The first version posted automatically at the end of the review, and the
justification written for it here — "the review streams to the terminal, so it
is visible before anyone acts on it" — was simply false: in the merge tail
Claude runs the script, and the comment was public in the same breath as being
generated. Grok caught that, on this PR, in the paragraph defending it.

Worth keeping for the same reason: what `tee` captures is Grok's **entire stdout
transcript**, narration turns included, not a curated review. Auto-posting it
published that raw log to a public repo. A manual `post` makes the raw-transcript
problem visible to whoever posts, instead of routing it straight to strangers.
(`post` also refuses a file over 60 kB — GitHub's comment cap is 64 kB, and a
30-turn milestone transcript will reach it.)

**The subtler one: `post` must attest the sha that was *reviewed*, not `HEAD`.**
The first version stamped `HEAD`. With the written tail being review → fix →
post → `record-step.sh grok`, that meant: review sha A, commit the fixes as B,
post a comment saying "reviewed at B", record the Grok step at B, and
`merge-ready.sh` passes — certifying a tree nobody reviewed, in a comment whose
own text says a new commit invalidates the review. The reviewed sha is now
stamped when the review *starts*, and `post` refuses unless it equals `HEAD`. So
a fix commit forces another review, which is what the tail always claimed.
*A record of a check is only worth as much as the thing it is bound to.*

---

## 2026-08-14 — PR #3: exercises declare their gear, as alternatives

"Shoulder External Rotation" showed a photo of someone lying on a **bench**
while our cues said "elbow pinned to your side". The cause was structural:
`Exercise.equipment` was a single value copied from free-exercise-db, which
names only the *primary implement*. "Dumbbell Bench Press" is tagged
`dumbbell`; the bench was invisible to the generator, to eligibility checks,
and to the reader.

**The trap in the obvious fix.** Replacing one value with a flat `requires`
list would have tagged 12 movements as needing a bench and deleted them from a
household that has none — solving a photo mismatch by shrinking the catalog.
The audit said otherwise: of 19 flagged entries only **6** genuinely need gear.
The rest are ordinary floor movements that merely *happen to be photographed*
on a bench (floor press, floor fly, floor skullcrusher, standing Arnold press,
hinged reverse fly, thigh-braced row). They were re-cued for the floor and keep
`requires: [['dumbbell']]`. Nothing was lost. *Class: when accurate metadata
would delete content, check whether the metadata is wrong or the content is —
here it was the cues, not the exercise.*

**Why `requires` is a list of lists.** A chair dip works on a chair *or* a step
*or* a bench. A flat AND-list forces an arbitrary pick, which silently drops
the movement for whoever owns a different one — the same class of bug, one
level down. So `requires: Equipment[][]` means "every item of any one kit", and
`canPerform` is one `some(every)`. `[['dumbbell','bench']]` and
`[['chair'],['step']]` are both expressible; a flat list could only express the
first.

**Deliberately not built:** per-variant cue sets (bench cues *and* floor cues on
one exercise). The only beneficiary is a bench owner, and nobody here owns one —
PLAN §A1 names this failure mode. The predicate is already "any kit", so
variants would be additive later.

**Gym and home are presets, not modes.** `EQUIPMENT_PRESETS` lives in the app
layer and only fills in a person's `equipment` list. The generator has never
heard of "home" or "gym" and must not, or every new kit becomes a branch.

**The bug the new expressiveness introduced, caught by Grok.** Duo eligibility
was `canPerform(ex, A ∩ B)` — intersect the two people's equipment lists, then
check once. That was *correct* while an exercise named one implement, and
stopped being correct the moment kits became alternatives: for
`[['chair'], ['step']]`, one person on a chair and the other on a step can both
do the movement, but the intersection of their lists contains neither, so it
silently vanished for a pair who could do it. Measured on divergent kits: 4
movements lost. The rule is pairwise — `allCanPerform` asks each person's own
kit — and equipment moved onto `ParticipantInput` beside `availableWeights`,
where per-person things belong. *Class: an identity that held under the old
model is not carried forward by the type-checker. When a field gains
expressiveness, re-derive every rule that consumed it — do not port the rule.*

**Second Grok finding: a new failure mode reached a screen.** The strength
generator had never filtered by equipment, so `selectForSlot`'s
`no candidates for pattern X` was unreachable. Once it filters, a thin kit
throws — during `TodayScreen`'s render, i.e. a blank home screen. *Class:
making a check real makes its failure path reachable for the first time.*

The first attempt at that fix was itself half a fix, which the **second Grok
pass** caught: a `try/catch` around the duo plan only, in one component. It
swallowed every error as "not enough kit", left `/preview` and the Start
handlers uncaught, and — worst — hid *both* solo buttons when only one person's
kit was thin, so an under-equipped partner took away the other's workout. The
real fix has three parts: a typed `ThinKitError` so only that becomes `null`;
`tryPlanForToday` as the UI's single door, instead of a rule each screen must
remember; and checking solo separately, because the duo pool is the *smaller*
one. *Class: a `try/catch` at one call site is a local patch, not a boundary —
and a fix for "the pair cannot train" must not assume neither can.*

**Third Grok pass: a chair is not equipment.** Making `chair`/`wall` real
requirements was correct data and a bad outcome — nobody lists furniture, and
gitignored real profiles cannot be migrated, so five movements would have
silently vanished from a household that plainly has chairs and walls.
`ownedEquipment` now assumes a small `ASSUMED` set (bodyweight, chair, wall)
present for everyone, while `step` and `bench` stay declared: stairs are common
but not universal, and a knee-height surface that holds your weight is worth
asking about. The declaration still earns its place — it is what the catalog
badge and the `setupNote` read. *Class: "the data is now accurate" and "the
product got worse" can both be true; a requirement nobody would think to
declare needs a default, not a gate.*

**A guard set to a round number instead of the real one.** The pool-depth test
asserted `>= 3` candidates per pattern. A *pull* day selects **five** distinct
`pull_h` (three superset slots plus two circuit slots) and `usedToday` never
repeats, so four candidates throws. The margin was real today (six) and this is
the PR that retags `requires` — exactly how such a margin dies quietly, with
the test still green. The floor is now derived from `TEMPLATES`, so a new day
type cannot outgrow its own check. *Class: a threshold that was picked rather
than derived is a guess, and it silently stops matching the thing it guards.*

**The audit method was itself the bug.** The 19 flagged entries came from
grepping the source dataset's `instructions` for bench/step/platform. That
found every entry whose *text* mentions gear and none whose *photograph* shows
it. `db-split-squat` is a Bulgarian split squat with the rear foot on a bench:
source id `Split_Squat_with_Dumbbells`, equipment field "dumbbell", and the
word bench nowhere in its text. `db-triceps-kickback` is the same miss —
supporting hand on a bench. Grok caught both by reading the frames. Every
main and mobility entry without a `setupNote` was then re-audited **by opening
its images**, which is now written down where a curator will hit it (the
`setupNote` doc-comment in `content/scripts/selection.ts`) because no test can
see a photograph. *Class: a proxy for the thing is not the thing — text about
an image is not the image, and an audit is only as good as the signal it
actually reads.*

**Mutation-checked** (the rule from PR #1), all three re-run after the assumed
fixtures changed the fixtures underneath them: single-value `canPerform` fails
4 tests; intersect-then-check `allCanPerform` fails the divergent-kit test; an
untyped `throw` in `selectForSlot` fails the `ThinKitError` test. The
divergent-kit test had to move from chair/step to step/bench to keep biting —
once chair is assumed for everyone, a chair/step pair passes under *either*
rule, and the test would have quietly stopped testing anything. The property test needed fixing first
— it called `canPerform` on both sides, so it agreed with any bug the predicate
contained. It now checks the raw `requires` data independently. *Class: a test
that reuses the implementation as its own oracle cannot fail.*

Also: the strength generator had **no equipment filtering at all** — it was
mobility-only. And `curate.ts` now skips re-encoding frames that already exist,
so a metadata-only re-curation needs neither the network nor `sharp`.

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

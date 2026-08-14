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

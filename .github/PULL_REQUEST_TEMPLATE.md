# What & why

<!-- One paragraph. What changes, and what problem it solves. -->

## Are we solving the right problem?

<!-- REQUIRED — merge-ready.sh checks this section is filled in.
     The cheapest step to skip and the most expensive to skip.
     - What is the actual problem? (not "the task said so")
     - What is the simplest thing that solves it?
     - What are we deliberately NOT doing, and why?
     - Does this generalise, or is it bespoke to one person? (PLAN §A1)
     - How many concerns is this, and what says it is done? A review reads one
       diff, so a PR carrying several gets its findings one round at a time and
       the quiet ones are already in there — audit those yourself. State the
       done-criterion as an EXTERNAL FACT someone can check by reading the
       result ("step 4 says push before the tail"). "The reviewer has no
       remaining objections" is not a criterion — it is the loop, renamed, and
       CLAUDE.md rules it out. Where nothing is machine-checkable, keep the
       change small enough to read in one pass.

     Re-read this when a review finding tempts you to add a mechanism. If what
     you are about to build is not named above, it is a separate PR — fixes
     bypass this section in a way features cannot. See CLAUDE.md, filter 3. -->

## Declined

<!-- `## `, not `### ` — merge-ready.sh reads the framing section as everything
     up to the next `## `. Nested under `### `, decline text lands inside that
     range and counts as framing, so a PR with declines and an EMPTY framing
     block clears the length check. No figure is quoted here on purpose: it
     scales with how many decline lines a PR happens to have, and a number
     picked rather than derived stops matching what it guards.

     After round one, every finding gets a verdict here or a fix — nothing is
     left open. One line each: the failure it names, and why it is accepted.
     Empty is valid. A declined item is not re-raised unless a later round
     names a concrete failure this decline accepted. See CLAUDE.md. -->

## Verification

<!-- How this was verified in the REAL app, not only the suite.
     A green suite is not a working app — see docs/DECISIONS.md. -->

- [ ] Driven in the browser (say what you clicked and what you saw)
- [ ] Screenshot attached if UI changed

## Review tail

Each step is recorded against the head sha via `scripts/dev/record-step.sh`.
Any new commit invalidates all of them — that is the point.

- [ ] `grok` — `git fetch && scripts/dev/grok-review.sh diff` → fix → re-run against the final sha → read it → `scripts/dev/grok-review.sh post`; findings fixed or consciously declined
- [ ] `self-review` — `/code-review` (medium), findings fixed or consciously declined
- [ ] `suite` — `npm run typecheck && npm run test -- --run && npm run e2e` green on the FINAL sha

Merge is gated on `scripts/dev/merge-ready.sh`.

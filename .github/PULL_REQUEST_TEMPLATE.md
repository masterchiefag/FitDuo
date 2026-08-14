# What & why

<!-- One paragraph. What changes, and what problem it solves. -->

## Are we solving the right problem?

<!-- REQUIRED — merge-ready.sh checks this section is filled in.
     The cheapest step to skip and the most expensive to skip.
     - What is the actual problem? (not "the task said so")
     - What is the simplest thing that solves it?
     - What are we deliberately NOT doing, and why?
     - Does this generalise, or is it bespoke to one person? (PLAN §A1)

     Re-read this when a review finding tempts you to add a mechanism. If what
     you are about to build is not named above, it is a separate PR — fixes
     bypass this section in a way features cannot. See CLAUDE.md, filter 3. -->

## Verification

<!-- How this was verified in the REAL app, not only the suite.
     A green suite is not a working app — see docs/DECISIONS.md. -->

- [ ] Driven in the browser (say what you clicked and what you saw)
- [ ] Screenshot attached if UI changed

## Review tail

Each step is recorded against the head sha via `scripts/dev/record-step.sh`.
Any new commit invalidates all of them — that is the point.

- [ ] `grok` — `scripts/dev/grok-review.sh diff main..HEAD`, findings fixed or consciously declined
- [ ] `self-review` — `/code-review` (medium), findings fixed or consciously declined
- [ ] `suite` — `npm run typecheck && npm run test -- --run && npm run e2e` green on the FINAL sha

Merge is gated on `scripts/dev/merge-ready.sh`.

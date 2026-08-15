import type { FeedbackRating, PersonTarget } from '../generator/types'

/** A per-person correction to the current set, pending until it is logged. */
export type Overrides = Record<string, Partial<PersonTarget>>

export type PlayerState =
  | { phase: 'idle' }
  /** Any timed block (warmup, mobility, cooldown) — identified by blockIndex,
   *  never by scanning the plan for a block kind. */
  | { phase: 'timed'; blockIndex: number; itemIndex: number; endsAt: number }
  /**
   * A set, running on its own clock. The follow-along contract: when the timer
   * expires the set is logged and the session moves on, so a whole session
   * needs no interaction at all.
   *
   * `overrides` is the pending ADJUST for THIS set. It lives on the state, not
   * beside it, which is what makes it impossible for a correction to leak into
   * the next exercise: every exit from this phase drops it.
   */
  | {
      phase: 'work'
      blockIndex: number
      round: number
      itemIndex: number
      endsAt: number
      overrides?: Overrides
    }
  /** The 15s between two DIFFERENT exercises inside a round — swapping
   *  dumbbells is not rest, and rest already sits on the round boundary. */
  | {
      phase: 'changeover'
      blockIndex: number
      round: number
      nextItemIndex: number
      endsAt: number
    }
  | {
      phase: 'rest'
      blockIndex: number
      round: number
      nextItemIndex: number
      endsAt: number
    }
  | { phase: 'block_transition'; nextBlockIndex: number; endsAt: number }
  /**
   * The presence check, replacing each work block's final work→transition
   * edge: it HOLDS until someone taps Continue, roughly four taps a session.
   * `pauseAt` is not a deadline that advances anything — it is when an
   * unanswered gate concludes nobody is there and pauses.
   */
  | {
      phase: 'block_gate'
      blockIndex: number
      nextBlockIndex: number
      pauseAt: number
      /** `${userId}:${exerciseId}` -> rating, tapped on the gate itself. */
      ratings: Record<string, FeedbackRating>
    }
  | { phase: 'paused'; resumeState: PlayerState; pausedAt: number }
  | { phase: 'complete' }

export type PlayerEvent =
  | { type: 'START'; now: number }
  // Finish the set early. One tap advances it for ALL participants; overrides
  // carry per-person adjustments (userId -> actual reps/weight) on top of any
  // pending ADJUST.
  | {
      type: 'SET_DONE'
      now: number
      overrides?: Overrides
    }
  /** Correct the current set for one person. Scoped to this work item. */
  | { type: 'ADJUST'; now: number; userId: string; target: Partial<PersonTarget> }
  /** The block gate's big button: rate what is rated, assume 'right' for the rest. */
  | { type: 'CONTINUE'; now: number }
  /** "Cut it short" — an explicit completion at the block boundary, not an abandon. */
  | { type: 'FINISH_EARLY'; now: number }
  | { type: 'FEEDBACK'; now: number; userId: string; exerciseId: string; rating: FeedbackRating }
  | { type: 'TIMER_FIRED'; now: number } // idempotent: no-op unless now >= endsAt
  | { type: 'SKIP'; now: number }
  | { type: 'EXTEND_REST'; now: number; seconds: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'ABANDON'; now: number }

export interface SetLogDraft {
  userId: string
  exerciseId: string
  blockIndex: number
  setIndex: number
  targetReps: number
  actualReps: number
  weight: number
  loggedAt: number
  /**
   * Nobody corrected this set, so the app called it: the reps it prescribed are
   * the reps recorded. It counts as a target hit for progression (that is the
   * follow-along contract) but is excluded from PR detection — an unwitnessed
   * number must never become a personal record.
   */
  assumed: boolean
}

export type Effect =
  | { type: 'LOG_SET'; log: SetLogDraft }
  | {
      type: 'LOG_FEEDBACK'
      userId: string
      exerciseId: string
      rating: FeedbackRating
      loggedAt: number
    }
  | { type: 'CUE'; sound: 'countdown' | 'go' | 'rest' | 'complete' }
  | { type: 'PERSIST_SNAPSHOT' }
  | {
      type: 'SESSION_COMPLETE'
      abandoned: boolean
      /**
       * Set when the session ended early on purpose: everything after this
       * block was never programmed, so it must not count against them.
       */
      plannedThroughBlockIndex?: number
    }

export interface Transition {
  state: PlayerState
  effects: Effect[]
}

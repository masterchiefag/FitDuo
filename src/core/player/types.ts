import type { FeedbackRating, PersonTarget } from '../generator/types'

export type PlayerState =
  | { phase: 'idle' }
  | { phase: 'warmup'; itemIndex: number; endsAt: number }
  | { phase: 'work'; blockIndex: number; round: number; itemIndex: number }
  | {
      phase: 'rest'
      blockIndex: number
      round: number
      nextItemIndex: number
      endsAt: number
    }
  | { phase: 'block_transition'; nextBlockIndex: number; endsAt: number }
  | { phase: 'cooldown'; itemIndex: number; endsAt: number }
  | { phase: 'paused'; resumeState: PlayerState; pausedAt: number }
  | { phase: 'complete' }

export type PlayerEvent =
  | { type: 'START'; now: number }
  // One tap advances the set for ALL participants; overrides carry per-person
  // adjustments (userId -> actual reps/weight) when someone deviated from target.
  | {
      type: 'SET_DONE'
      now: number
      overrides?: Record<string, Partial<PersonTarget>>
    }
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
  | { type: 'SESSION_COMPLETE'; abandoned: boolean }

export interface Transition {
  state: PlayerState
  effects: Effect[]
}

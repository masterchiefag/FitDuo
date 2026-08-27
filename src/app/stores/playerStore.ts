import { create } from 'zustand'
import { reduce } from '../../core/player/reducer'
import type { PlayerEvent, PlayerState } from '../../core/player/types'
import type { FeedbackRating, WorkoutPlan } from '../../core/generator/types'
import { isAudioReady, playCue, unlockAudio } from '../../infra/audio'
import { keepAwake, releaseWakeLock } from '../../infra/wakelock'
import {
  appendFeedback,
  appendSession,
  appendSetLogs,
  clearSnapshot,
  loadSetLogs,
  saveSnapshot,
  type SessionSnapshot,
} from '../../infra/localstore'
import { sessionTotals } from '../../core/gamification/session'
import { statsFor } from '../lib/planner'
import { isWorkBlock } from '../../core/player/position'

export interface PersonSummary {
  userId: string
  setsLogged: number
  setsPlanned: number
  xp: number
  streak: number
  /** What the body did, not what the scoreboard says — see `sessionTotals`. */
  volumeKg: number
  reps: number
}

export interface CompletionSummary {
  abandoned: boolean
  durationSeconds: number
  people: PersonSummary[]
}

/**
 * Sets programmed for one person. `throughBlockIndex` is what "cut it short"
 * needs: ending on purpose at a block boundary means the later blocks were
 * never programmed, so counting them would report a session they chose to
 * finish as one they only two-thirds did.
 */
function plannedSetsPerPerson(plan: WorkoutPlan, throughBlockIndex?: number): number {
  let sets = 0
  plan.blocks.forEach((b, i) => {
    if (throughBlockIndex !== undefined && i > throughBlockIndex) return
    if (isWorkBlock(b)) sets += b.rounds * b.items.length
  })
  return sets
}

interface PlayerStore {
  plan: WorkoutPlan | null
  state: PlayerState
  startedAt: number
  setsLogged: Record<string, number> // userId -> count this session
  feedbackGiven: Record<string, FeedbackRating> // `${userId}:${exerciseId}`
  summary: CompletionSummary | null
  soundOn: boolean
  start: (plan: WorkoutPlan) => void
  resume: (snap: SessionSnapshot) => void
  dispatch: (event: PlayerEvent) => void
  reset: () => void
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  plan: null,
  state: { phase: 'idle' },
  startedAt: 0,
  setsLogged: {},
  feedbackGiven: {},
  summary: null,
  soundOn: false,

  /**
   * Load the plan and stop — the session does not begin here.
   *
   * `idle` is the opening ritual's screen (PlayerScreen): the day, its shape
   * and today's targets, waiting for one tap. START is dispatched from there,
   * which is also when the clock starts and the first snapshot is written, so
   * reading the shape for a minute is not billed as training and backing out
   * of the opening leaves nothing behind.
   */
  start(plan) {
    const ok = unlockAudio() // must run inside the Start tap
    keepAwake()
    set({
      plan,
      state: { phase: 'idle' },
      startedAt: Date.now(),
      setsLogged: {},
      feedbackGiven: {},
      summary: null,
      soundOn: ok,
    })
  },

  resume(snap) {
    unlockAudio()
    keepAwake()
    // Rebuild this session's counters from the log — they drive the numbers on
    // the completion screen, and zeroing them made every resumed session
    // under-report what was actually done.
    const setsLogged: Record<string, number> = {}
    for (const log of loadSetLogs()) {
      if (log.loggedAt >= snap.startedAt) setsLogged[log.userId] = (setsLogged[log.userId] ?? 0) + 1
    }
    set({
      plan: snap.plan,
      state: snap.state,
      startedAt: snap.startedAt,
      setsLogged,
      feedbackGiven: {},
      summary: null,
      soundOn: isAudioReady(),
    })
    const now = Date.now()
    // The user pressed Resume — one tap must put them back in the session.
    // Snapshots arrive in two shapes: already paused (late-timer rule), or a
    // live phase with a stale deadline (tab killed mid-hold). Wrap the latter
    // so both take the same tested RESUME path; otherwise the stale one fires
    // TIMER_FIRED, trips the late rule, and lands on the Paused screen.
    if (snap.state.phase === 'paused') {
      get().dispatch({ type: 'RESUME', now })
    } else {
      set({ state: { phase: 'paused', resumeState: snap.state, pausedAt: snap.savedAt } })
      get().dispatch({ type: 'RESUME', now })
    }
  },

  dispatch(event) {
    const { plan, state } = get()
    if (!plan) return
    // The session's clock starts with the warm-up, not with the opening screen
    // that precedes it: someone can stand and read the day's shape for a minute
    // before tapping, and that minute is not training time. Set before the
    // snapshot below is written, or a resumed session inherits the old stamp.
    if (event.type === 'START') set({ startedAt: event.now })
    const startedAt = get().startedAt
    const { state: next, effects } = reduce(plan, state, event)

    const logs = effects.flatMap((e) => (e.type === 'LOG_SET' ? [e.log] : []))
    if (logs.length > 0) {
      appendSetLogs(logs)
      set((s) => {
        const counts = { ...s.setsLogged }
        for (const l of logs) counts[l.userId] = (counts[l.userId] ?? 0) + 1
        return { setsLogged: counts }
      })
    }

    // Fast-forward (e.g. returning from a backgrounded tab) can emit a chain
    // of transitions; play only the final cue and persist once at the end.
    const lastCue = [...effects].reverse().find((e) => e.type === 'CUE')
    if (lastCue?.type === 'CUE' && get().soundOn) playCue(lastCue.sound)
    const shouldPersist = effects.some((e) => e.type === 'PERSIST_SNAPSHOT')

    for (const e of effects) {
      switch (e.type) {
        case 'LOG_FEEDBACK':
          appendFeedback({
            userId: e.userId,
            exerciseId: e.exerciseId,
            rating: e.rating,
            loggedAt: e.loggedAt,
          })
          set((s) => ({
            feedbackGiven: { ...s.feedbackGiven, [`${e.userId}:${e.exerciseId}`]: e.rating },
          }))
          break
        case 'SESSION_COMPLETE': {
          const setsPlanned = plannedSetsPerPerson(plan, e.plannedThroughBlockIndex)
          const durationSeconds = Math.round((event.now - startedAt) / 1000)
          const counts = get().setsLogged
          // XP shown = derived-XP delta, so the toast can never disagree with
          // the authoritative event-log replay on the Stats screen.
          const xpBefore = new Map(
            plan.participantIds.map((id) => [id, statsFor(id).totalXp] as const),
          )
          appendSession({
            dateISO: plan.dateISO,
            mode: plan.mode,
            participantIds: plan.participantIds,
            dayType: plan.dayType,
            startedAt,
            endedAt: event.now,
            abandoned: e.abandoned,
            setsLogged: Object.values(counts).reduce((a, b) => a + b, 0),
            setsPlanned: setsPlanned * plan.participantIds.length,
          })
          clearSnapshot()
          releaseWakeLock()
          // This session's own rows, by the same rule `resume` uses to rebuild
          // its counters: everything logged since Start. Read from the log
          // rather than accumulated in the store, so a session resumed after a
          // killed tab reports the work it actually did.
          const sessionSets = loadSetLogs().filter((l) => l.loggedAt >= startedAt)
          const people: PersonSummary[] = plan.participantIds.map((userId) => {
            const after = statsFor(userId)
            const totals = sessionTotals(sessionSets, userId)
            return {
              userId,
              setsLogged: counts[userId] ?? 0,
              setsPlanned,
              xp: Math.max(0, after.totalXp - (xpBefore.get(userId) ?? 0)),
              streak: after.streak,
              volumeKg: totals.volumeKg,
              reps: totals.reps,
            }
          })
          set({ summary: { abandoned: e.abandoned, durationSeconds, people } })
          break
        }
      }
    }
    if (shouldPersist && next.phase !== 'complete') {
      saveSnapshot({ plan, state: next, startedAt, savedAt: Date.now() })
    }
    set({ state: next })
  },

  reset() {
    releaseWakeLock()
    set({ plan: null, state: { phase: 'idle' }, summary: null, setsLogged: {}, feedbackGiven: {} })
  },
}))

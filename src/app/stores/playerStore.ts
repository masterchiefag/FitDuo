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
import { statsFor } from '../lib/planner'

export interface PersonSummary {
  userId: string
  setsLogged: number
  setsPlanned: number
  xp: number
  streak: number
}

export interface CompletionSummary {
  abandoned: boolean
  durationSeconds: number
  people: PersonSummary[]
}

function plannedSetsPerPerson(plan: WorkoutPlan): number {
  let sets = 0
  for (const b of plan.blocks) {
    if (b.kind === 'superset' || b.kind === 'circuit') sets += b.rounds * b.items.length
  }
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
    get().dispatch({ type: 'START', now: Date.now() })
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
    const { plan, state, startedAt } = get()
    if (!plan) return
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
          const setsPlanned = plannedSetsPerPerson(plan)
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
          const people: PersonSummary[] = plan.participantIds.map((userId) => {
            const after = statsFor(userId)
            return {
              userId,
              setsLogged: counts[userId] ?? 0,
              setsPlanned,
              xp: Math.max(0, after.totalXp - (xpBefore.get(userId) ?? 0)),
              streak: after.streak,
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

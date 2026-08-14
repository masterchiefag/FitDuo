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
  loadSessions,
  saveSnapshot,
  type SessionSnapshot,
} from '../../infra/localstore'

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

function computeStreak(userId: string, todayISO: string): number {
  // M2 placeholder: consecutive calendar days with a completed session,
  // ending today. Real schedule-aware derivation lands in M3.
  const sessions = loadSessions().filter((s) => !s.abandoned && s.participantIds.includes(userId))
  const days = new Set(sessions.map((s) => s.dateISO))
  days.add(todayISO)
  let streak = 0
  const d = new Date(todayISO)
  for (;;) {
    const iso = d.toISOString().slice(0, 10)
    if (!days.has(iso)) break
    streak += 1
    d.setDate(d.getDate() - 1)
  }
  return streak
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
    set({
      plan: snap.plan,
      state: snap.state,
      startedAt: snap.startedAt,
      setsLogged: {},
      feedbackGiven: {},
      summary: null,
      soundOn: isAudioReady(),
    })
    // Fast-forward any timers that expired while the app was closed.
    get().dispatch({ type: 'TIMER_FIRED', now: Date.now() })
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

    for (const e of effects) {
      switch (e.type) {
        case 'CUE':
          if (get().soundOn) playCue(e.sound)
          break
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
          appendSession({
            dateISO: plan.dateISO,
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
            const setsDone = counts[userId] ?? 0
            const full = setsDone >= setsPlanned
            const xp = (e.abandoned ? 0 : 50) + 2 * setsDone + (full ? 25 : 0)
            return {
              userId,
              setsLogged: setsDone,
              setsPlanned,
              xp,
              streak: e.abandoned ? 0 : computeStreak(userId, plan.dateISO),
            }
          })
          set({ summary: { abandoned: e.abandoned, durationSeconds, people } })
          break
        }
        case 'PERSIST_SNAPSHOT':
          if (next.phase !== 'complete') {
            saveSnapshot({ plan, state: next, startedAt, savedAt: Date.now() })
          }
          break
      }
    }
    set({ state: next })
  },

  reset() {
    releaseWakeLock()
    set({ plan: null, state: { phase: 'idle' }, summary: null, setsLogged: {}, feedbackGiven: {} })
  },
}))

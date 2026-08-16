// M2 persistence: localStorage. Swapped for Dexie + Supabase outbox in M4 —
// the player only talks to these functions, so the swap is contained here.
import type { PlayerState, SetLogDraft } from '../core/player/types'
import type { FeedbackRating, SessionMode, WorkoutPlan } from '../core/generator/types'

const KEYS = {
  // v3: work became a timed phase and the block gate replaced the last
  // work->transition edge, so a v2 snapshot resumes into a work state with no
  // deadline. Plans also carry `workSeconds` now, which a v2 plan lacks.
  snapshot: 'fitduo.snapshot.v3',
  setLogs: 'fitduo.setlogs.v1',
  feedback: 'fitduo.feedback.v1',
  sessions: 'fitduo.sessions.v1',
} as const

export interface SessionSnapshot {
  plan: WorkoutPlan
  state: PlayerState
  startedAt: number
  savedAt: number
}

export interface FeedbackEntry {
  userId: string
  exerciseId: string
  rating: FeedbackRating
  loggedAt: number
}

export interface SessionRecord {
  dateISO: string
  mode: SessionMode
  participantIds: string[]
  dayType: string
  startedAt: number
  endedAt: number
  abandoned: boolean
  setsLogged: number
  setsPlanned: number
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

export const saveSnapshot = (snap: SessionSnapshot) => write(KEYS.snapshot, snap)
export const loadSnapshot = () => read<SessionSnapshot | null>(KEYS.snapshot, null)
export const clearSnapshot = () => localStorage.removeItem(KEYS.snapshot)

export const appendSetLogs = (logs: SetLogDraft[]) =>
  write(KEYS.setLogs, [...read<SetLogDraft[]>(KEYS.setLogs, []), ...logs])
export const loadSetLogs = () => read<SetLogDraft[]>(KEYS.setLogs, [])

export const appendFeedback = (entry: FeedbackEntry) =>
  write(KEYS.feedback, [...read<FeedbackEntry[]>(KEYS.feedback, []), entry])
export const loadFeedback = () => read<FeedbackEntry[]>(KEYS.feedback, [])

export const appendSession = (record: SessionRecord) =>
  write(KEYS.sessions, [...read<SessionRecord[]>(KEYS.sessions, []), record])
export const loadSessions = () => read<SessionRecord[]>(KEYS.sessions, [])

/**
 * Wipe everything this app has stored on this browser.
 *
 * Named keys only — `localStorage.clear()` is keyed per ORIGIN, so on
 * localhost it would also take out whatever another project on :5173 left
 * behind. Adding a key to `KEYS` is enough to have it cleared here; the test
 * asserts that, because a key this forgets is a set log that keeps feeding
 * `deriveProgression` after the user asked for a clean slate.
 */
export const clearAllLocalData = () => {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key)
}

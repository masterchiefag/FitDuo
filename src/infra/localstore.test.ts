import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendFeedback,
  appendSession,
  appendSetLogs,
  clearAllLocalData,
  loadFeedback,
  loadSessions,
  loadSetLogs,
  loadSnapshot,
  saveSnapshot,
} from './localstore'
import type { SessionSnapshot } from './localstore'

// vitest runs in the node environment (vite.config.ts), so there is no
// localStorage here. The real thing is a dumb string map; this is enough of it
// to prove which keys the reset touches.
class MemoryStorage {
  private map = new Map<string, string>()
  getItem = (k: string) => this.map.get(k) ?? null
  setItem = (k: string, v: string) => void this.map.set(k, v)
  removeItem = (k: string) => void this.map.delete(k)
  clear = () => this.map.clear()
  get keys() {
    return [...this.map.keys()].sort()
  }
}

let store: MemoryStorage

beforeEach(() => {
  store = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
})

const SNAPSHOT = {
  plan: { id: 'p1' },
  state: { phase: 'work' },
  startedAt: 1,
  savedAt: 2,
} as unknown as SessionSnapshot

function seedEverything() {
  saveSnapshot(SNAPSHOT)
  appendSetLogs([
    {
      userId: 'a',
      exerciseId: 'x',
      blockIndex: 0,
      setIndex: 0,
      targetReps: 12,
      actualReps: 12,
      weight: 10,
      loggedAt: 1,
      assumed: false,
    },
  ])
  appendFeedback({ userId: 'a', exerciseId: 'x', rating: 'right', loggedAt: 1 })
  appendSession({
    dateISO: '2026-08-16',
    mode: 'full',
    participantIds: ['a', 'b'],
    dayType: 'push',
    startedAt: 1,
    endedAt: 2,
    abandoned: false,
    setsLogged: 1,
    setsPlanned: 1,
  })
}

describe('clearAllLocalData', () => {
  it('leaves every reader on its empty state', () => {
    seedEverything()
    expect(store.keys.length).toBe(4)

    clearAllLocalData()

    expect(loadSnapshot()).toBeNull()
    expect(loadSetLogs()).toEqual([])
    expect(loadFeedback()).toEqual([])
    expect(loadSessions()).toEqual([])
    expect(store.keys).toEqual([])
  })

  it('touches only this app’s keys', () => {
    seedEverything()
    // Another project on the same origin — localhost:5173 is shared, and
    // localStorage.clear() would take this with it.
    localStorage.setItem('someone-elses.key', 'keep me')

    clearAllLocalData()

    expect(store.keys).toEqual(['someone-elses.key'])
  })
})

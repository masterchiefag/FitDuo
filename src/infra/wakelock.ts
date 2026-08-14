let sentinel: WakeLockSentinel | null = null
let wanted = false

async function acquire() {
  if (!('wakeLock' in navigator)) return
  try {
    sentinel = await navigator.wakeLock.request('screen')
  } catch {
    // Not fatal — the wall-clock reducer loses no state if the screen sleeps.
  }
}

function onVisible() {
  if (wanted && document.visibilityState === 'visible') void acquire()
}

export function keepAwake() {
  wanted = true
  void acquire()
  document.addEventListener('visibilitychange', onVisible)
}

export function releaseWakeLock() {
  wanted = false
  document.removeEventListener('visibilitychange', onVisible)
  void sentinel?.release()
  sentinel = null
}

// WebAudio beeps — no assets. Must be unlocked inside a user gesture (iOS/Chrome).
let ctx: AudioContext | null = null

export function unlockAudio(): boolean {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    // Play one silent sample synchronously inside the gesture to unlock iOS.
    const buffer = ctx.createBuffer(1, 1, 22050)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)
    return true
  } catch {
    return false
  }
}

export function isAudioReady(): boolean {
  return ctx?.state === 'running'
}

function beep(freq: number, at: number, duration = 0.12, gainValue = 0.15) {
  if (!ctx || ctx.state !== 'running') return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(gainValue, at)
  gain.gain.exponentialRampToValueAtTime(0.001, at + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(at)
  osc.stop(at + duration + 0.02)
}

export type CueSound = 'countdown' | 'go' | 'rest' | 'complete'

export function playCue(sound: CueSound) {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime
  switch (sound) {
    case 'countdown':
      beep(880, t, 0.09, 0.12)
      break
    case 'go':
      beep(660, t)
      beep(880, t + 0.14, 0.18)
      break
    case 'rest':
      beep(440, t, 0.25, 0.12)
      break
    case 'complete':
      beep(523.25, t, 0.15)
      beep(659.25, t + 0.16, 0.15)
      beep(783.99, t + 0.32, 0.3)
      break
  }
}

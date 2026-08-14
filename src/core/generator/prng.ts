/** FNV-1a 32-bit hash — stable seed from string inputs. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32 — tiny deterministic PRNG, returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic pick of one element (list must be non-empty). */
export function pick<T>(rng: () => number, list: readonly T[]): T {
  if (list.length === 0) throw new Error('pick from empty list')
  return list[Math.floor(rng() * list.length)]!
}

/** Deterministic Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(rng: () => number, list: readonly T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

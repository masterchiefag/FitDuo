// Local-date helpers. All streak/schedule logic operates on local 'YYYY-MM-DD'
// strings; no cross-day Date arithmetic (avoids UTC/DST pitfalls).

export type LocalDateISO = string // 'YYYY-MM-DD'

/** Local date string for a given epoch-ms in the runtime's timezone. */
export function localDateISO(epochMs: number): LocalDateISO {
  const d = new Date(epochMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 0 = Monday ... 6 = Sunday, from a local date string. Pure string math + Zeller-free civil algorithm. */
export function weekdayIndex(dateISO: LocalDateISO): number {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number]
  // Sakamoto's algorithm (0 = Sunday) then shift to 0 = Monday
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4] as const
  const yy = m < 3 ? y - 1 : y
  const dow =
    (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + (t[m - 1] ?? 0) + d) %
    7
  return (dow + 6) % 7
}

/** dateISO + n days (n may be negative), pure civil-date math. */
export function addDays(dateISO: LocalDateISO, n: number): LocalDateISO {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number]
  // Use UTC internally purely as calendar arithmetic (no timezone semantics leak).
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000
  const nd = new Date(ms)
  const yy = nd.getUTCFullYear()
  const mm = String(nd.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(nd.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Whole days from a to b (positive if b is later). */
export function daysBetween(a: LocalDateISO, b: LocalDateISO): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number]
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number]
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

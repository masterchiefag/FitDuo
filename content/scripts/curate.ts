// One-off content pipeline: free-exercise-db -> content/catalog.json + public/exercise-media/*.webp
// Run: node content/scripts/curate.ts
// Source: https://github.com/yuhonas/free-exercise-db (Unlicense / public domain)
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SELECTION,
  MOBILITY_ADDITIONS,
  EQUIPMENT_MOBILITY,
  MOBILITY_META,
  type Curated,
} from './selection.ts'

// Which body areas a movement stresses, defaulted from its pattern. Per-slug
// overrides below. One source of truth for cautions, pain-flag load reduction,
// and substitution ranking (PLAN A0).
type Load = { area: string; stress: 'high' | 'moderate' }
const LOADS_BY_PATTERN: Record<string, Load[]> = {
  push_v: [{ area: 'shoulder', stress: 'high' }],
  push_h: [
    { area: 'shoulder', stress: 'moderate' },
    { area: 'elbow', stress: 'moderate' },
  ],
  pull_h: [
    { area: 'lower_back', stress: 'moderate' },
    { area: 'elbow', stress: 'moderate' },
  ],
  pull_v: [{ area: 'shoulder', stress: 'moderate' }],
  hinge: [{ area: 'lower_back', stress: 'high' }],
  squat: [{ area: 'knee', stress: 'moderate' }],
  lunge: [{ area: 'knee', stress: 'high' }],
  core: [{ area: 'lower_back', stress: 'moderate' }],
  carry: [{ area: 'lower_back', stress: 'moderate' }],
  mobility: [],
}
const LOAD_OVERRIDES: Record<string, Load[]> = {
  'push-up': [
    { area: 'wrist', stress: 'high' },
    { area: 'shoulder', stress: 'moderate' },
  ],
  'push-up-feet-elevated': [
    { area: 'wrist', stress: 'high' },
    { area: 'shoulder', stress: 'high' },
  ],
  'push-up-to-side-plank': [
    { area: 'wrist', stress: 'high' },
    { area: 'shoulder', stress: 'high' },
  ],
  'db-lateral-raise': [{ area: 'shoulder', stress: 'high' }],
  'db-front-raise': [{ area: 'shoulder', stress: 'high' }],
  'db-upright-row': [{ area: 'shoulder', stress: 'high' }],
  'db-arnold-press': [{ area: 'shoulder', stress: 'high' }],
  plank: [
    { area: 'wrist', stress: 'moderate' },
    { area: 'lower_back', stress: 'moderate' },
  ],
  'side-plank': [{ area: 'shoulder', stress: 'moderate' }],
  'jump-squat': [{ area: 'knee', stress: 'high' }],
  'split-jump': [{ area: 'knee', stress: 'high' }],
  'mountain-climber': [{ area: 'wrist', stress: 'moderate' }],
  'chair-dips': [{ area: 'shoulder', stress: 'high' }],
  // Mobility work is unloaded by default (pattern 'mobility' => no loads). The
  // neck isometrics are the exception: self-limited, but they do load the neck,
  // so declare it and let the pain-flag mechanism see them like anything else.
  'isometric-neck-front-back': [{ area: 'neck', stress: 'moderate' }],
  'isometric-neck-sides': [{ area: 'neck', stress: 'moderate' }],
  // Same reasoning: a prone extension loads the low back, unloaded or not.
  'prone-chest-lift': [{ area: 'lower_back', stress: 'moderate' }],
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CACHE = join(ROOT, 'content', '.cache')
const MEDIA_OUT = join(ROOT, 'public', 'exercise-media')
const RAW = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main'

interface SourceExercise {
  id: string
  name: string
  level: string
  primaryMuscles: string[]
  secondaryMuscles: string[]
  images: string[]
}

// Their muscle vocabulary -> our MuscleGroup (null = drop)
const MUSCLE_MAP: Record<string, string | null> = {
  chest: 'chest',
  shoulders: 'shoulders',
  traps: 'back',
  lats: 'back',
  'middle back': 'back',
  'lower back': 'core',
  neck: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: null,
  abdominals: 'core',
  quadriceps: 'quads',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  calves: 'calves',
  adductors: 'glutes',
  abductors: 'glutes',
}

function mapMuscles(source: string[], fallback: string[]): string[] {
  const mapped = [...new Set(source.map((m) => MUSCLE_MAP[m] ?? null).filter(Boolean))] as string[]
  return mapped.length > 0 ? mapped : fallback
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fetchCached(url: string, cachePath: string): Promise<Buffer> {
  try {
    await access(cachePath)
    return await readFile(cachePath)
  } catch {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} for ${url}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, buf)
    return buf
  }
}

async function main() {
  await mkdir(MEDIA_OUT, { recursive: true })

  const dbRaw = await fetchCached(`${RAW}/dist/exercises.json`, join(CACHE, 'exercises.json'))
  const db: SourceExercise[] = JSON.parse(dbRaw.toString())
  const byId = new Map(db.map((e) => [e.id, e]))

  const slugs = new Set<string>()
  const exercises = []
  const allSelected: Curated[] = [...SELECTION, ...MOBILITY_ADDITIONS, ...EQUIPMENT_MOBILITY]
  for (const sel of allSelected) {
    if (slugs.has(sel.slug)) throw new Error(`duplicate slug ${sel.slug}`)
    slugs.add(sel.slug)
    const src = byId.get(sel.sourceId)
    if (!src) throw new Error(`source id not found: ${sel.sourceId}`)
    if (src.images.length < 2) throw new Error(`${sel.sourceId} has <2 images`)

    const images: string[] = []
    for (const [i, img] of src.images.slice(0, 2).entries()) {
      const out = `${sel.slug}_${i}.webp`
      // Media is derived once and committed. Metadata-only re-runs (re-cues,
      // equipment retagging) are the common case, so skip the download and the
      // re-encode when the frame already exists — same bytes, no network, and
      // `sharp` only has to be installed when there is genuinely new media.
      if (!(await exists(join(MEDIA_OUT, out)))) {
        const jpg = await fetchCached(
          `${RAW}/exercises/${encodeURIComponent(img).replace(/%2F/g, '/')}`,
          join(CACHE, 'img', img),
        )
        const { default: sharp } = await import('sharp')
        await sharp(jpg)
          .resize({ width: 640, withoutEnlargement: true })
          .webp({ quality: 72 })
          .toFile(join(MEDIA_OUT, out))
      }
      images.push(`/exercise-media/${out}`)
    }

    exercises.push({
      id: sel.slug,
      name: sel.displayName,
      role: sel.role,
      requires: sel.requires,
      pattern: sel.pattern,
      primaryMuscles: mapMuscles(src.primaryMuscles, ['core']),
      secondaryMuscles: mapMuscles(src.secondaryMuscles, []).filter(
        (m) => !mapMuscles(src.primaryMuscles, ['core']).includes(m),
      ),
      tier: sel.tier,
      unilateral: sel.unilateral,
      repRange: sel.repRange,
      secondsPerRep: sel.secondsPerRep,
      setupSeconds: sel.setupSeconds,
      ...(sel.setupNote ? { setupNote: sel.setupNote } : {}),
      media: { images, instructions: sel.cues },
      loads: LOAD_OVERRIDES[sel.slug] ?? LOADS_BY_PATTERN[sel.pattern] ?? [],
      // Mobility metadata comes either from the additions themselves or from
      // the layer applied to exercises that already exist in the catalog.
      mobility:
        ('mobility' in sel ? (sel as { mobility?: unknown }).mobility : undefined) ??
        MOBILITY_META[sel.slug],
    })
    process.stdout.write(`✓ ${sel.slug}\n`)
  }

  const catalog = { version: 1, exercises }
  await writeFile(join(ROOT, 'content', 'catalog.json'), JSON.stringify(catalog, null, 2))
  const counts: Record<string, number> = {}
  for (const e of exercises) counts[e.role] = (counts[e.role] ?? 0) + 1
  console.log(`\ncatalog.json written: ${exercises.length} exercises`, counts)
}

await main()

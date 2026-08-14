// One-off content pipeline: free-exercise-db -> content/catalog.json + public/exercise-media/*.webp
// Run: node content/scripts/curate.ts
// Source: https://github.com/yuhonas/free-exercise-db (Unlicense / public domain)
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { SELECTION, type Curated } from './selection.ts'

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
  for (const sel of SELECTION as Curated[]) {
    if (slugs.has(sel.slug)) throw new Error(`duplicate slug ${sel.slug}`)
    slugs.add(sel.slug)
    const src = byId.get(sel.sourceId)
    if (!src) throw new Error(`source id not found: ${sel.sourceId}`)
    if (src.images.length < 2) throw new Error(`${sel.sourceId} has <2 images`)

    const images: string[] = []
    for (const [i, img] of src.images.slice(0, 2).entries()) {
      const jpg = await fetchCached(
        `${RAW}/exercises/${encodeURIComponent(img).replace(/%2F/g, '/')}`,
        join(CACHE, 'img', img),
      )
      const out = `${sel.slug}_${i}.webp`
      await sharp(jpg).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 72 }).toFile(join(MEDIA_OUT, out))
      images.push(`/exercise-media/${out}`)
    }

    exercises.push({
      id: sel.slug,
      name: sel.displayName,
      role: sel.role,
      equipment: sel.slug.startsWith('db-') ? 'dumbbell' : 'bodyweight',
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
      media: { images, instructions: sel.cues },
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

import { catalogSchema, type Catalog, type Exercise } from '../../core/catalog/types'
import raw from '../../../content/catalog.json'

// Zod-validated once at module load — the app can trust everything downstream.
export const catalog: Catalog = catalogSchema.parse(raw)

export const exercisesById: ReadonlyMap<string, Exercise> = new Map(
  catalog.exercises.map((e) => [e.id, e]),
)

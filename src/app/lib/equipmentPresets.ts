import { EQUIPMENT, type Equipment } from '../../core/catalog/types'

/**
 * Preset kits — a shortcut for filling in `equipment`, nothing more.
 *
 * Deliberately NOT a mode. The generator knows only what a person owns; it has
 * never heard of "home" or "gym" and must not, or every future kit becomes
 * another branch. These presets exist purely so nobody has to tick nine boxes.
 */
export interface EquipmentPreset {
  id: string
  label: string
  blurb: string
  equipment: Equipment[]
}

export const EQUIPMENT_PRESETS: EquipmentPreset[] = [
  {
    id: 'minimal',
    label: 'Minimal',
    blurb: 'A pair of dumbbells and floor space — nothing else assumed',
    equipment: ['bodyweight', 'dumbbell'],
  },
  {
    id: 'home',
    label: 'Home',
    blurb: 'Dumbbells, a band and a roller, plus the chair, wall and stairs you already have',
    equipment: ['bodyweight', 'dumbbell', 'band', 'roller', 'chair', 'wall', 'step'],
  },
  {
    id: 'gym',
    label: 'Gym',
    blurb: 'Everything, including a bench and a pull-up bar',
    equipment: [...EQUIPMENT],
  },
]

/** Short enough to chain with "or" on a badge: "Chair or Step or Bench". */
export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  bodyweight: 'Floor space',
  dumbbell: 'Dumbbells',
  band: 'Band',
  roller: 'Foam roller',
  bench: 'Bench',
  step: 'Step',
  chair: 'Chair',
  wall: 'Wall',
  pullup_bar: 'Pull-up bar',
}

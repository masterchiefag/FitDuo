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

/**
 * Chair and wall are deliberately absent from every preset: `ownedEquipment`
 * assumes them for everyone, so listing them would imply a switch that does
 * nothing. They stay in `Equipment` because `requires` still needs to name them
 * — that is what makes a badge read "Chair or Step or Bench".
 */
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
    blurb: 'Dumbbells, a resistance band, a foam roller, and stairs or a low box',
    equipment: ['bodyweight', 'dumbbell', 'band', 'roller', 'step'],
  },
  {
    id: 'gym',
    label: 'Gym',
    blurb:
      'Adds a bench and a pull-up bar. Unlocks nothing extra today — every movement in the catalog is doable at home, by design — but a bench is an alternative wherever one helps.',
    equipment: [...EQUIPMENT].filter((eq) => eq !== 'chair' && eq !== 'wall'),
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

// Hand-authored fixture plan for the M2 vertical slice. Exactly the shape the
// M3 generator will emit — swapping fixture->generated is a data-source change.
import type { PersonTarget, WorkItem, WorkoutPlan } from '../../core/generator/types'

interface TargetSpec {
  [exerciseId: string]: { p1: PersonTarget; p2: PersonTarget }
}

// Person 1 heavier / person 2 lighter; weight 0 = bodyweight.
const TARGETS: TargetSpec = {
  'db-squat': { p1: { targetReps: 10, weight: 10 }, p2: { targetReps: 12, weight: 5 } },
  'db-bent-over-row': { p1: { targetReps: 10, weight: 10 }, p2: { targetReps: 12, weight: 5 } },
  'db-chest-press': { p1: { targetReps: 10, weight: 10 }, p2: { targetReps: 12, weight: 5 } },
  'db-romanian-deadlift': { p1: { targetReps: 10, weight: 10 }, p2: { targetReps: 12, weight: 5 } },
  'db-shoulder-press': { p1: { targetReps: 10, weight: 7.5 }, p2: { targetReps: 12, weight: 2.5 } },
  'db-reverse-lunge': { p1: { targetReps: 8, weight: 7.5 }, p2: { targetReps: 10, weight: 2.5 } },
  'bodyweight-squat': { p1: { targetReps: 15, weight: 0 }, p2: { targetReps: 15, weight: 0 } },
  plank: { p1: { targetReps: 1, weight: 0 }, p2: { targetReps: 1, weight: 0 } },
  'russian-twist': { p1: { targetReps: 16, weight: 0 }, p2: { targetReps: 16, weight: 0 } },
}

function work(exerciseId: string, participantIds: string[]): WorkItem {
  const spec = TARGETS[exerciseId]
  if (!spec) throw new Error(`no fixture targets for ${exerciseId}`)
  const perPerson: Record<string, PersonTarget> = {}
  for (const id of participantIds) perPerson[id] = id === 'p1' ? spec.p1 : spec.p2
  return { exerciseId, perPerson }
}

export function buildDemoPlan(participantIds: string[], dateISO: string): WorkoutPlan {
  const w = (id: string) => work(id, participantIds)
  return {
    planVersion: 1,
    seed: 20260814,
    dateISO,
    mode: 'full',
    dayType: 'full_a',
    participantIds,
    estimatedSeconds: 2400,
    blocks: [
      {
        kind: 'warmup',
        items: [
          { exerciseId: 'arm-circles', seconds: 40 },
          { exerciseId: 'cat-cow', seconds: 40 },
          { exerciseId: 'hip-circles', seconds: 40 },
          { exerciseId: 'leg-swings', seconds: 40 },
          { exerciseId: 'inchworm', seconds: 40 },
          { exerciseId: 'groiners', seconds: 40 },
          { exerciseId: 'star-jumps', seconds: 40 },
        ],
      },
      {
        kind: 'superset',
        label: 'Strength A',
        rounds: 3,
        restSeconds: 75,
        items: [w('db-squat'), w('db-bent-over-row')],
      },
      {
        kind: 'superset',
        label: 'Strength B',
        rounds: 3,
        restSeconds: 75,
        items: [w('db-chest-press'), w('db-romanian-deadlift')],
      },
      {
        kind: 'superset',
        label: 'Strength C',
        rounds: 3,
        restSeconds: 75,
        items: [w('db-shoulder-press'), w('db-reverse-lunge')],
      },
      {
        kind: 'circuit',
        label: 'Finisher',
        rounds: 2,
        restSeconds: 60,
        items: [w('bodyweight-squat'), w('plank'), w('russian-twist')],
      },
      {
        kind: 'cooldown',
        items: [
          { exerciseId: 'childs-pose', seconds: 60 },
          { exerciseId: 'seated-hamstring-stretch', seconds: 60 },
          { exerciseId: 'kneeling-hip-flexor-stretch', seconds: 60 },
          { exerciseId: 'spinal-twist', seconds: 60 },
          { exerciseId: 'chest-stretch', seconds: 60 },
        ],
      },
    ],
  }
}

// Editorial curation table: free-exercise-db source id -> FitDuo catalog entry.
// Everything here (pattern, tier, rep ranges, tempo, cues) is our own authoring;
// only name/muscles/media come from the source dataset (Unlicense/public domain).

/** Mirrors EQUIPMENT in src/core/catalog/types.ts; the zod schema is authoritative. */
export type Equipment =
  'bodyweight' | 'dumbbell' | 'band' | 'roller' | 'bench' | 'step' | 'chair' | 'wall' | 'pullup_bar'

export interface Curated {
  slug: string
  /**
   * Alternative kits: you need every item of any ONE of them, so
   * `[['chair'], ['step'], ['bench']]` reads "a chair, a step or a bench".
   *
   * Mandatory, and deliberately not inferred. The curate script used to guess
   * it from the slug prefix (`db-` => dumbbell), which is the same shape as the
   * bug this field exists to fix: gear the pipeline never saw. A movement whose
   * kit nobody stated is a movement prescribed to someone who cannot do it.
   *
   * Declare only what the movement genuinely cannot be done without. Most of
   * the source dataset's demos were shot in a gym, but a chest press cued for
   * the floor needs no bench — re-cue it and use `setupNote`, rather than
   * gating it behind gear nobody at home owns.
   */
  requires: Equipment[][]
  /**
   * Reconciles the demo photo with our cues, e.g. "Shown on a bench — the floor
   * works fine". Required whenever the photo shows gear `requires` omits, or the
   * picture silently contradicts the text.
   *
   * **Curating a new entry means OPENING THE TWO FRAMES AND LOOKING AT THEM.**
   * Not the source `instructions`, not the source `equipment` field, not the
   * name. Both were used to audit this catalog and both missed
   * `db-split-squat`, whose frames are a Bulgarian split squat with the rear
   * foot on a bench: the id is `Split_Squat_with_Dumbbells`, the equipment
   * field says "dumbbell", and the word bench appears nowhere in its text. No
   * test can see a photograph; this is the step that has to be done by eye.
   *
   * What counts is gear the person is *supported by, standing on, or holding* —
   * a rack in the background of a gym shot is not a setup note.
   */
  setupNote?: string
  sourceId: string
  displayName: string
  role: 'warmup' | 'main' | 'cooldown'
  pattern:
    | 'push_h'
    | 'push_v'
    | 'pull_h'
    | 'pull_v'
    | 'squat'
    | 'hinge'
    | 'lunge'
    | 'core'
    | 'carry'
    | 'mobility'
  tier: 1 | 2 | 3
  unilateral: boolean
  repRange: [number, number]
  secondsPerRep: number
  setupSeconds: number
  /**
   * How the reps are paced, shown on the work screen. Authored per movement and
   * required on every `main` by `tests/catalog.test.ts`.
   *
   * It lives here rather than only in `catalog.json` because the catalog is
   * generated, not edited: written straight into the JSON it survives exactly
   * until someone runs `curate.ts`, which is how all 45 of these came to be one
   * pipeline run away from deletion.
   */
  tempoCue?: string
  /**
   * Where in the warm-up this goes — raise the pulse, mobilise the joints,
   * rehearse the patterns. Warm-ups only; `W()` requires it.
   *
   * Deliberately not `mobility.phase`: that field is the eligibility gate for
   * Mobility & Relief sessions, and tagging star jumps with it to answer this
   * question would put star jumps in a ten-minute relief session (#35).
   */
  warmupPhase?: 'raise' | 'mobilise' | 'rehearse'
  cues: string[]
}

// `warmupPhase` is required, not optional: `tests/catalog.test.ts` demands one
// on every warm-up, and a required argument makes that unwriteable rather than
// merely caught. The phase is authored because nothing already in the catalog
// says it — every warm-up carries `pattern: 'mobility'`, and `primaryMuscles`
// says what a movement touches, never when it belongs (#35).
const W = (
  slug: string,
  sourceId: string,
  displayName: string,
  warmupPhase: NonNullable<Curated['warmupPhase']>,
  cues: string[],
  setupNote?: string,
): Curated => ({
  slug,
  sourceId,
  displayName,
  warmupPhase,
  ...(setupNote ? { setupNote } : {}),
  // Not an inference: W() exists for timed, unloaded warm-ups. A warm-up
  // needing a band would be written out in full, not built with this.
  requires: [['bodyweight']],
  role: 'warmup',
  pattern: 'mobility',
  tier: 1,
  unilateral: false,
  repRange: [1, 1], // warmups are timed, reps unused
  secondsPerRep: 1,
  setupSeconds: 5,
  cues,
})

const C = (
  slug: string,
  sourceId: string,
  displayName: string,
  cues: string[],
  setupNote?: string,
): Curated => ({
  slug,
  sourceId,
  displayName,
  ...(setupNote ? { setupNote } : {}),
  // Same as W(): C() is for timed, unloaded stretches.
  requires: [['bodyweight']],
  role: 'cooldown',
  pattern: 'mobility',
  tier: 1,
  unilateral: false,
  repRange: [1, 1], // stretches are timed, reps unused
  secondsPerRep: 1,
  setupSeconds: 5,
  cues,
})

export const SELECTION: Curated[] = [
  // ─── Warm-up (timed, dynamic) ──────────────────────────────────────────────
  W('arm-circles', 'Arm_Circles', 'Arm Circles', 'mobilise', [
    'Arms straight out to the sides',
    'Small circles growing to large',
    'Reverse direction halfway',
  ]),
  W('shoulder-circles', 'Shoulder_Circles', 'Shoulder Rolls', 'mobilise', [
    'Roll shoulders up, back, and down',
    'Keep arms relaxed',
    'Big, slow circles',
  ]),
  W('dynamic-chest-stretch', 'Dynamic_Chest_Stretch', 'Dynamic Chest Opener', 'mobilise', [
    'Swing arms wide, then cross over',
    'Stay tall, ribs down',
    'Smooth rhythm, no bouncing',
  ]),
  W('dynamic-back-stretch', 'Dynamic_Back_Stretch', 'Dynamic Back Reach', 'mobilise', [
    'Reach forward and round the upper back',
    'Then open arms and squeeze shoulder blades',
    'Move with your breath',
  ]),
  W('hip-circles', 'Standing_Hip_Circles', 'Hip Circles', 'mobilise', [
    'Hands on hips, feet shoulder-width',
    'Draw big circles with your hips',
    'Both directions',
  ]),
  W('ankle-circles', 'Ankle_Circles', 'Ankle Circles', 'mobilise', [
    'Balance on one leg or hold support',
    'Circle the ankle both ways',
    'Switch feet halfway',
  ]),
  W(
    'leg-swings',
    'Front_Leg_Raises',
    'Leg Swings',
    'mobilise',
    ['Hold a wall for balance', 'Swing the leg front to back', 'Controlled, growing range'],
    'Shown holding a chair — a wall or a doorframe works just as well.',
  ),
  W('inchworm', 'Inchworm', 'Inchworm Walkout', 'rehearse', [
    'Fold, walk hands out to plank',
    'Keep legs as straight as comfortable',
    'Walk hands back and stand tall',
  ]),
  W('groiners', 'Groiners', 'Hip Opener Lunges', 'rehearse', [
    'From plank, step foot outside hand',
    'Sink the hips, chest up',
    'Alternate sides',
  ]),
  W('worlds-greatest-stretch', 'Worlds_Greatest_Stretch', "World's Greatest Stretch", 'rehearse', [
    'Deep lunge, opposite hand down',
    'Rotate chest to the sky, reach up',
    'Alternate sides slowly',
  ]),
  W('butt-kicks', 'Double_Leg_Butt_Kick', 'Butt Kicks', 'raise', [
    'Light jog in place',
    'Kick heels toward glutes',
    'Stay springy on the balls of your feet',
  ]),
  W('star-jumps', 'Star_Jump', 'Star Jumps', 'raise', [
    'Jump arms and legs wide',
    'Land soft with bent knees',
    'Steady pace, keep breathing',
  ]),
  W('cat-cow', 'Cat_Stretch', 'Cat-Cow', 'mobilise', [
    'On all fours, round the spine up',
    'Then arch and lift the chest',
    'Move slowly with your breath',
  ]),
  W('sit-squats', 'Sit_Squats', 'Air Squat Pulses', 'rehearse', [
    'Sit back like reaching for a chair',
    'Light and quick, half depth',
    'Warm up the knees and hips',
  ]),

  // ─── Main: horizontal push (chest, triceps) ───────────────────────────────
  {
    slug: 'push-up',
    requires: [['bodyweight']],
    sourceId: 'Pushups',
    displayName: 'Push-Up',
    role: 'main',
    pattern: 'push_h',
    tier: 1,
    unilateral: false,
    repRange: [6, 15],
    tempoCue: 'Lower over 2, pause an inch off the floor, press up in 1.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Body in one straight line',
      'Elbows ~45° from body',
      'Chest to the floor, full lockout',
    ],
  },
  {
    slug: 'push-up-feet-elevated',
    sourceId: 'Push-Ups_With_Feet_Elevated',
    displayName: 'Feet-Elevated Push-Up',
    role: 'main',
    pattern: 'push_h',
    // The elevation IS the exercise — without something to put your feet on
    // this is just a push-up, which the catalog already has.
    requires: [['chair'], ['step'], ['bench']],
    setupNote:
      'Shown with the feet on a gym bench — a sturdy chair or the bottom stair is the same thing.',
    tier: 3,
    unilateral: false,
    repRange: [6, 12],
    tempoCue: '2 seconds down, brief pause at the bottom, drive up in 1.',
    secondsPerRep: 3,
    setupSeconds: 15,
    cues: ['Feet on a sturdy chair or step', 'Brace hard — no sagging hips', 'Lower under control'],
  },
  {
    slug: 'push-up-to-side-plank',
    requires: [['bodyweight']],
    sourceId: 'Push_Up_to_Side_Plank',
    displayName: 'Push-Up to Side Plank',
    role: 'main',
    pattern: 'push_h',
    tier: 2,
    unilateral: false,
    repRange: [6, 12],
    tempoCue: 'Press up in 1, rotate over 2, hold the top for a breath.',
    secondsPerRep: 4,
    setupSeconds: 10,
    cues: [
      'Push up, then rotate to one arm',
      'Stack shoulders, reach for the ceiling',
      'Alternate sides',
    ],
  },
  {
    slug: 'db-chest-press',
    requires: [['dumbbell']],
    sourceId: 'Dumbbell_Bench_Press',
    displayName: 'Dumbbell Floor Press',
    role: 'main',
    pattern: 'push_h',
    setupNote:
      'Shown on a gym bench — the floor works fine. Your upper arms stop at the floor, which is a safe depth for the shoulder.',
    tier: 1,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: 'Lower over 2 until the elbows touch down, pause, press in 1.',
    secondsPerRep: 3,
    setupSeconds: 15,
    cues: [
      'Lie on your back, knees bent, feet planted',
      'Press the dumbbells straight up over mid-chest',
      'Lower until your upper arms rest on the floor, then press again',
    ],
  },
  {
    slug: 'db-chest-fly',
    requires: [['dumbbell']],
    sourceId: 'Dumbbell_Flyes',
    displayName: 'Dumbbell Chest Fly',
    role: 'main',
    pattern: 'push_h',
    setupNote: 'Shown on a bench — do it on the floor; the floor stops you at a safe depth.',
    tier: 2,
    unilateral: false,
    repRange: [10, 15],
    tempoCue: 'Open over 2 with soft elbows, close in 1 — never bounce at the bottom.',
    secondsPerRep: 3,
    setupSeconds: 15,
    cues: [
      'Lie on your back, dumbbells above your chest',
      'Slight bend in the elbows — keep it the whole way',
      'Open wide until your upper arms touch the floor, then hug them back up',
    ],
  },
  {
    slug: 'db-overhead-triceps-extension',
    requires: [['dumbbell']],
    sourceId: 'Standing_Dumbbell_Triceps_Extension',
    displayName: 'Overhead Triceps Extension',
    role: 'main',
    pattern: 'push_h',
    tier: 1,
    unilateral: false,
    repRange: [10, 15],
    tempoCue: 'Lower over 2 behind the head, press up in 1 — elbows stay still.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'One dumbbell, both hands overhead',
      'Elbows stay close to your ears',
      'Lower behind head, press up',
    ],
  },
  {
    slug: 'db-triceps-kickback',
    requires: [['dumbbell']],
    setupNote:
      'Shown with a knee and hand on a bench — hinge forward from standing instead, free hand on your thigh.',
    sourceId: 'Tricep_Dumbbell_Kickback',
    displayName: 'Triceps Kickback',
    role: 'main',
    pattern: 'push_h',
    tier: 1,
    unilateral: false,
    repRange: [10, 15],
    tempoCue: 'Extend in 1, hold straight for 1, return over 1 — the upper arm never moves.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Hinge forward, flat back',
      'Pin upper arms to your sides',
      'Straighten fully, squeeze, return slow',
    ],
  },
  {
    slug: 'db-skullcrusher',
    requires: [['dumbbell']],
    sourceId: 'Lying_Dumbbell_Tricep_Extension',
    displayName: 'Lying Triceps Extension',
    role: 'main',
    pattern: 'push_h',
    setupNote: 'Shown on a bench — the floor works just as well.',
    tier: 2,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: 'Lower over 2 towards the forehead, pause, press up in 1.',
    secondsPerRep: 3,
    setupSeconds: 15,
    cues: [
      'Lie on the floor, dumbbells over your shoulders',
      'Bend only at the elbows — upper arms stay still',
      'Lower beside your ears, then press back up',
    ],
  },
  {
    slug: 'chair-dips',
    sourceId: 'Bench_Dips',
    displayName: 'Chair Dips',
    role: 'main',
    pattern: 'push_h',
    requires: [['chair'], ['bench'], ['step']],
    setupNote: 'Shown on two gym benches — one sturdy chair with your feet on the floor is plenty.',
    tier: 2,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: 'Lower over 2, pause at the bottom, press up in 1 — shoulders down.',
    secondsPerRep: 3,
    setupSeconds: 15,
    cues: [
      'Hands on a sturdy chair edge',
      'Lower until elbows hit ~90°',
      'Keep shoulders away from ears',
    ],
  },

  // ─── Main: vertical push (shoulders) ──────────────────────────────────────
  {
    slug: 'db-shoulder-press',
    requires: [['dumbbell']],
    sourceId: 'Standing_Dumbbell_Press',
    displayName: 'Standing Shoulder Press',
    role: 'main',
    pattern: 'push_v',
    tier: 1,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: 'Press up in 1, lower over 2 — no leaning back.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Dumbbells at shoulder height',
      'Press straight up, biceps by ears',
      'Ribs down — don’t arch the back',
    ],
  },
  {
    slug: 'db-arnold-press',
    requires: [['dumbbell']],
    sourceId: 'Arnold_Dumbbell_Press',
    displayName: 'Arnold Press',
    role: 'main',
    pattern: 'push_v',
    setupNote: 'Shown seated on a bench — standing works, and asks more of your core.',
    tier: 2,
    unilateral: false,
    repRange: [8, 12],
    tempoCue: 'Rotate and press in 2, reverse it over 2 — one smooth path.',
    secondsPerRep: 4,
    setupSeconds: 10,
    cues: [
      'Stand tall, ribs down, palms facing you',
      'Rotate out as you press up',
      'Reverse the spiral on the way down',
    ],
  },
  {
    slug: 'db-lateral-raise',
    requires: [['dumbbell']],
    sourceId: 'Side_Lateral_Raise',
    displayName: 'Lateral Raise',
    role: 'main',
    pattern: 'push_v',
    tier: 1,
    unilateral: false,
    repRange: [10, 18],
    tempoCue: 'Up in 1, pause at shoulder height, lower over 2 — the lowering is the set.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Slight bend in the elbows',
      'Raise to shoulder height, no higher',
      'Lead with elbows, pour the jug',
    ],
  },
  {
    slug: 'db-front-raise',
    requires: [['dumbbell']],
    sourceId: 'Front_Dumbbell_Raise',
    displayName: 'Front Raise',
    role: 'main',
    pattern: 'push_v',
    tier: 1,
    unilateral: false,
    repRange: [10, 15],
    tempoCue: 'Up in 1, pause at eye level, lower over 2 — no swinging.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Raise to eye level, arms straight',
      'No swinging — strict and slow',
      'Alternate or together',
    ],
  },

  // ─── Main: horizontal pull (back, rear delts, biceps) ─────────────────────
  {
    slug: 'db-bent-over-row',
    requires: [['dumbbell']],
    sourceId: 'Bent_Over_Two-Dumbbell_Row',
    displayName: 'Bent-Over Row',
    role: 'main',
    pattern: 'pull_h',
    tier: 1,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: 'Pull in 1, squeeze the shoulder blades, lower over 2.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Hinge to ~45°, flat back',
      'Row to your hips, not your chest',
      'Squeeze shoulder blades together',
    ],
  },
  {
    slug: 'db-one-arm-row',
    requires: [['dumbbell']],
    sourceId: 'One-Arm_Dumbbell_Row',
    displayName: 'One-Arm Row',
    role: 'main',
    pattern: 'pull_h',
    setupNote:
      'Shown braced on a bench — a chair, a sofa arm, or your own thigh all support you just as well.',
    tier: 1,
    unilateral: true,
    repRange: [8, 15],
    tempoCue: 'Pull in 1, squeeze at the top, lower over 2 — no twisting the torso.',
    secondsPerRep: 3,
    setupSeconds: 15,
    cues: [
      'Stagger your stance, hinge forward, free hand on your front thigh',
      'Pull the elbow back past your ribs',
      'No torso twist — stay square',
    ],
  },
  {
    slug: 'db-reverse-fly',
    requires: [['dumbbell']],
    sourceId: 'Reverse_Flyes',
    displayName: 'Reverse Fly',
    role: 'main',
    pattern: 'pull_h',
    setupNote:
      'Shown face-down on an incline bench — hinge forward at the hips instead; same movement.',
    tier: 1,
    unilateral: false,
    repRange: [10, 18],
    tempoCue: 'Open in 1, hold for 1, lower over 1 — elbows stay soft.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Hinge forward, soft elbows',
      'Open arms wide like wings',
      'Squeeze between the shoulder blades',
    ],
  },
  {
    slug: 'db-bicep-curl',
    requires: [['dumbbell']],
    sourceId: 'Dumbbell_Bicep_Curl',
    displayName: 'Biceps Curl',
    role: 'main',
    pattern: 'pull_h',
    tier: 1,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: 'Curl in 1, squeeze at the top, lower over 2 — elbows pinned.',
    secondsPerRep: 3,
    setupSeconds: 5,
    cues: [
      'Elbows pinned to your sides',
      'Curl up, squeeze at the top',
      'Lower slow — no swinging',
    ],
  },
  {
    slug: 'db-hammer-curl',
    requires: [['dumbbell']],
    sourceId: 'Hammer_Curls',
    displayName: 'Hammer Curl',
    role: 'main',
    pattern: 'pull_h',
    tier: 1,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: 'Curl in 1, lower over 2 — no swinging from the shoulders.',
    secondsPerRep: 3,
    setupSeconds: 5,
    cues: ['Palms face each other', 'Curl without moving the elbows', 'Control the way down'],
  },
  {
    slug: 'db-concentration-curl',
    sourceId: 'Concentration_Curls',
    displayName: 'Concentration Curl',
    role: 'main',
    pattern: 'pull_h',
    // Bracing the elbow on the inner thigh only works seated.
    requires: [
      ['dumbbell', 'chair'],
      ['dumbbell', 'bench'],
      ['dumbbell', 'step'],
    ],
    setupNote: 'Shown on a gym bench — any chair, stair or low box works.',
    tier: 2,
    unilateral: true,
    repRange: [8, 12],
    tempoCue: 'Curl in 1, pause at the top, lower over 2 — the slow half is the point.',
    secondsPerRep: 3,
    setupSeconds: 15,
    cues: [
      'Seated, elbow braced on inner thigh',
      'Curl slow, squeeze hard at top',
      'Full stretch at the bottom',
    ],
  },

  // ─── Main: vertical pull-ish (lats, traps) ────────────────────────────────
  {
    slug: 'db-pullover',
    requires: [['dumbbell']],
    sourceId: 'Bent-Arm_Dumbbell_Pullover',
    displayName: 'Dumbbell Pullover',
    role: 'main',
    pattern: 'pull_v',
    setupNote:
      'Shown across a bench — on the floor the range is shorter and the shoulder is safer.',
    tier: 2,
    unilateral: false,
    repRange: [8, 12],
    tempoCue: 'Lower over 3 with the ribs down, pull back over in 1.',
    secondsPerRep: 4,
    setupSeconds: 15,
    cues: [
      'Lie on the floor, one dumbbell in both hands over your chest',
      'Arc it slowly back over your head, elbows softly bent',
      'Stop when your arms reach the floor, pull back over — ribs down',
    ],
  },
  {
    slug: 'db-upright-row',
    requires: [['dumbbell']],
    sourceId: 'Standing_Dumbbell_Upright_Row',
    displayName: 'Upright Row',
    role: 'main',
    pattern: 'pull_v',
    tier: 2,
    unilateral: false,
    repRange: [10, 15],
    tempoCue: 'Pull in 1, pause with the elbows high, lower over 2.',
    secondsPerRep: 3,
    setupSeconds: 5,
    cues: [
      'Pull dumbbells up your body line',
      'Elbows lead, stop at chest height',
      'Keep wrists relaxed',
    ],
  },
  {
    slug: 'db-shrug',
    requires: [['dumbbell']],
    sourceId: 'Dumbbell_Shrug',
    displayName: 'Dumbbell Shrug',
    role: 'main',
    pattern: 'pull_v',
    tier: 1,
    unilateral: false,
    repRange: [10, 18],
    tempoCue: 'Shrug up in 1, lower over 1 — no rolling.',
    secondsPerRep: 2,
    setupSeconds: 5,
    cues: [
      'Shoulders straight up to your ears',
      'Pause a beat at the top',
      'Long arms — no elbow bend',
    ],
  },

  // ─── Main: squat ──────────────────────────────────────────────────────────
  {
    slug: 'db-squat',
    requires: [['dumbbell']],
    sourceId: 'Dumbbell_Squat',
    displayName: 'Dumbbell Squat',
    role: 'main',
    pattern: 'squat',
    tier: 1,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: '2 seconds down, pause at the bottom, drive up in 1.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Dumbbells at your sides or shoulders',
      'Sit back and down, chest proud',
      'Drive through mid-foot to stand',
    ],
  },
  {
    slug: 'bodyweight-squat',
    requires: [['bodyweight']],
    sourceId: 'Bodyweight_Squat',
    displayName: 'Bodyweight Squat',
    role: 'main',
    pattern: 'squat',
    tier: 1,
    unilateral: false,
    repRange: [10, 20],
    tempoCue: '2 seconds down, pause at the bottom, stand up in 1.',
    secondsPerRep: 3,
    setupSeconds: 5,
    cues: [
      'Feet shoulder-width, toes slightly out',
      'Hips below parallel if comfortable',
      'Knees track over toes',
    ],
  },
  {
    slug: 'db-sumo-squat',
    requires: [['dumbbell']],
    sourceId: 'Plie_Dumbbell_Squat',
    displayName: 'Sumo Squat',
    role: 'main',
    pattern: 'squat',
    tier: 1,
    unilateral: false,
    repRange: [10, 15],
    tempoCue: '2 seconds down with the knees tracking out, drive up in 1.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Wide stance, toes out, one dumbbell',
      'Sink straight down between the knees',
      'Squeeze glutes on the way up',
    ],
  },
  {
    slug: 'jump-squat',
    requires: [['bodyweight']],
    sourceId: 'Freehand_Jump_Squat',
    displayName: 'Jump Squat',
    role: 'main',
    pattern: 'squat',
    tier: 2,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: 'Down over 2, explode up, land soft and absorb into the next one.',
    secondsPerRep: 3,
    setupSeconds: 5,
    cues: ['Squat down, explode up', 'Land soft, sink into the next rep', 'Arms drive the jump'],
  },
  {
    slug: 'db-calf-raise',
    requires: [['dumbbell']],
    sourceId: 'Standing_Dumbbell_Calf_Raise',
    displayName: 'Standing Calf Raise',
    role: 'main',
    pattern: 'squat',
    setupNote:
      'Shown standing on a board — flat floor is fine; a stair just adds range at the bottom.',
    tier: 1,
    unilateral: false,
    repRange: [12, 20],
    tempoCue: 'Up in 1, lower over 1 — full stretch at the bottom.',
    secondsPerRep: 2,
    setupSeconds: 5,
    cues: [
      'Rise high onto the balls of your feet',
      'Pause at the top',
      'Lower slowly under control',
    ],
  },

  // ─── Main: hinge ──────────────────────────────────────────────────────────
  {
    slug: 'db-romanian-deadlift',
    requires: [['dumbbell']],
    sourceId: 'Stiff-Legged_Dumbbell_Deadlift',
    displayName: 'Romanian Deadlift',
    role: 'main',
    pattern: 'hinge',
    tier: 1,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: '2 seconds down, feel the hamstrings stretch, drive the hips through in 1.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Push hips back, soft knees',
      'Dumbbells slide down your thighs',
      'Feel the hamstrings, then stand tall',
    ],
  },
  {
    slug: 'db-clean',
    requires: [['dumbbell']],
    sourceId: 'Dumbbell_Clean',
    displayName: 'Dumbbell Clean',
    role: 'main',
    pattern: 'hinge',
    tier: 3,
    unilateral: false,
    repRange: [6, 10],
    tempoCue: 'Explosive up, 2 seconds down — the power is on the way up only.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Hinge, then explode hips forward',
      'Pull dumbbells to your shoulders',
      'Catch soft with bent knees',
    ],
  },
  {
    slug: 'glute-bridge',
    requires: [['bodyweight']],
    sourceId: 'Butt_Lift_Bridge',
    displayName: 'Glute Bridge',
    role: 'main',
    pattern: 'hinge',
    tier: 1,
    unilateral: false,
    repRange: [10, 20],
    tempoCue: 'Drive up in 1, squeeze the top for 1, lower over 1.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Heels close to your hips',
      'Drive hips up, squeeze glutes hard',
      'One line from knees to shoulders',
    ],
  },
  {
    slug: 'single-leg-glute-bridge',
    requires: [['bodyweight']],
    sourceId: 'Single_Leg_Glute_Bridge',
    displayName: 'Single-Leg Glute Bridge',
    role: 'main',
    pattern: 'hinge',
    tier: 2,
    unilateral: true,
    repRange: [8, 15],
    tempoCue: 'Up in 1, hold for 1, lower over 1 — hips stay level.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'One foot down, other leg extended',
      'Hips level — don’t let them tilt',
      'Squeeze at the top each rep',
    ],
  },
  {
    slug: 'superman',
    requires: [['bodyweight']],
    sourceId: 'Superman',
    displayName: 'Superman Hold',
    role: 'main',
    pattern: 'hinge',
    tier: 1,
    unilateral: false,
    repRange: [8, 15],
    tempoCue: 'Lift and hold 2 seconds at the top, then lower — no jerking.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Lie face down, arms extended',
      'Lift arms and legs together',
      'Squeeze the whole back line, lower slow',
    ],
  },

  // ─── Main: lunge ──────────────────────────────────────────────────────────
  {
    slug: 'db-lunge',
    requires: [['dumbbell']],
    sourceId: 'Dumbbell_Lunges',
    displayName: 'Walking Lunge',
    role: 'main',
    pattern: 'lunge',
    tier: 1,
    unilateral: true,
    repRange: [8, 12],
    tempoCue: 'Step, lower over 2 until the back knee nearly touches, drive up in 1.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Long step, both knees to 90°',
      'Back knee kisses the floor',
      'Push through the front heel',
    ],
  },
  {
    slug: 'db-reverse-lunge',
    requires: [['dumbbell']],
    sourceId: 'Dumbbell_Rear_Lunge',
    displayName: 'Reverse Lunge',
    role: 'main',
    pattern: 'lunge',
    tier: 1,
    unilateral: true,
    repRange: [8, 12],
    tempoCue: 'Step back, lower over 2, drive up through the front heel in 1.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Step back, drop the back knee',
      'Front shin stays vertical',
      'Drive up through the front foot',
    ],
  },
  {
    slug: 'db-split-squat',
    requires: [['dumbbell']],
    sourceId: 'Split_Squat_with_Dumbbells',
    displayName: 'Split Squat',
    role: 'main',
    pattern: 'lunge',
    // The demo is a Bulgarian split squat (rear foot on a bench). Cued as the
    // in-place split squat, which is the same pattern and needs no bench.
    setupNote:
      'Shown with the rear foot up on a bench — both feet on the floor is the same movement, and easier to balance.',
    tier: 2,
    unilateral: true,
    repRange: [8, 12],
    tempoCue: '2 seconds down, pause an inch off the floor, up in 1.',
    secondsPerRep: 3,
    setupSeconds: 15,
    cues: [
      'Long staggered stance, both feet on the floor',
      'Straight down and up like an elevator — front shin vertical',
      'Finish all reps, then switch legs',
    ],
  },
  {
    slug: 'db-step-up',
    sourceId: 'Dumbbell_Step_Ups',
    displayName: 'Step-Up',
    role: 'main',
    pattern: 'lunge',
    // Needs something around knee height that takes your full weight. A dining
    // chair is usually too tall and too light to be safe, so it is not listed.
    requires: [
      ['dumbbell', 'step'],
      ['dumbbell', 'bench'],
    ],
    setupNote: 'Shown on a gym platform — a sturdy step, low bench or the stairs works.',
    tier: 2,
    unilateral: true,
    repRange: [8, 12],
    tempoCue: 'Up in 1 with no push off the back foot, lower over 3.',
    secondsPerRep: 4,
    setupSeconds: 15,
    cues: [
      'Use a sturdy step about knee height',
      'Drive through the top heel',
      'Lower under control — don’t drop',
    ],
  },
  {
    slug: 'split-jump',
    requires: [['bodyweight']],
    sourceId: 'Split_Jump',
    displayName: 'Jumping Lunge',
    role: 'main',
    pattern: 'lunge',
    tier: 3,
    unilateral: false,
    repRange: [8, 14],
    tempoCue: 'Land soft and absorb it, then jump again — quiet feet, no rushing.',
    secondsPerRep: 2,
    setupSeconds: 5,
    cues: [
      'Lunge, jump, switch legs mid-air',
      'Land soft into the next lunge',
      'Keep chest tall throughout',
    ],
  },

  // ─── Main: core ───────────────────────────────────────────────────────────
  {
    slug: 'plank',
    requires: [['bodyweight']],
    sourceId: 'Plank',
    displayName: 'Plank',
    role: 'main',
    pattern: 'core',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    tempoCue: 'Nothing moves — slow, steady breathing the whole hold.',
    secondsPerRep: 40, // timed hold: reps=1, tempo carries the duration
    setupSeconds: 10,
    cues: [
      'Forearms down, body in one line',
      'Squeeze glutes, brace the belly',
      'Breathe — don’t hold your breath',
    ],
  },
  {
    slug: 'side-plank',
    requires: [['bodyweight']],
    sourceId: 'Side_Bridge',
    displayName: 'Side Plank',
    role: 'main',
    pattern: 'core',
    tier: 2,
    unilateral: true,
    repRange: [1, 1],
    tempoCue: 'Nothing moves — hips stacked and lifted, breathing steadily.',
    secondsPerRep: 30,
    setupSeconds: 10,
    cues: [
      'Elbow under shoulder, feet stacked',
      'Lift hips into one straight line',
      'Hold, then switch sides',
    ],
  },
  {
    slug: 'dead-bug',
    requires: [['bodyweight']],
    sourceId: 'Dead_Bug',
    displayName: 'Dead Bug',
    role: 'main',
    pattern: 'core',
    tier: 1,
    unilateral: false,
    repRange: [8, 14],
    tempoCue: '2 seconds out, 2 seconds back — ribs stay down throughout.',
    secondsPerRep: 4,
    setupSeconds: 10,
    cues: [
      'Low back pressed into the floor',
      'Opposite arm and leg reach away',
      'Slow and controlled, exhale as you extend',
    ],
  },
  {
    slug: 'russian-twist',
    requires: [['bodyweight']],
    sourceId: 'Russian_Twist',
    displayName: 'Russian Twist',
    role: 'main',
    pattern: 'core',
    tier: 2,
    unilateral: false,
    repRange: [10, 20],
    tempoCue: 'Controlled rotation, touch each side — no swinging through the middle.',
    secondsPerRep: 2,
    setupSeconds: 10,
    cues: ['Lean back, chest proud', 'Rotate shoulder to shoulder', 'Add a dumbbell to progress'],
  },
  {
    slug: 'reverse-crunch',
    requires: [['bodyweight']],
    sourceId: 'Reverse_Crunch',
    displayName: 'Reverse Crunch',
    role: 'main',
    pattern: 'core',
    tier: 1,
    unilateral: false,
    repRange: [10, 18],
    tempoCue: 'Curl up in 1, lower over 2 — no swinging the legs.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: ['Knees to chest, lift the hips', 'Roll the spine up, not a swing', 'Lower legs slowly'],
  },
  {
    slug: 'bent-knee-hip-raise',
    requires: [['bodyweight']],
    sourceId: 'Bent-Knee_Hip_Raise',
    displayName: 'Lying Knee Raise',
    role: 'main',
    pattern: 'core',
    tier: 1,
    unilateral: false,
    repRange: [10, 18],
    tempoCue: 'Lift in 1, lower over 2 — the lowering half is the work.',
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Hands by your sides, knees bent',
      'Draw knees toward your chest',
      'Keep the low back quiet',
    ],
  },
  {
    slug: 'db-side-bend',
    requires: [['dumbbell']],
    sourceId: 'Dumbbell_Side_Bend',
    displayName: 'Dumbbell Side Bend',
    role: 'main',
    pattern: 'core',
    tier: 1,
    unilateral: true,
    repRange: [10, 15],
    tempoCue: 'Lower over 2, up in 1 — no leaning forward.',
    secondsPerRep: 3,
    setupSeconds: 5,
    cues: [
      'One dumbbell, slide down your side',
      'Pull back up with the opposite obliques',
      'No leaning forward or back',
    ],
  },
  {
    slug: 'mountain-climber',
    requires: [['bodyweight']],
    sourceId: 'Spider_Crawl',
    displayName: 'Spider Climbers',
    role: 'main',
    pattern: 'core',
    tier: 2,
    unilateral: false,
    repRange: [10, 20],
    tempoCue: 'Quick feet, still hips — fast, but never bouncing.',
    secondsPerRep: 2,
    setupSeconds: 10,
    cues: ['From plank, knee to outside elbow', 'Hips low and level', 'Alternate with rhythm'],
  },

  // ─── Cool-down (timed static stretches) ───────────────────────────────────
  C('childs-pose', 'Childs_Pose', "Child's Pose", [
    'Knees wide, sit back on your heels',
    'Arms long, forehead to the floor',
    'Slow deep breaths',
  ]),
  C('seated-hamstring-stretch', 'Seated_Floor_Hamstring_Stretch', 'Seated Hamstring Stretch', [
    'Legs long, hinge from the hips',
    'Reach toward your toes',
    'Relax the neck, keep breathing',
  ]),
  C('kneeling-hip-flexor-stretch', 'Kneeling_Hip_Flexor', 'Kneeling Hip Flexor Stretch', [
    'Half-kneel, tuck the tailbone',
    'Shift hips gently forward',
    'Reach the same-side arm overhead',
  ]),
  C('side-quad-stretch', 'On_Your_Side_Quad_Stretch', 'Side-Lying Quad Stretch', [
    'Lie on your side, grab the top ankle',
    'Pull the heel toward your glutes',
    'Keep knees together, hips forward',
  ]),
  C('spinal-twist', 'Knee_Across_The_Body', 'Lying Spinal Twist', [
    'On your back, drop one knee across',
    'Both shoulders stay on the floor',
    'Look the opposite way, breathe',
  ]),
  C('figure-four-stretch', 'Ankle_On_The_Knee', 'Figure-4 Glute Stretch', [
    'Ankle over the opposite knee',
    'Pull the lower thigh toward you',
    'Feel it deep in the glute',
  ]),
  C(
    'chest-stretch',
    'Chest_And_Front_Of_Shoulder_Stretch',
    'Chest & Shoulder Stretch',
    [
      'Clasp hands behind your back',
      'Lift the knuckles, open the chest',
      'Shoulders down away from ears',
    ],
    'Shown with a body bar — clasping your hands behind your back does the same job.',
  ),
  C('overhead-triceps-stretch', 'Triceps_Stretch', 'Overhead Triceps Stretch', [
    'Elbow up, hand down your back',
    'Gently pull the elbow across',
    'Switch arms halfway',
  ]),
  C('cross-shoulder-stretch', 'Shoulder_Stretch', 'Cross-Body Shoulder Stretch', [
    'Arm across the chest',
    'Hug it in with the other arm',
    'Keep the shoulder relaxed',
  ]),
  C('neck-stretch', 'Side_Neck_Stretch', 'Side Neck Stretch', [
    'Ear toward shoulder, gently',
    'Opposite arm reaches down',
    'Switch sides halfway',
  ]),
  C(
    'standing-calf-stretch',
    'Standing_Gastrocnemius_Calf_Stretch',
    'Calf Stretch',
    ['Back leg straight, heel down', 'Lean into a wall or chair', 'Switch legs halfway'],
    'Shown with the foot up on a step — leaning into a wall gives the same stretch.',
  ),
  C('knees-to-chest', 'Hug_Knees_To_Chest', 'Knees-to-Chest Hug', [
    'On your back, hug both knees in',
    'Rock gently side to side',
    'Let the low back release',
  ]),
]

// ─── Mobility & Relief ──────────────────────────────────────────────────────
// Routines run mobilise → open → activate. Stretching alone does not fix a
// slouched posture: the stiff segment must move, the tight front must open,
// and the weak mid-back must switch on.

type MobilityMeta = {
  phase: 'mobilise' | 'open' | 'activate'
  /**
   * Mirrors MOBILITY_REGIONS in src/core/catalog/types.ts, which is
   * authoritative. The lower-body four were missing here long after the
   * vocabulary itself carried them, so the only way to tag a stretch `glutes`
   * was to edit catalog.json by hand — which is exactly how the pipeline and
   * the catalog drifted apart (see the header note on MOBILITY_ADDITIONS).
   */
  regions: (
    | 'thoracic'
    | 'shoulders'
    | 'neck'
    | 'chest'
    | 'lower_back'
    | 'hips'
    | 'glutes'
    | 'hamstrings'
    | 'quads'
    | 'calves'
  )[]
  seconds: number
  focusCue?: string
  /** 2 = highest-value movement for its regions; picked ahead of the rest.
   *  Editorial judgement lives in content, not in the generator. */
  priority?: 1 | 2
}

/** Mobility metadata layered onto exercises already in the catalog. */
export const MOBILITY_META: Record<string, MobilityMeta> = {
  'cat-cow': {
    phase: 'mobilise',
    regions: ['thoracic', 'lower_back'],
    seconds: 45,
    focusCue: 'Move one vertebra at a time — this is the segment that stiffens when you slouch',
  },
  'dynamic-back-stretch': { phase: 'mobilise', regions: ['thoracic'], seconds: 40 },
  'spinal-twist': { phase: 'mobilise', regions: ['thoracic', 'lower_back'], seconds: 50 },
  'shoulder-circles': { phase: 'mobilise', regions: ['shoulders'], seconds: 35 },
  'arm-circles': { phase: 'mobilise', regions: ['shoulders'], seconds: 35 },
  'hip-circles': { phase: 'mobilise', regions: ['hips'], seconds: 35 },
  'neck-stretch': { phase: 'open', regions: ['neck'], seconds: 40 },
  'chest-stretch': {
    phase: 'open',
    regions: ['chest', 'shoulders'],
    seconds: 45,
    priority: 2,
    focusCue: 'Tight chest pulls the shoulders forward — breathe out and let them widen',
  },
  'dynamic-chest-stretch': { phase: 'open', regions: ['chest', 'shoulders'], seconds: 40 },
  'cross-shoulder-stretch': { phase: 'open', regions: ['shoulders'], seconds: 40 },
  'childs-pose': { phase: 'open', regions: ['lower_back', 'thoracic'], seconds: 50 },
  'knees-to-chest': { phase: 'open', regions: ['lower_back'], seconds: 40 },
  // The lower-body five, restored to the pipeline. PR #31 tagged these in
  // catalog.json by hand because `MobilityMeta.regions` had no leg vocabulary
  // to say it in; regenerating from here would have silently untagged them and
  // taken the cool-down's leg targeting (docs/SESSIONS.md finding 6) with it.
  'kneeling-hip-flexor-stretch': { phase: 'open', regions: ['hips', 'quads'], seconds: 45 },
  'figure-four-stretch': { phase: 'open', regions: ['glutes', 'hips'], seconds: 45 },
  // `priority: 2` states outright what the ten-minute session was getting by
  // luck: it is the catalog's only hamstring hold, and `tests/mobility.test.ts`
  // requires the sitting-stiffness session to open the back of the thigh at any
  // length. Selection is a shuffle within a priority tier, and pool sizes
  // upstream move the PRNG stream, so any content change anywhere could drop it
  // — as adding the mobilise work promptly did.
  'seated-hamstring-stretch': {
    phase: 'open',
    regions: ['hamstrings', 'calves'],
    seconds: 45,
    priority: 2,
  },
  'side-quad-stretch': { phase: 'open', regions: ['quads'], seconds: 45 },
  'standing-calf-stretch': { phase: 'open', regions: ['calves'], seconds: 40 },
  'worlds-greatest-stretch': { phase: 'open', regions: ['hips', 'thoracic'], seconds: 45 },
  superman: {
    phase: 'activate',
    regions: ['thoracic', 'lower_back'],
    seconds: 35,
    focusCue: 'Lift from between the shoulder blades, not the neck',
  },
  'db-reverse-fly': {
    phase: 'activate',
    regions: ['thoracic', 'shoulders'],
    seconds: 40,
    focusCue: 'Light or no weight here — squeeze the shoulder blades together, hold a beat',
  },
  'dead-bug': { phase: 'activate', regions: ['lower_back'], seconds: 40 },
  'glute-bridge': {
    phase: 'activate',
    regions: ['lower_back', 'hips'],
    seconds: 40,
    priority: 2,
    focusCue: 'Squeeze the glutes at the top — they should do the work, not the low back',
  },
  'single-leg-glute-bridge': { phase: 'activate', regions: ['hips', 'lower_back'], seconds: 40 },
  'bent-knee-hip-raise': { phase: 'activate', regions: ['lower_back'], seconds: 35 },
  'overhead-triceps-stretch': { phase: 'open', regions: ['shoulders'], seconds: 40 },
}

/** Mobility-only movements — the posture work the strength catalog was missing. */
export const MOBILITY_ADDITIONS: (Curated & { mobility: MobilityMeta })[] = [
  {
    slug: 'elbows-back',
    requires: [['bodyweight']],
    sourceId: 'Elbows_Back',
    displayName: 'Elbows Back Chest Opener',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 40,
    setupSeconds: 5,
    cues: [
      'Elbows squeeze back and together',
      'Chest lifts, ribs stay down',
      'Breathe into the front of the chest',
    ],
    mobility: { phase: 'open', regions: ['chest', 'shoulders'], seconds: 40 },
  },
  {
    slug: 'lat-wall-stretch',
    sourceId: 'One_Arm_Against_Wall',
    displayName: 'Lat Stretch at the Wall',
    role: 'mobility',
    pattern: 'mobility',
    requires: [['wall']],
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 40,
    setupSeconds: 5,
    cues: [
      'Hand high on the wall, sink the chest',
      'Feel it down the side of the back',
      'Switch sides halfway',
    ],
    mobility: { phase: 'open', regions: ['shoulders', 'thoracic'], seconds: 45, priority: 2 },
  },
  {
    slug: 'upper-back-stretch',
    requires: [['bodyweight']],
    sourceId: 'Upper_Back_Stretch',
    displayName: 'Upper Back Stretch',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 40,
    setupSeconds: 5,
    cues: [
      'Clasp hands and push them away',
      'Round the upper back, open between the blades',
      'Chin gently tucked',
    ],
    mobility: { phase: 'open', regions: ['thoracic'], seconds: 40 },
  },
  {
    slug: 'middle-back-mobiliser',
    requires: [['bodyweight']],
    sourceId: 'Middle_Back_Stretch',
    displayName: 'Mid-Back Mobiliser',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 40,
    setupSeconds: 5,
    cues: [
      'Slow side-to-side through the mid-back',
      'Hips stay square',
      'Only as far as comfortable',
    ],
    mobility: { phase: 'mobilise', regions: ['thoracic'], seconds: 40 },
  },
  {
    slug: 'chin-tuck',
    requires: [['bodyweight']],
    sourceId: 'Chin_To_Chest_Stretch',
    displayName: 'Chin Tuck',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 35,
    setupSeconds: 5,
    cues: [
      'Draw the chin straight back, make a double chin',
      'Hold 3 seconds, release',
      'Directly counters a forward head',
    ],
    mobility: {
      phase: 'activate',
      regions: ['neck'],
      seconds: 35,
      focusCue: 'Head slides back over the shoulders — no tilting up or down',
    },
  },
  {
    slug: 'scap-retraction',
    requires: [['bodyweight']],
    sourceId: 'Middle_Back_Shrug',
    displayName: 'Scapular Retraction',
    role: 'mobility',
    pattern: 'mobility',
    setupNote: 'Shown face-down on a bench with dumbbells — do it standing, with no weight at all.',
    tier: 1,
    unilateral: false,
    repRange: [10, 15],
    secondsPerRep: 2,
    setupSeconds: 5,
    cues: [
      'Pull the shoulder blades back and down',
      'Arms stay relaxed — the blades do the work',
      'Hold 2 seconds each rep',
    ],
    mobility: {
      phase: 'activate',
      regions: ['thoracic', 'shoulders'],
      seconds: 40,
      priority: 2,
      focusCue: 'This is the muscle that holds you upright — squeeze and hold, no shrugging',
    },
  },
  {
    slug: 'shoulder-external-rotation',
    requires: [['bodyweight']],
    sourceId: 'External_Rotation',
    displayName: 'Side-Lying Shoulder External Rotation',
    role: 'mobility',
    pattern: 'mobility',
    setupNote:
      'Shown on a bench with a dumbbell — lie on the floor instead, and the weight is optional.',
    tier: 1,
    unilateral: true,
    repRange: [10, 15],
    secondsPerRep: 3,
    setupSeconds: 5,
    cues: [
      'Lie on your side, top arm along your ribs, elbow bent 90°',
      'Rotate the forearm up toward the ceiling — the elbow stays glued to your side',
      'Small range and slow. No weight, or the lightest one you own. Switch sides halfway',
    ],
    mobility: {
      phase: 'activate',
      regions: ['shoulders'],
      seconds: 45,
      focusCue: 'Small range, slow — this wakes up the cuff that supports the joint',
    },
  },
  {
    slug: 'prone-rear-delt-raise',
    requires: [['bodyweight']],
    sourceId: 'Lying_Rear_Delt_Raise',
    displayName: 'Prone Rear Delt Raise',
    role: 'mobility',
    pattern: 'mobility',
    setupNote: 'Shown on a bench with dumbbells — face down on the floor is the same movement.',
    tier: 1,
    unilateral: false,
    repRange: [10, 15],
    secondsPerRep: 2,
    setupSeconds: 10,
    cues: [
      'Lie face down on the floor, arms out in a T',
      'Lift with the shoulder blades, thumbs up',
      'Little or no weight needed',
    ],
    mobility: {
      phase: 'activate',
      regions: ['thoracic', 'shoulders'],
      seconds: 40,
      focusCue: 'Mid-back does the lifting — keep the neck long and relaxed',
    },
  },
  {
    slug: 'elbow-circles',
    requires: [['bodyweight']],
    sourceId: 'Elbow_Circles',
    displayName: 'Elbow Circles',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 5,
    cues: [
      'Fingertips on your shoulders, elbows up to shoulder height',
      'Draw the biggest circle you can with the elbows',
      'Half the time forwards, half backwards',
    ],
    mobility: {
      phase: 'mobilise',
      regions: ['shoulders', 'thoracic'],
      seconds: 45,
      focusCue:
        'Let the shoulder blades travel with the elbows — that is the joint you are freeing',
    },
  },
  {
    slug: 'seated-thoracic-rotation',
    sourceId: 'Spinal_Stretch',
    displayName: 'Seated Thoracic Rotation',
    role: 'mobility',
    pattern: 'mobility',
    // Sitting is what locks the hips so the rotation comes from the mid-back.
    requires: [['chair'], ['bench'], ['step']],
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 60,
    setupSeconds: 5,
    cues: [
      'Sit tall on a chair, fingers laced behind your head',
      'Turn the ribcage one way — hips and knees stay facing forward',
      'Then fold that elbow down toward the inside of the opposite knee, and come back up',
      'Three turns each way — switch sides halfway',
    ],
    mobility: {
      phase: 'mobilise',
      regions: ['thoracic', 'neck'],
      seconds: 60,
      priority: 2,
      focusCue: 'Rotation comes from the mid-back — keep the belt line still and the chin down',
    },
  },
  {
    slug: 'overhead-reach',
    requires: [['bodyweight']],
    sourceId: 'Overhead_Stretch',
    displayName: 'Overhead Reach',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 5,
    cues: [
      'Lace your fingers and turn the palms to the ceiling',
      'Press up tall, shoulders down away from your ears',
      'Tuck the tailbone so the stretch stays in the torso, not the low back',
    ],
    mobility: { phase: 'open', regions: ['chest', 'shoulders', 'thoracic'], seconds: 45 },
  },
  {
    slug: 'side-lying-side-stretch',
    requires: [['bodyweight']],
    sourceId: 'Side-Lying_Floor_Stretch',
    displayName: 'Side-Lying Side Stretch',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 70,
    setupSeconds: 10,
    cues: [
      'Lie on your side, bottom knee bent in front of you for balance',
      'Reach the top arm long over your head and gently pull on the wrist',
      'The whole side of the body opens — switch sides halfway',
    ],
    mobility: { phase: 'open', regions: ['thoracic', 'shoulders', 'lower_back'], seconds: 70 },
  },
  {
    slug: 'standing-side-bend',
    requires: [['bodyweight']],
    sourceId: 'Standing_Lateral_Stretch',
    displayName: 'Standing Side Bend',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 60,
    setupSeconds: 5,
    cues: [
      'Feet a little wider than your hips, one hand on that hip',
      'Other hand behind your head, elbow up — lean away from the supporting hand',
      'Stay square — no twisting or leaning forward. Switch sides halfway',
    ],
    mobility: { phase: 'open', regions: ['thoracic', 'lower_back'], seconds: 60 },
  },
  {
    slug: 'prone-chest-lift',
    requires: [['bodyweight']],
    sourceId: 'Lower_Back_Curl',
    displayName: 'Prone Chest Lift',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 10,
    cues: [
      'Face down, arms straight alongside your body, palms resting on the floor',
      'Lift the chest off the floor and hold two seconds',
      'Do not press through the hands — the mid-back lifts you. Lower slowly',
    ],
    mobility: {
      phase: 'activate',
      regions: ['thoracic', 'lower_back'],
      seconds: 45,
      focusCue: 'No pushing with the hands — the muscles between the shoulder blades do all of it',
    },
  },
  {
    slug: 'isometric-neck-front-back',
    requires: [['bodyweight']],
    sourceId: 'Isometric_Neck_Exercise_-_Front_And_Back',
    displayName: 'Neck Isometric — Front & Back',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 5,
    cues: [
      'Palms on your forehead, press your head into them',
      'Nothing actually moves — build the pressure slowly, hold ten seconds',
      'Release, then repeat with your hands behind your head',
    ],
    mobility: {
      phase: 'activate',
      regions: ['neck'],
      seconds: 45,
      focusCue: 'Strength here is what stops your head drifting forward by the afternoon',
    },
  },
  {
    slug: 'isometric-neck-sides',
    requires: [['bodyweight']],
    sourceId: 'Isometric_Neck_Exercise_-_Sides',
    displayName: 'Neck Isometric — Sides',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 5,
    cues: [
      'Palm flat against the side of your head',
      'Press head into hand and resist — the head does not move',
      'Ten seconds each side, keep breathing normally',
    ],
    mobility: { phase: 'activate', regions: ['neck'], seconds: 45 },
  },
  {
    slug: 'shoulder-opener',
    requires: [['bodyweight']],
    sourceId: 'Round_The_World_Shoulder_Stretch',
    displayName: 'Shoulder Opener',
    role: 'mobility',
    pattern: 'mobility',
    // A rolled towel is enough, so this needs nothing anyone lacks.
    setupNote: 'Shown with a body bar — a broomstick, a rolled towel or a band all work.',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 60,
    setupSeconds: 10,
    cues: [
      'Hold a broomstick, a towel or a band behind your hips, hands wider than your shoulders',
      'Keeping the arms straight, lift it up and away behind you',
      'Only as far as is comfortable — lower slowly, chest stays lifted',
    ],
    mobility: {
      phase: 'open',
      regions: ['chest', 'shoulders'],
      seconds: 60,
      focusCue: 'Widen your grip if the shoulders shrug — range should come from the joint',
    },
  },

  // ── Lower-body mobilise and activate work ──────────────────────────────────
  //
  // The catalog's lower body was entirely `open` holds: one movement each for
  // hamstrings and glutes, two for quads and calves, and nothing at all that
  // *moved* a hip or *switched on* a glute. Sitting stiffness is the whole
  // premise of the Lower Back & Hips session, and its mobilise phase was four
  // movements deep against a seven-slot budget at twenty minutes — so it ran
  // cat-cow, hip circles, the roller and a twist, then ran them again.
  //
  // These six are picked for the regions the focuses actually select
  // (`lower_back`, `hips`, `glutes`, `hamstrings`), not for even coverage of
  // the region vocabulary: `quads` and `calves` appear in no focus's `regions`
  // at all, only in `full_body.extendedRegions`, where a whole phase yields at
  // most one breadth slot. A calf raise would have been near-unreachable — and
  // is not sourceable anyway, since every calf raise in the dataset is machine,
  // barbell or dumbbell, and this session is unloaded by definition.
  //
  // Each is tagged with what it *addresses*, never with everything it touches,
  // and that distinction is load-bearing rather than editorial fussiness.
  // `hips` is a Full Body core region while `glutes` and `hamstrings` are only
  // breadth, so a hip mobiliser also tagged `glutes` enters Full Body through
  // the front door and skips the budget gate entirely. Tagged that way the
  // first time, these six put legs into a five-minute Full Body session and
  // took it to 38% lower-body at ten — both caught by `tests/mobility.test.ts`.
  {
    slug: 'quadruped-hip-circles',
    sourceId: 'Hip_Circles_prone',
    displayName: 'Quadruped Hip Circles',
    requires: [['bodyweight']],
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 10,
    cues: [
      'On hands and knees, lift one knee out to the side',
      'Draw a big slow circle with the knee, hips level',
      'Switch sides halfway',
    ],
    mobility: {
      phase: 'mobilise',
      regions: ['hips'],
      seconds: 45,
      // Deliberately no `priority: 2`, and the reason generalises: `hips` is a
      // Full Body *core* region, so priority here is not a nudge inside the
      // sitting-stiffness pool — it orders this ahead of thoracic work in every
      // focus that includes `hips`. Tagged `priority: 2` on the first pass it
      // opened Full Body at five minutes on 18 days in 60, and appeared in all
      // 60 at ten (Grok, PR #37). `EXTENDED_SHARE` cannot catch that: it gates
      // `extendedRegions` only, so core-region content never goes through it.
      // The twenty-minute no-repeat fill does not need the priority — that
      // session consumes the whole mobilise pool either way.
      focusCue: 'The hip that sitting locks up — take it through the range it never gets',
    },
  },
  {
    slug: 'lying-hamstring-extension',
    sourceId: '90_90_Hamstring',
    displayName: 'Lying 90/90 Hamstring Extension',
    requires: [['bodyweight']],
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 10,
    cues: [
      'On your back, bring one hip and knee to ninety degrees',
      'Hold behind the thigh and straighten the leg towards the ceiling',
      'Lower under control and repeat — switch sides halfway',
    ],
    mobility: {
      phase: 'mobilise',
      regions: ['hamstrings'],
      seconds: 45,
      // Moving the hamstring through range before the holds, rather than
      // hanging off it cold — this is the mobilise counterpart to the seated
      // stretch that was the catalog's only hamstring entry.
      focusCue:
        'Straighten only as far as the knee stays comfortable — this is movement, not a hold',
    },
  },
  {
    slug: 'prone-leg-crossover',
    sourceId: 'Iron_Crosses_stretch',
    displayName: 'Prone Leg Crossover',
    requires: [['bodyweight']],
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 10,
    cues: [
      'Face down, arms out wide, palms on the floor',
      'Bend one knee and take it across behind you towards the opposite hand',
      'Return slowly and alternate sides — shoulders stay down',
    ],
    mobility: {
      phase: 'mobilise',
      regions: ['hips', 'lower_back'],
      seconds: 45,
      focusCue: 'Let the low back rotate — the twist is the point, so keep it slow',
    },
  },
  {
    slug: 'lateral-leg-swing',
    sourceId: 'Side_Leg_Raises',
    displayName: 'Lateral Leg Swing',
    // Genuinely held onto for balance in the frames, so it is declared, not
    // waved away: on one leg with the other swinging, the support is the
    // movement's precondition rather than scenery.
    requires: [['chair'], ['bench'], ['wall']],
    setupNote:
      'Shown holding a chair — a worktop, a bench or a hand on the wall is the same thing.',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 40,
    setupSeconds: 10,
    cues: [
      'Hold your support and stand on one leg',
      'Swing the other leg out to the side and back across in front',
      'Let the range grow as it loosens — switch sides halfway',
    ],
    mobility: {
      phase: 'mobilise',
      regions: ['hips'],
      seconds: 40,
      focusCue: 'Stay tall — the swing comes from the hip, not by leaning away from it',
    },
  },
  {
    slug: 'glute-kickback',
    sourceId: 'Glute_Kickback',
    displayName: 'Quadruped Glute Kickback',
    requires: [['bodyweight']],
    // The demo lifts past level with the back, which is the exact fault the cue
    // and focus cue warn against — and people do the photo, not the paragraph.
    // Said out loud rather than left for the picture to win (Grok, PR #37).
    setupNote: 'Shown lifting higher than you need — stop when the thigh is level with your back.',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 40,
    setupSeconds: 10,
    cues: [
      'On hands and knees, keep the knee bent at a right angle',
      'Press the sole of the foot up until the thigh is level with your back',
      'Squeeze at the top, lower slowly — switch sides halfway',
    ],
    mobility: {
      phase: 'activate',
      regions: ['glutes'],
      seconds: 40,
      priority: 2,
      focusCue: 'Ribs down and squeeze the glute — if the low back arches, go lower',
    },
  },
  {
    slug: 'standing-hip-extension',
    sourceId: 'Leg_Lift',
    displayName: 'Standing Hip Extension',
    requires: [['chair'], ['bench'], ['wall']],
    setupNote: 'Shown holding a gym bench — a chair back, a worktop or the wall all work.',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 40,
    setupSeconds: 10,
    cues: [
      'Hold your support, stand tall on one leg',
      'Draw the other leg straight back behind you, keeping it straight',
      'Squeeze the glute, return slowly — switch sides halfway',
    ],
    mobility: {
      phase: 'activate',
      regions: ['glutes', 'hamstrings'],
      seconds: 40,
      focusCue: 'Small range done properly — the movement is the hip opening, not the back arching',
    },
  },
]

/** Band + foam-roller mobility work — high value for scapular/thoracic issues. */
export const EQUIPMENT_MOBILITY: (Curated & { mobility: MobilityMeta })[] = [
  {
    slug: 'band-pull-apart',
    sourceId: 'Band_Pull_Apart',
    displayName: 'Band Pull-Apart',
    requires: [['band']],
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [10, 15],
    secondsPerRep: 2,
    setupSeconds: 10,
    cues: [
      'Band at chest height, arms straight',
      'Pull apart until it touches your chest',
      'Squeeze the shoulder blades, return slowly',
    ],
    mobility: {
      phase: 'activate',
      regions: ['thoracic', 'shoulders'],
      seconds: 45,
      priority: 2,
      focusCue:
        'The best single move for the muscles that hold your shoulders back — slow and controlled',
    },
  },
  {
    slug: 'band-rear-fly',
    sourceId: 'Back_Flyes_-_With_Bands',
    displayName: 'Band Rear Fly',
    requires: [['band']],
    setupNote:
      'Shown anchored to a squat rack — a closed door, a door handle or a bannister all work.',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [10, 15],
    secondsPerRep: 2,
    setupSeconds: 10,
    cues: [
      'Anchor the band in front at chest height',
      'Open the arms wide and back',
      'Lead with the elbows, not the hands',
    ],
    mobility: { phase: 'activate', regions: ['thoracic', 'shoulders'], seconds: 40 },
  },
  {
    slug: 'band-external-rotation',
    sourceId: 'External_Rotation_with_Band',
    displayName: 'Band External Rotation',
    requires: [['band']],
    setupNote: 'Shown anchored to a gym frame — a door handle at elbow height does the same.',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [10, 15],
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Elbow tucked at your side, bent 90°',
      'Rotate the forearm outward against the band',
      'Light tension, slow return — switch sides halfway',
    ],
    mobility: {
      phase: 'activate',
      regions: ['shoulders'],
      seconds: 45,
      priority: 2,
      focusCue: 'Strengthens the rotator cuff that supports the joint — small range, no shrugging',
    },
  },
  {
    slug: 'roller-thoracic-extension',
    sourceId: 'Rhomboids-SMR',
    displayName: 'Thoracic Extension on Roller',
    requires: [['roller']],
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 60,
    setupSeconds: 15,
    cues: [
      'Roller across the upper back, hands supporting the head',
      'Gently arch back over it, breathe out',
      'Move the roller a little and repeat — stay above the low back',
    ],
    mobility: {
      phase: 'mobilise',
      regions: ['thoracic'],
      seconds: 60,
      priority: 2,
      focusCue:
        'The most direct work for a rounded upper back — extend over the roller, do not force it',
    },
  },
  {
    slug: 'roller-lat-release',
    sourceId: 'Latissimus_Dorsi-SMR',
    displayName: 'Lat Release on Roller',
    requires: [['roller']],
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 10,
    cues: [
      'Lie on your side, roller under the armpit',
      'Roll slowly down the side of the back',
      'Pause and breathe on tender spots — switch sides',
    ],
    mobility: { phase: 'mobilise', regions: ['thoracic', 'shoulders'], seconds: 45 },
  },
  {
    slug: 'roller-lower-back-release',
    sourceId: 'Lower_Back-SMR',
    displayName: 'Lower Back Release',
    requires: [['roller']],
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: false,
    repRange: [1, 1],
    secondsPerRep: 45,
    setupSeconds: 10,
    cues: [
      'Roller under the low back, knees bent',
      'Small, slow movements',
      'Ease off if anything sharpens',
    ],
    mobility: { phase: 'mobilise', regions: ['lower_back'], seconds: 45 },
  },
  {
    slug: 'band-internal-rotation',
    sourceId: 'Internal_Rotation_with_Band',
    displayName: 'Band Internal Rotation',
    requires: [['band']],
    setupNote: 'Shown anchored to a gym frame — a door handle at elbow height does the same.',
    role: 'mobility',
    pattern: 'mobility',
    tier: 1,
    unilateral: true,
    repRange: [10, 15],
    secondsPerRep: 3,
    setupSeconds: 10,
    cues: [
      'Anchor the band at elbow height and stand side-on to it',
      'Elbow pinned to your side and bent 90°',
      'Rotate the forearm in across your belly, return slowly — switch sides halfway',
    ],
    mobility: {
      phase: 'activate',
      regions: ['shoulders'],
      seconds: 45,
      focusCue:
        'The partner to external rotation — a cuff trained one way only still lets the joint drift',
    },
  },
]

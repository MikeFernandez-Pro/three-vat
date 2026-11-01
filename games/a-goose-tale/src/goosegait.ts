// The goose's gait: how much of his idle, his walk and his run his pose shows, by how fast he goes, and how fast
// each clip plays so his feet keep pace with the ground.
import { LIGHT_SPEED } from './gameplay'

/** The panel's gait settings: the pace he runs past, m/s, and how wide the blend of his walk into his run across it is, m/s. */
export interface GaitSettings {
  threshold: number
  blend: number
}

/** The weights of his idle, walk and run, summing to 1; and how fast his walk and his run play, 1 as authored. */
export interface Gait {
  idle: number
  walk: number
  run: number
  walkSpeed: number
  runSpeed: number
}

/** The pace his walk plays at as authored, m/s; and his run's, the keys' full pace, so on the keys he runs as he did. */
const WALK_STRIDE = 0.6
const RUN_STRIDE = LIGHT_SPEED
/** The pace at which he is all moving, m/s, his idle given way to his walk by then: the opening's calm one. */
const MOVING = 0.25

/** His gait at `speed` m/s. */
export function gaitAt(speed: number, settings: GaitSettings): Gait {
  // Across the blend, centred on the threshold, eased at both ends so it has no corner.
  const across = settings.blend > 0 ? (speed - settings.threshold) / settings.blend + 0.5 : speed > settings.threshold ? 1 : 0
  const share = Math.min(1, Math.max(0, across))
  const run = share * share * (3 - 2 * share)
  const moving = Math.min(1, speed / MOVING)
  return { idle: 1 - moving, walk: moving * (1 - run), run: moving * run, walkSpeed: speed / WALK_STRIDE, runSpeed: speed / RUN_STRIDE }
}

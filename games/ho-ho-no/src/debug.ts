// The debug panel, on `#debug` as the original's was: three's inspector on the
// renderer — its frame timings, console and viewer — and in its parameters
// tab the original's folders (the seam puts in the renderer's, the vignette's,
// the floor's and the snow's; the lighting's is here) with the run's own
// beside them: what it stands at, cheats to test it with, and the physics
// colliders drawn over the camp, which the original had written and left off.
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, type Scene } from 'three'
import type { Inspector } from 'three/examples/jsm/inspector/Inspector.js'
import { formatTime } from './hud'
import type { BoostKind, Simulation } from './simulation/simulation'
import type { Stage } from './stage'

/** Whether the page was opened on `#debug`. Read once, at load: the renderer is built with the inspector or without. */
export const DEBUG = window.location.hash === '#debug'

export interface DebugPanel {
  /** Once a frame: the run's readouts, and the colliders where they are. */
  update(): void
}

export function inspectGame(inspector: Inspector, stage: Stage, simulation: Simulation, scene: Scene): DebugPanel {
  const lighting = inspector.createParameters('Lighting')
  lighting.addColor(stage.sun, 'color').name('sun color')
  lighting.add(stage.sun, 'intensity', 0, 10, 0.001).name('sun intensity')
  lighting.addColor(stage.ambient, 'color').name('ambient color')
  lighting.add(stage.ambient, 'intensity', 0, 10, 0.001).name('ambient intensity')

  // Copies, not the simulation's own fields: an editor writes back what is typed in it.
  const readout = { time: formatTime(0), kills: 0, skeletons: 0, boost: 'none' }
  const run = inspector.createParameters('Run')
  run.add(readout, 'time').listen()
  run.add(readout, 'kills').listen()
  run.add(readout, 'skeletons').listen()
  run.add(readout, 'boost').listen()

  const grant = (kind: BoostKind) => () => simulation.grantBoost(kind)
  const cheats = {
    invincible: simulation.invincible,
    colliders: false,
    speed: grant('speed'),
    shoot: grant('shoot'),
    ghost: grant('ghost'),
  }
  const cheat = inspector.createParameters('Cheats')
  cheat.add(cheats, 'invincible').onChange((value: boolean) => {
    simulation.invincible = value
  })
  cheat.add(cheats, 'colliders').name('show colliders')
  cheat.add(cheats, 'speed').name('speed boost')
  cheat.add(cheats, 'shoot').name('rapid fire')
  cheat.add(cheats, 'ghost').name('piercing shot')

  const colliders = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true }))
  colliders.frustumCulled = false

  return {
    update() {
      readout.time = formatTime(simulation.elapsed)
      readout.kills = simulation.kills
      readout.skeletons = simulation.skeletons.length
      readout.boost = simulation.boost?.kind ?? 'none'

      if (cheats.colliders !== (colliders.parent !== null)) {
        if (cheats.colliders) scene.add(colliders)
        else scene.remove(colliders)
      }
      if (!cheats.colliders) return
      // Rebuilt every frame: the skeletons and snowballs come and go.
      const { vertices, colors } = simulation.colliderLines()
      colliders.geometry.dispose()
      colliders.geometry = new BufferGeometry()
        .setAttribute('position', new BufferAttribute(vertices, 3))
        .setAttribute('color', new BufferAttribute(colors, 4))
    },
  }
}

// Ho Ho No, on three-vat (ADR-0038), on WebGPURenderer: the simulation below
// the renderer seam, the stage and the shell above it.
import { Scene, Timer, type Camera } from 'three'
import './style.css'
import { loadAssets } from './assets'
import { DEBUG, inspectGame } from './debug'
import { query } from './dom'
import { Input } from './input'
import { SantaView } from './santa'
import { createHorde, toonOf } from './crowds'
import { Hud } from './hud'
import { createSeam } from './seam'
import { createSimulation, elfClipsOf, loadPhysics, type SimulationInput } from './simulation/simulation'
import { Stage, arenaOf, createCamera, fitCamera } from './stage'
import { Shell } from './shell'
import { Sound } from './sound'
import { TOUCH, TouchInput } from './touch-input'

const shell = new Shell()
const canvas = query<HTMLCanvasElement>('canvas.game')

/** The longest a frame may advance the game, in seconds: a stall past it is not played through. */
const LONGEST_FRAME = 0.1

const size = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
})

try {
  const scene = new Scene()
  const camera = createCamera(window.innerWidth / window.innerHeight)
  scene.add(camera)

  // The download, the renderer's start-up and the physics' overlap; Play waits on all three.
  const sound = new Sound()
  const [assets, seam] = await Promise.all([
    loadAssets((share) => shell.progress(share), sound.loading),
    createSeam({ canvas, scene, camera, ...size(), debug: DEBUG }),
    loadPhysics(),
  ])
  document.documentElement.dataset.backend = seam.backend

  const horde = createHorde(seam, assets.skeleton, toonOf(assets))
  const simulation = await createSimulation({
    shootClipDuration: SantaView.shootClipDuration(assets.character),
    arena: arenaOf(assets),
    skeletons: horde.crowd,
    elves: elfClipsOf(assets.elf),
  })
  const stage = new Stage(seam, assets, scene, camera, simulation, horde.mesh)
  // Once the game-over screen hides the camp, nothing drawn under it is seen.
  const hud = new Hud(simulation, () => seam.setAnimationLoop(null))
  sound.listen(simulation)
  const debug = seam.inspector ? inspectGame(seam.inspector, stage, simulation, scene) : null

  window.addEventListener('resize', () => {
    const { width, height, pixelRatio } = size()
    fitCamera(camera, width / height)
    seam.setSize(width, height, pixelRatio)
  })

  /** The keyboard and the mouse, or the thumbs: either gives the simulation the same plain input. */
  let input: { sample(camera: Camera): SimulationInput } | undefined
  // The game's own clock, in seconds. On the page's, a hidden tab's return
  // would land every skeleton due meanwhile at once, end every boost and count
  // the time away as time survived: connected to the page, three's timer does
  // not count a hidden tab, and a stall is cut to one long frame.
  const timer = new Timer()
  timer.connect(document)
  let time = 0
  const frame = () => {
    try {
      timer.update()
      const delta = Math.min(timer.getDelta(), LONGEST_FRAME)
      time += delta

      // Nothing of the run moves before Play, and the simulation stops itself
      // once it is lost; the camera settles, the snow falls and the crowds
      // play either way, on the clock the simulation writes their playback on.
      if (input) {
        stage.beforeStep(delta)
        simulation.step(time, input.sample(camera))
        stage.afterStep()
        hud.update()
      }
      debug?.update()
      stage.snowfall(time)
      seam.vatTime.value = time
      stage.followCamera()
      seam.render()
    } catch (error) {
      // Thrown here, it would escape the try below and repeat every frame.
      seam.setAnimationLoop(null)
      shell.failed(error)
    }
  }
  seam.setAnimationLoop(frame)

  await shell.ready()
  input = TOUCH ? new TouchInput(simulation, canvas) : new Input()
  simulation.start(time)
  // Pressing Play is the gesture that lets a page make sound.
  sound.start()
} catch (error) {
  shell.failed(error)
}

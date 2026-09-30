// Ho Ho No, on three-vat (ADR-0038), on WebGPURenderer: the simulation below
// the renderer seam, the stage and the shell above it.
import { Scene } from 'three'
import './style.css'
import { loadAssets } from './assets'
import { Input } from './input'
import { SantaView } from './santa'
import { createHorde, toonOf } from './crowds'
import { Hud } from './hud'
import { createSeam } from './seam'
import { createSimulation, elfClipsOf } from './simulation/simulation'
import { Stage, arenaOf, createCamera } from './stage'
import { Shell } from './shell'
import { Sound } from './sound'

const shell = new Shell()
const canvas = document.querySelector<HTMLCanvasElement>('canvas.webgl')
if (!canvas) throw new Error('index.html has no canvas.webgl')

/** The longest a frame may advance the game, in seconds: longer than any frame in play. */
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

  // The download and the renderer's start-up overlap; Play waits on both.
  const sound = new Sound()
  const [assets, seam] = await Promise.all([
    loadAssets((share) => shell.progress(share), sound.loading),
    createSeam({ canvas, scene, camera, ...size() }),
  ])
  document.documentElement.dataset.backend = seam.backend

  const horde = createHorde(seam, assets.skeleton, toonOf(assets))
  const simulation = await createSimulation({
    shootClipDuration: SantaView.shootClipDuration(assets.character),
    arena: arenaOf(assets),
    skeletons: horde.crowd,
    elves: elfClipsOf(assets.elf),
  })
  const stage = new Stage(seam, assets, scene, camera, simulation, horde.batch)
  const hud = new Hud(simulation)
  sound.listen(simulation)

  window.addEventListener('resize', () => {
    const { width, height, pixelRatio } = size()
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    seam.setSize(width, height, pixelRatio)
  })

  let input: Input | undefined
  // The game's own clock, in seconds: the page's, less any frame longer than
  // a frame in play ever is. A hidden tab draws no frames, and on the page's
  // clock its return would land every skeleton due meanwhile at once, end
  // every boost and count the time away as time survived.
  let time = 0
  let last = performance.now() / 1000
  const frame = () => {
    try {
      const now = performance.now() / 1000
      const delta = Math.min(now - last, LONGEST_FRAME)
      last = now
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
  input = new Input()
  // The run is over: give the keyboard back, or Space, which throws, could
  // never press the Play Again button the game-over screen focuses.
  simulation.on('gameOver', () => input?.dispose())
  simulation.start(time)
  // Pressing Play is the gesture that lets a page make sound.
  sound.start()
} catch (error) {
  shell.failed(error)
}

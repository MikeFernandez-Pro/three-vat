// Ho Ho No, on three-vat (ADR-0038). The renderer is chosen first — WebGPU
// unless the URL asks for WebGL — and everything after it is written once:
// the simulation below the seam, the stage and the shell above it.
import { Scene } from 'three'
import './style.css'
import { loadAssets } from './assets'
import { Input } from './input'
import { rendererFrom } from './renderer-choice'
import { SantaView } from './santa'
import { createSeam } from './seam'
import { createSimulation } from './simulation/simulation'
import { Stage, arenaOf, createCamera } from './stage'
import { Shell } from './shell'

const kind = rendererFrom(window.location.search)
const shell = new Shell(kind)
const canvas = document.querySelector<HTMLCanvasElement>('canvas.webgl')
if (!canvas) throw new Error('index.html has no canvas.webgl')

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
  const [assets, seam] = await Promise.all([
    loadAssets((share) => shell.progress(share)),
    createSeam(kind, { canvas, scene, camera, ...size() }),
  ])
  document.documentElement.dataset.backend = seam.backend

  const simulation = await createSimulation({
    shootClipDuration: SantaView.shootClipDuration(assets.character),
    arena: arenaOf(assets),
  })
  const stage = new Stage(seam, assets, scene, camera, simulation)

  window.addEventListener('resize', () => {
    const { width, height, pixelRatio } = size()
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    seam.setSize(width, height, pixelRatio)
  })

  let input: Input | undefined
  let last = performance.now() / 1000
  const frame = () => {
    const time = performance.now() / 1000
    const delta = time - last
    last = time

    // Nothing of the run moves before Play; the camera settles either way.
    if (input) {
      stage.beforeStep(delta)
      simulation.step(time, input.sample(camera))
      stage.afterStep(time)
    }
    stage.followCamera()
    seam.render()
  }
  seam.setAnimationLoop(frame)

  await shell.ready()
  input = new Input()
  simulation.start(performance.now() / 1000)
} catch (error) {
  shell.failed(error)
}

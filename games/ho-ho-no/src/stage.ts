// The camp: everything drawn that is not a crowd — the lights, the follow
// camera, the camp model, the floor, Santa, the snowballs and the particles.
// Built once the assets are in, above the renderer seam: what differs between
// renderers it asks the seam for.
import {
  AmbientLight,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
  type Scene,
} from 'three'
import type { Assets } from './assets'
import { Bursts, snowSpec } from './particles'
import { SantaView } from './santa'
import type { RendererSeam, Snow } from './seam'
import type { Arena, Simulation } from './simulation/simulation'

/** The camera's offset from Santa, and how much of the way it closes each frame. */
const CAMERA_OFFSET = new Vector3(0, 15, 20)
const FOLLOW = 0.02
/** The sun rides with the camera, at the offset it was placed at. */
const SUN_OFFSET = new Vector3(15, 30, 20)
/** More snowballs than are ever in the air: one lives a second, and a throw takes 0.4 s. */
const SNOWBALL_CAPACITY = 32

export function createCamera(aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(35, aspect, 0.1, 500)
  camera.position.copy(CAMERA_OFFSET)
  camera.lookAt(0, 0, 0)
  return camera
}

/** The arena's collision mesh, in world space, for the simulation. */
export function arenaOf(assets: Assets): Arena {
  const mesh = firstMesh(assets.arenaCollider.scene)
  mesh.updateWorldMatrix(true, false)
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
  const index = geometry.getIndex()
  if (!index) throw new Error('arenaCollider.glb is not indexed')
  return {
    vertices: new Float32Array(geometry.getAttribute('position').array),
    indices: new Uint32Array(index.array),
  }
}

export class Stage {
  readonly santa: SantaView
  private readonly target = new Vector3()
  private readonly desired = new Vector3()
  private readonly sun: DirectionalLight
  private readonly snow: Snow
  private readonly snowballs: InstancedMesh
  private readonly matrix = new Matrix4()
  private readonly turn = new Quaternion()
  private readonly one = new Vector3(1, 1, 1)
  private readonly up = new Vector3(0, 1, 0)

  constructor(
    seam: RendererSeam,
    assets: Assets,
    scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly simulation: Simulation,
  ) {
    const toon = seam.toonMaterial(assets.gradient, assets.fiveTone)

    this.sun = new DirectionalLight('#89e2ff', 2.281)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    // Bounds hugging the arena as the camera sees it: the map's resolution goes
    // where the shadows are, not across the whole camp.
    Object.assign(this.sun.shadow.camera, { near: 40, far: 90, left: -20, right: 30, top: 25, bottom: -10 })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.sun.shadow.normalBias = 0.02
    this.sun.shadow.radius = 3
    scene.add(this.sun, this.sun.target, new AmbientLight('#ffffff', 1.411))
    this.followCamera()

    // The camp stands half a unit up; the node carries the dequantisation
    // meshopt compression put on it, so the model goes in whole.
    const camp = assets.camp.scene
    camp.position.y = 0.5
    camp.traverse((child) => {
      if (child instanceof Mesh) {
        child.material = toon
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    scene.add(camp)

    const floor = new Mesh(new PlaneGeometry(300, 300), seam.floorMaterial(assets.voronoi))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.55
    floor.receiveShadow = true
    scene.add(floor)

    this.santa = new SantaView(assets.character, toon, simulation)
    scene.add(this.santa.object)

    this.snowballs = new InstancedMesh(firstMesh(assets.snowBall.scene).geometry, toon, SNOWBALL_CAPACITY)
    this.snowballs.count = 0
    this.snowballs.castShadow = true
    this.snowballs.receiveShadow = true
    // Its bounds are the geometry's at the origin; the balls are anywhere.
    this.snowballs.frustumCulled = false
    scene.add(this.snowballs)

    this.snow = seam.snow(snowSpec())
    scene.add(this.snow.object)

    const bursts = new Bursts(seam, scene)
    simulation.on('burst', ({ position }) => bursts.play(position))
  }

  /** The frame before the simulation steps: advance Santa's mixer by `delta` seconds. */
  beforeStep(delta: number): void {
    this.santa.animate(delta)
  }

  /** The frame after it: follow the simulation, at `time` seconds on the page's clock. */
  afterStep(time: number): void {
    this.santa.follow()
    this.drawSnowballs()
    this.snow.update(time)
  }

  /** Close part of the way to Santa, as the original's camera did each frame, then bring the sun along. */
  followCamera(): void {
    const santa = this.simulation.santa.position
    this.desired.copy(this.camera.position).sub(this.target).add(santa)
    this.target.lerp(santa, FOLLOW)
    this.camera.position.lerp(this.desired, FOLLOW)
    this.camera.lookAt(this.target)

    this.sun.position.copy(this.camera.position).add(SUN_OFFSET)
    this.sun.target.position.copy(this.target)
  }

  private drawSnowballs(): void {
    const balls = this.simulation.snowballs
    const count = Math.min(balls.length, SNOWBALL_CAPACITY)
    for (let i = 0; i < count; i++) {
      this.turn.setFromAxisAngle(this.up, balls[i].yaw)
      this.matrix.compose(balls[i].position, this.turn, this.one)
      this.snowballs.setMatrixAt(i, this.matrix)
    }
    this.snowballs.count = count
    this.snowballs.instanceMatrix.needsUpdate = true
  }
}

/** The first mesh under `root`: each of these models is one. */
function firstMesh(root: Object3D): Mesh {
  let found: Mesh | undefined
  root.traverse((child) => {
    if (!found && child instanceof Mesh) found = child
  })
  if (!found) throw new Error('model has no mesh')
  return found
}

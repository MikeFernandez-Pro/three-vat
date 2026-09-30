// The camp: the lights, the follow camera, the camp model, the floor, Santa,
// the snowballs, the particles, the crowds (crowds.ts) and the gift
// (gift-view.ts). Built once the assets are in, above the renderer seam: what
// is the renderer's it asks the seam for.
import {
  AmbientLight,
  DirectionalLight,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from 'three'
import type { Assets } from './assets'
import { Crowds, toonOf } from './crowds'
import { GiftView } from './gift-view'
import { Bursts, SNOWBALL_BURST, snowSpec } from './particles'
import { placeAt } from './placement'
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

/** The vertical field of view the game is built on, in degrees, at an aspect of 1 or wider. */
const FOV = 35
/** Portrait's widest: matching a 16:9 landscape's width shrank Santa to a dot. */
const PORTRAIT_FOV_CAP = 60

/**
 * The vertical field of view at `aspect`: 35 degrees, widened on a portrait
 * screen until the horizontal field is a square screen's, and never past 60.
 */
function fieldOfView(aspect: number): number {
  if (aspect >= 1) return FOV
  const square = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(FOV) / 2) / aspect))
  return Math.min(square, PORTRAIT_FOV_CAP)
}

export function createCamera(aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(fieldOfView(aspect), aspect, 0.1, 500)
  camera.position.copy(CAMERA_OFFSET)
  camera.lookAt(0, 0, 0)
  return camera
}

/** The window turned or was resized: the camera's aspect, and its field with it. */
export function fitCamera(camera: PerspectiveCamera, aspect: number): void {
  camera.aspect = aspect
  camera.fov = fieldOfView(aspect)
  camera.updateProjectionMatrix()
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
  private readonly santa: SantaView
  private readonly target = new Vector3()
  private readonly desired = new Vector3()
  /** The sun and the fill, for the debug panel's lighting folder. */
  readonly sun: DirectionalLight
  readonly ambient = new AmbientLight('#ffffff', 1.411)
  private readonly snow: Snow
  private readonly snowballs: InstancedMesh
  private readonly crowds: Crowds
  private readonly gift: GiftView
  private readonly matrix = new Matrix4()

  constructor(
    seam: RendererSeam,
    assets: Assets,
    scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly simulation: Simulation,
    skeletons: InstancedMesh,
  ) {
    const look = toonOf(assets)
    const toon = seam.toonMaterial(look)

    this.sun = new DirectionalLight('#89e2ff', 2.281)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    // Bounds hugging the arena as the camera sees it: the map's resolution goes
    // where the shadows are, not across the whole camp.
    Object.assign(this.sun.shadow.camera, { near: 40, far: 90, left: -20, right: 30, top: 25, bottom: -10 })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.sun.shadow.normalBias = 0.02
    this.sun.shadow.radius = 3
    scene.add(this.sun, this.sun.target, this.ambient)
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

    this.crowds = new Crowds(seam, assets.elf, look, scene, skeletons, simulation)

    this.gift = new GiftView(seam, assets.gifts, assets.fiveTone, scene, simulation)

    const bursts = new Bursts(seam, scene, SNOWBALL_BURST)
    simulation.on('burst', ({ position }) => bursts.play(position))
  }

  /** The frame before the simulation steps: advance Santa's mixer by `delta` seconds. */
  beforeStep(delta: number): void {
    this.santa.animate(delta)
  }

  /** The frame after it: follow the simulation. */
  afterStep(): void {
    this.santa.follow()
    this.drawSnowballs()
    this.crowds.draw()
    this.gift.draw()
  }

  /** Every frame, run or not: the snow at `time` seconds on the game's clock. */
  snowfall(time: number): void {
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
      this.snowballs.setMatrixAt(i, placeAt(this.matrix, balls[i].position, balls[i].yaw))
    }
    this.snowballs.count = count
    this.snowballs.instanceMatrix.needsUpdate = true
  }
}

/** The first mesh under `root`: each of these models is one. */
function firstMesh(root: Object3D): Mesh {
  const found = root.getObjectByProperty('isMesh', true)
  if (!(found instanceof Mesh)) throw new Error('model has no mesh')
  return found
}
